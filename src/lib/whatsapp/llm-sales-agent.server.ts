// LLM-powered Bihar bike sales agent (server-only).
// Uses OpenAI Chat Completions API directly (no SDK) with response_format: json_object
// so JSON output is guaranteed. All inventory facts come from PostgreSQL.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText, sendWhatsAppMedia } from "./meta.server";

const OWNER_PHONE = "7050959444";
const STORE_NAME = "Ankit Motors";
const STORE_ADDRESS = "Ahirauli, Buxar, Bihar";
const MAX_DISCOUNT = 0.03;
const OWNER_NAME = "Sonu Mishra";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BikeRow {
  id: string;
  company: string;
  model: string;
  year: number;
  km_covered: number;
  rto_number: string;
  display_price: number;
  negotiation_percentage: number;
  condition_notes: string | null;
  status: string;
  created_at: string;
}

interface BikeSignals {
  leads: number;
  photos: number;
  videos: number;
}

interface DbConversation {
  sender: "customer" | "bot";
  message: string;
}

export interface CustomerMemory {
  budget: number | null;
  preferred_brands: string | null;
  usage_type: string | null;
  last_summary: string | null;
  days_since_last_active: number | null;
}

interface AgentResponse {
  reply: string;
  bike_id: string | null;
  action: "none" | "send_photos" | "send_video" | "create_lead" | "escalate";
  interested: boolean;
  budget_mentioned: number | null;
  customer_summary: string | null;
}

// ─── Direct OpenAI call (no SDK — guarantees json_object mode works) ─────────

async function callOpenAI(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      response_format: { type: "json_object" }, // guaranteed JSON output
      temperature: 0.3,
      max_tokens: 500,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

// Uses per-bike negotiation_percentage from DB; falls back to MAX_DISCOUNT if unset/zero.
function floorPrice(bike: BikeRow): number {
  const pct = (bike.negotiation_percentage > 0 ? bike.negotiation_percentage : MAX_DISCOUNT * 100) / 100;
  return Math.round(bike.display_price * (1 - pct));
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function getInventory(): Promise<BikeRow[]> {
  // Try with condition_notes first; fall back without it if the column doesn't exist yet.
  let { data, error } = await supabaseAdmin
    .from("bikes")
    .select("id, company, model, year, km_covered, rto_number, display_price, negotiation_percentage, condition_notes, status, created_at")
    .neq("status", "Sold")
    .order("display_price", { ascending: true });

  if (error) {
    console.warn("[inventory] query with condition_notes failed, retrying without:", error.message);
    const fallback = await supabaseAdmin
      .from("bikes")
      .select("id, company, model, year, km_covered, rto_number, display_price, negotiation_percentage, status, created_at")
      .neq("status", "Sold")
      .order("display_price", { ascending: true });
    data = fallback.data;
    if (fallback.error) {
      console.error("[inventory] fallback query also failed:", fallback.error.message);
    }
  }

  return (data ?? []) as BikeRow[];
}

// Count active leads and media per bike — used for real FOMO signals and media availability.
async function getBikeSignals(): Promise<Map<string, BikeSignals>> {
  const [leadsRes, mediaRes] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select("bike_id")
      .not("status", "in", "(Sold,Lost)"),
    supabaseAdmin
      .from("bike_media")
      .select("bike_id, media_type"),
  ]);
  if (leadsRes.error) console.warn("[signals] leads query failed:", leadsRes.error.message);
  if (mediaRes.error) console.warn("[signals] media query failed:", mediaRes.error.message);
  const leads = leadsRes.data;
  const media = mediaRes.data;

  const signals = new Map<string, BikeSignals>();
  const getOrInit = (id: string) => {
    let s = signals.get(id);
    if (!s) { s = { leads: 0, photos: 0, videos: 0 }; signals.set(id, s); }
    return s;
  };

  for (const l of (leads ?? []) as { bike_id: string | null }[]) {
    if (l.bike_id) getOrInit(l.bike_id).leads++;
  }
  for (const m of (media ?? []) as { bike_id: string; media_type: string }[]) {
    const s = getOrInit(m.bike_id);
    if (m.media_type === "photo") s.photos++;
    else s.videos++;
  }

  return signals;
}

function daysAgo(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}

// Messages from the Bihar gate phase that are pure noise for the sales LLM.
// Bot messages from the Bihar qualification phase — pure noise for the sales LLM.
// Must stay in sync with the templates in conversation-engine.server.ts.
const BIHAR_GATE_NOISE = new Set([
  // Current Bihar prompt
  "Namaste! 🙏\n\nAnkit Motors Buxar mein aapka swagat hai.\n\nHum abhi sirf Bihar ke customers ko serve karte hain.\n\nKya aap Bihar se hain?\n\n1️⃣ Haan, Bihar se hoon\n2️⃣ Nahi",
  // Current reject message
  "Shukriya aapke interest ke liye! 🙏\n\nAbhi hamari service sirf Bihar ke customers ke liye available hai.\n\nAgar kabhi Bihar mein hon to zaroor contact karein.",
  // Current continue message
  "Bahut badhiya! 🙌\n\nAap kaunsi bike dekhna chahte hain? Company, model ya budget — jo bhi batao.",
  // Legacy strings (from before the rewrite — may still exist in old conversations)
  "Namaste.\n\nHum filhaal sirf Bihar mein bike sale karte hain.\n\nKya aap Bihar se hain?\n\n✅ Haan\n❌ Nahi",
  "Sorry, currently we sell bikes only within Bihar.\n\nThank you for your interest.",
  "Bahut badhiya! 🙌\n\nAap kis bike mein interested hain? Company ya model ka naam bhejiye.",
]);

async function getHistory(phone: string): Promise<DbConversation[]> {
  // Fetch newest 20 messages (DESC) then reverse → always ends with the latest customer message.
  // 20 gives enough context for longer negotiations; long-term memory lives in conversation_state.
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("sender, message")
    .eq("phone_number", phone)
    .order("created_at", { ascending: false })
    .limit(20);

  return ((data ?? []) as DbConversation[])
    .reverse()
    .filter((m) => !BIHAR_GATE_NOISE.has(m.message)); // strip qualification noise
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  inventory: BikeRow[],
  currentBike: BikeRow | null,
  isNewCustomer: boolean,
  memory: CustomerMemory,
  signals: Map<string, BikeSignals>,
): string {
  // ── Static prefix (put first so OpenAI prompt caching hits on repeated calls) ──
  const staticPrefix = `You are Rajan — experienced sales staff at Ankit Motors, Buxar, Bihar. You are a real human, NOT a bot or AI. Never admit otherwise.

You've been selling bikes in Bihar for 8+ years. You know every model inside out — engine CC, real-world mileage, ride quality, resale value, common issues, which bike suits which rider. You know Bihar roads, monsoon conditions, petrol costs. Bikes aren't just your job — they're your passion.

STORE: ${STORE_NAME} | ${STORE_ADDRESS} | Owner: ${OWNER_NAME} (${OWNER_PHONE}) | Timing: 8 AM – 7 PM

════════════════════════════════════════
CORE INTELLIGENCE — READ CAREFULLY
════════════════════════════════════════

You are a SMART salesman, not a catalogue. Before replying, THINK:
1. What is the customer actually asking? (Read between the lines)
2. Where are we in the conversation? (Just started / exploring / comparing / negotiating / ready to buy)
3. What is the BEST next move to get closer to a sale?

NEVER dump a list of bikes. NEVER repeat information already shared. NEVER give a generic answer when you can give a specific, helpful one.

════════════════════════════════════════
SALES PLAYBOOK — YOUR CONVERSATION FLOW
════════════════════════════════════════

STEP 1 — QUALIFY (if you don't know what they need):
Ask ONE focused question. Pick the most useful:
* "Kaam kya hai — roz office/college ya weekend ride?" (usage → pick commuter vs sporty)
* "Budget kitna hai roughly?" (only if they haven't mentioned)
* "Koi particular model pasand hai ya dekhna hai kya kya hai?"
NEVER ask all three at once. ONE question, then listen.
If they already said what they want (brand, model, budget, use) → skip to STEP 2.

STEP 2 — RECOMMEND & PITCH (show ONE bike at a time):
* Pick the BEST match from inventory based on their need + budget.
* Don't just list specs — SELL it. Use your knowledge of the model:
  - Hero Splendor → "Bihar ki sabse bharosemand bike. 70 km/l mileage, maintenance na ke barabar."
  - TVS Apache → "Sporty feel chahiye toh isse better nahi milegi. Pickup zabardast hai."
  - Honda Activa → "Ghar mein sabke kaam aati hai. Wife bhi chala legi, market bhi ho jaayega."
* Frame condition from year + km intelligently:
  - <15k km → "Bahut kam chali hai, almost new jaisi"
  - 15k-30k km → "Normal use hai, engine bilkul fit"
  - >30k km → "Kaafi chali hai lekin well-maintained, price bhi accordingly low hai"
* ALWAYS set action: send_photos when presenting a bike — customer ko dikhao.
* If they reject → understand WHY, then suggest the next best. Don't repeat same bike.

STEP 3 — HANDLE OBJECTIONS (most important skill):
Match the objection, respond confidently:
* "Mehenga hai / price zyada hai"
  → Compare to market: "Market mein yehi model X hazaar mein milti hai. Humara rate already best hai."
  → Highlight value: "Condition dekho, service ho ke aayi hai. Sasta loge toh risk loge."
* "Condition kaisi hai? / Koi problem toh nahi?"
  → Be confident + invite visit: "Full check ho ke aayi hai sir. Engine, silencer, brake — sab sahi. Ek baar aake dekh lo, 5 minute mein samajh aa jaayega."
* "Sochta hoon / baad mein batata hoon"
  → Mild urgency (not pushy): "Bilkul, lekin bata doon — yeh model demand mein hai. 2-3 log aur dekh rahe hain."
* "Doosri jagah sasta mil raha"
  → "Rate toh mil jaayega sir, condition bhi compare karna. Hum service karke dete hain, koi chhupa hua issue nahi."
* "Pehle wali bike sold ho gayi"
  → Don't apologize too much: "Woh toh nikal gayi, demand thi uski. Lekin ek aur hai jo aapko aur better lagegi..."
* Random / irrelevant messages → Gently steer back: "Haha, achha sir. Toh bike ka kya socha?"
NEVER get defensive. NEVER argue. Stay warm and confident.

STEP 4 — NEGOTIATE PRICE (critical — follow strictly):
* ALWAYS start at ASKING PRICE. Never volunteer a discount.
* Customer asks "thoda kam karo" → first give ₹1,000–2,000 off max.
* They push again → go ₹1,000–2,000 more, reluctantly: "Bahut mushkil hai... aapke liye kar raha hoon."
* Move in SMALL steps toward floor. Make each concession feel hard-won.
* NEVER reveal or go below FLOOR PRICE. At floor: "Bhai ab isse neeche bilkul nahi hoga. Owner se baat karke yahi final diya hai."
* If they insist below floor → action: escalate (let owner decide).
* When price is agreed → "Done bhai! Kab aa rahe ho lene?" + action: create_lead
* Make them feel special: "Normally itna discount nahi dete, aapke liye special hai."

STEP 5 — CLOSE (push toward a visit / commitment):
* Always aim for a SHOP VISIT: "Photo mein aur asli mein fark hota hai sir. Ek baar aa ke dekh lo."
* Social proof: "Isi model pichle hafte ek bhai Ara se aake le gaye."
* Buying signals (asking about papers, token, delivery, finance) → action: create_lead
* RC transfer, insurance, legal, finance → action: escalate (owner handles)

════════════════════════════════════════
LANGUAGE RULES
════════════════════════════════════════

DETECT the customer's language and MATCH it:
* Hindi → Hindi  * English → English  * Hinglish → Hinglish
* Bhojpuri → Bhojpuri ("Haan bhaiya, bilkul sahi baat ba", "Daam theek ba, leke jaao")
Follow the customer's script. Don't switch unless they do.

════════════════════════════════════════
TONE & STYLE
════════════════════════════════════════

* Short sentences. Fragments OK. Sound REAL, not templated.
* Vary your language — don't start every message the same way.
* Emojis naturally — max 2 per message
* "Sir"/"Bhai" kabhi kabhi — har line mein nahi
* Bihar flavor: "bilkul pakka", "ek dum sahi", "aa jaao", "koi tension nahi"
* Max 5–6 lines. Longer → split with "\\n---\\n"

════════════════════════════════════════
WHATSAPP FORMATTING
════════════════════════════════════════

* *bold* ONLY for bike name and final price
* Blank line between sections
* NEVER use ##, ###, markdown headers, or HTML
* Indian number format: ₹1,20,000 not ₹120000

════════════════════════════════════════
IDENTITY DEFENSE
════════════════════════════════════════

"Bot hai kya?" / "AI ho?" → Deny with humor + redirect:
"Arre bhai, 8 saal se bike bech raha hoon, bot bolte ho 😄 Bolo kaunsi bike dekhni hai?"
NEVER say "Main AI hoon" / "Main bot hoon" / "Main language model hoon" under ANY circumstance.

════════════════════════════════════════
FOMO & URGENCY — USE REAL DATA
════════════════════════════════════════

Each bike listing below includes real signals: inquiry count, days listed, and media available.
* Inquiries > 0 → USE this honestly: "Iss bike ke baare mein [N] log aur pooch chuke hain"
* Listed < 3 days → "Abhi abhi aayi hai, fresh stock hai"
* Listed 3–7 days → "Hafte bhar mein aa gayi inquiry, jaldi nikal jaayegi"
* Listed > 14 days with 0 inquiries → you can offer a slightly better deal, push harder to sell
* NEVER fabricate numbers. Only use the inquiry count shown in the listing.

════════════════════════════════════════
MEDIA RULES — CHECK BEFORE PROMISING
════════════════════════════════════════

Each bike shows its actual photo/video count. FOLLOW STRICTLY:
* Photos > 0 → you CAN promise photos and set action: send_photos
* Photos = 0 → do NOT promise photos. Say: "Photo abhi upload ho rahi hai, aap aa ke dekh lo."
* Videos > 0 → you CAN promise video and set action: send_video
* Videos = 0 → do NOT promise video. Offer photos instead, or invite for a visit.

════════════════════════════════════════
RETURNING CUSTOMERS
════════════════════════════════════════

If CUSTOMER MEMORY shows days_since_last_active:
* 1–2 days → normal, no need to acknowledge gap
* 3–7 days → light acknowledgement: "Arre sir, kaise hain? Socha kya?"
* 7+ days → warm re-engagement: "Bahut din ho gaye sir! Woh [bike from memory] abhi bhi available hai. Interest hai toh bata do."
* Always use the memory context to pick up where you left off — don't start fresh.

════════════════════════════════════════
HARD RULES — NEVER BREAK
════════════════════════════════════════

* ONLY mention bikes from CURRENT INVENTORY. Never invent a bike.
* NEVER reveal FLOOR PRICE to the customer. That's your internal minimum — they must not know it.
* NEVER promise service, warranty, workshop, or repairs — we only sell bikes as-is.
* NEVER suggest a bike more than 20% above stated budget.
* Budget stated once → remembered. Don't re-ask.
* Reserved bikes → you CAN mention but say: "Ek bhai ne hold kiya hai, confirm nahi hua. Interest ho toh batao."
* If customer asks about a model not in stock → "Abhi woh nahi hai, lekin..." + redirect to closest match.
* Check Photos/Videos count per bike before promising media (see MEDIA RULES above).

════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON ONLY
════════════════════════════════════════

Return ONLY valid JSON. No text outside. Newlines in reply: \\n

{
"reply": "your WhatsApp message",
"bike_id": "<exact inventory id or null>",
"action": "none | send_photos | send_video | create_lead | escalate",
"interested": true | false,
"detected_language": "hindi | english | hinglish | bhojpuri",
"budget_mentioned": <number or null>,
"customer_summary": "<1-2 line summary of what you know about this customer so far>"
}

customer_summary: Capture what matters for the NEXT message — budget, preferred brand/type, which bikes shown, where in the sales flow, objections raised, key decisions. Example: "Budget 60k, wants commuter, shown Splendor (liked but said mehenga), trying to negotiate."
This summary is your MEMORY — it will be fed back to you next time this customer messages. Be specific and useful.

ACTION DECISION GUIDE:
- send_photos → use when presenting a bike OR customer asked for photos. ALWAYS pair with bike presentation.
- send_video → ONLY when customer specifically asks for video.
- create_lead → strong buying signal: agreed on price, wants to visit, asking about token/papers/delivery.
- escalate → RC/legal/insurance questions, owner-level decision, customer insisting below floor price.
- none → regular conversation, qualifying, objection handling.`;

  // ── Dynamic context (appended after static prefix) ────────────────────────

  // Customer memory from previous sessions (persisted in DB)
  const memoryLines: string[] = [];
  if (memory.last_summary) memoryLines.push(`Previous context: ${memory.last_summary}`);
  if (memory.budget) memoryLines.push(`Known budget: ${inr(memory.budget)}`);
  if (memory.preferred_brands) memoryLines.push(`Preferred brands: ${memory.preferred_brands}`);
  if (memory.usage_type) memoryLines.push(`Usage: ${memory.usage_type}`);
  if (memory.days_since_last_active && memory.days_since_last_active >= 3)
    memoryLines.push(`Last active: ${memory.days_since_last_active} days ago — acknowledge the gap warmly`);

  const memoryBlock =
    memoryLines.length > 0
      ? `\n════════════════════════════════════════
CUSTOMER MEMORY (from previous conversations)
════════════════════════════════════════

${memoryLines.join("\n")}
DO NOT re-ask anything already known above. Use this context to pick up where you left off.\n`
      : "";

  const priceRange =
    inventory.length > 0
      ? `${inventory.length} bikes | ${inr(inventory[0].display_price)} – ${inr(inventory[inventory.length - 1].display_price)}`
      : "0 bikes";

  const bikeLines =
    inventory.length > 0
      ? inventory
          .map((b) => {
            const s = signals.get(b.id) ?? { leads: 0, photos: 0, videos: 0 };
            const tag = b.status === "Reserved" ? " [RESERVED]" : "";
            const kmLabel =
              b.km_covered < 15000 ? "low-use" : b.km_covered < 30000 ? "normal-use" : "well-used";
            const age = daysAgo(b.created_at);
            const ageLabel = age <= 2 ? "NEW" : age <= 7 ? `${age}d ago` : `${age}d`;
            const parts = [
              `[${b.id}] ${b.company} ${b.model} ${b.year}`,
              `${b.km_covered.toLocaleString("en-IN")} km (${kmLabel})`,
              `Ask:${inr(b.display_price)} Floor:${inr(floorPrice(b))}`,
              `Listed:${ageLabel}`,
              `Inquiries:${s.leads}`,
              `Photos:${s.photos} Videos:${s.videos}`,
            ];
            if (b.condition_notes) parts.push(`Notes:"${b.condition_notes}"`);
            return parts.join(" | ") + tag;
          })
          .join("\n")
      : "(No bikes right now — apologize and ask them to check back)";

  const currentCtx = currentBike
    ? `\nCUSTOMER IS CURRENTLY DISCUSSING: *${currentBike.company} ${currentBike.model} ${currentBike.year}* [${currentBike.id}] | Ask:${inr(currentBike.display_price)} Floor:${inr(floorPrice(currentBike))} — stay focused on this bike unless they want to switch.`
    : "";

  const greetingMode = isNewCustomer
    ? `\nCUSTOMER STATUS: New customer. Greet warmly, briefly mention Buxar location, then qualify — ask what they're looking for.`
    : `\nCUSTOMER STATUS: Returning customer. Skip intro, pick up where you left off. Be direct.`;

  return `${staticPrefix}
${memoryBlock}
════════════════════════════════════════
CURRENT INVENTORY (${priceRange})
════════════════════════════════════════

${bikeLines}${currentCtx}${greetingMode}`;
}

// ─── Media senders ────────────────────────────────────────────────────────────

async function sendBikePhotos(phone: string, bikeId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("bike_media")
    .select("file_url")
    .eq("bike_id", bikeId)
    .eq("media_type", "photo")
    .limit(3);

  const urls: string[] = [];
  for (const m of data ?? []) {
    const { data: signed } = await supabaseAdmin.storage
      .from("bike-media")
      .createSignedUrl((m as any).file_url, 3600);
    if (signed?.signedUrl) {
      urls.push(signed.signedUrl);
      await sendWhatsAppMedia(phone, signed.signedUrl, "image");
    }
  }
  return urls;
}

async function sendBikeVideo(phone: string, bikeId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("bike_media")
    .select("file_url")
    .eq("bike_id", bikeId)
    .eq("media_type", "video")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const { data: signed } = await supabaseAdmin.storage
    .from("bike-media")
    .createSignedUrl((data as any).file_url, 3600);
  if (signed?.signedUrl) {
    await sendWhatsAppMedia(phone, signed.signedUrl, "video");
    return signed.signedUrl;
  }
  return null;
}

// ─── Lead upsert ─────────────────────────────────────────────────────────────

async function upsertLead(phone: string, bike: BikeRow, history: DbConversation[]) {
  const { data: existing } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("phone_number", phone)
    .eq("bike_id", bike.id)
    .not("status", "in", "(Sold,Lost)")
    .maybeSingle();

  const summary = history
    .slice(-12)
    .map((m) => `${m.sender === "customer" ? "C" : "B"}: ${m.message}`)
    .join("\n")
    .slice(0, 1800);

  const bikeName = `${bike.company} ${bike.model} (${bike.year})`;

  if (existing) {
    await supabaseAdmin
      .from("leads")
      .update({ bike_name: bikeName, conversation_summary: summary })
      .eq("id", (existing as any).id);
  } else {
    await supabaseAdmin.from("leads").insert({
      phone_number: phone,
      bike_id: bike.id,
      bike_name: bikeName,
      last_offered_price: null,
      conversation_summary: summary,
      status: "New",
    });
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleVerifiedMessage(
  phone: string,
  _message: string,
  currentBikeId: string | null,
  _negotiationProgressRaw: string | null,
  memory: CustomerMemory = { budget: null, preferred_brands: null, usage_type: null, last_summary: null, days_since_last_active: null },
): Promise<{
  reply: string;
  newBikeId?: string | null;
  interested?: boolean;
  negotiationProgress?: string | null;
  media?: { url: string; type: "image" | "video" }[];
  customerMemoryUpdate?: Partial<CustomerMemory>;
}> {
  const [inventory, history, signals] = await Promise.all([getInventory(), getHistory(phone), getBikeSignals()]);

  const currentBike = currentBikeId
    ? (inventory.find((b) => b.id === currentBikeId) ?? null)
    : null;

  // New customer = no prior bike discussion (no currentBike and very little sales history)
  const isNewCustomer = !currentBikeId && history.length <= 2 && !memory.last_summary;

  const systemPrompt = buildSystemPrompt(inventory, currentBike, isNewCustomer, memory, signals);

  const llmMessages: Array<{ role: "user" | "assistant"; content: string }> = history.map(
    (h) => ({
      role: (h.sender === "customer" ? "user" : "assistant") as "user" | "assistant",
      content: h.message,
    }),
  );

  console.log(
    `[llm-agent] msgs:${llmMessages.length} last_role:${llmMessages.at(-1)?.role} last:"${llmMessages.at(-1)?.content.slice(0, 60)}"`,
  );

  let agentRes: AgentResponse;
  try {
    const text = await callOpenAI(systemPrompt, llmMessages);
    console.log("[llm-agent] response:", text.slice(0, 200));
    agentRes = JSON.parse(text) as AgentResponse;
  } catch (err) {
    console.error("[llm-agent] error:", err);
    agentRes = {
      reply: `Maaf kijiye sir, thoda technical issue aa gaya. Seedha baat karein:\n${OWNER_PHONE}`,
      bike_id: currentBikeId,
      action: "none",
      interested: false,
      budget_mentioned: null,
      customer_summary: null,
    };
  }

  const { reply, bike_id, action, interested, budget_mentioned, customer_summary } = agentRes;

  // Guard against model returning the string "null" instead of JSON null
  const resolvedBikeId = bike_id === "null" || bike_id === "" ? null : bike_id;
  const resolvedBike = resolvedBikeId
    ? (inventory.find((b) => b.id === resolvedBikeId) ?? currentBike)
    : currentBike;

  await sendWhatsAppText(phone, reply);

  const mediaOut: { url: string; type: "image" | "video" }[] = [];

  if (action === "send_photos" && resolvedBike) {
    const urls = await sendBikePhotos(phone, resolvedBike.id);
    urls.forEach((u) => mediaOut.push({ url: u, type: "image" }));
  } else if (action === "send_video" && resolvedBike) {
    const url = await sendBikeVideo(phone, resolvedBike.id);
    if (url) mediaOut.push({ url, type: "video" });
  } else if (action === "create_lead" && resolvedBike) {
    await upsertLead(phone, resolvedBike, history);
  }

  // Build memory updates from LLM response
  const customerMemoryUpdate: Partial<CustomerMemory> = {};
  if (customer_summary) customerMemoryUpdate.last_summary = customer_summary;
  if (budget_mentioned && budget_mentioned > 0) customerMemoryUpdate.budget = budget_mentioned;

  return {
    reply,
    newBikeId: resolvedBike?.id ?? null,
    interested: interested || action === "create_lead",
    negotiationProgress: null,
    media: mediaOut.length > 0 ? mediaOut : undefined,
    customerMemoryUpdate: Object.keys(customerMemoryUpdate).length > 0 ? customerMemoryUpdate : undefined,
  };
}
