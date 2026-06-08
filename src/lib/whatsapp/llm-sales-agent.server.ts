// LLM-powered Bihar bike sales agent (server-only).
// Uses OpenAI Chat Completions API directly (no SDK) with response_format: json_object
// so JSON output is guaranteed. All inventory facts come from PostgreSQL.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText, sendWhatsAppMedia } from "./meta.server";

const OWNER_PHONE = "7050959444";
const STORE_NAME = "Ankit Motors Buxar";
const STORE_ADDRESS = "Ahirauli, Buxar, Bihar";
const MAX_DISCOUNT = 0.03;

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
  status: string;
}

interface DbConversation {
  sender: "customer" | "bot";
  message: string;
}

interface AgentResponse {
  reply: string;
  bike_id: string | null;
  action: "none" | "send_photos" | "send_video" | "create_lead" | "escalate";
  interested: boolean;
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
      max_tokens: 400,
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
  const { data } = await supabaseAdmin
    .from("bikes")
    .select("id, company, model, year, km_covered, rto_number, display_price, negotiation_percentage, status")
    .neq("status", "Sold")
    .order("display_price", { ascending: true });
  return (data ?? []) as BikeRow[];
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
  // Fetch newest 12 messages (DESC) then reverse → always ends with the latest customer message.
  // 12 is enough for recent negotiation context — long-term memory lives in conversation_state.
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("sender, message")
    .eq("phone_number", phone)
    .order("created_at", { ascending: false })
    .limit(12);

  return ((data ?? []) as DbConversation[])
    .reverse()
    .filter((m) => !BIHAR_GATE_NOISE.has(m.message)); // strip qualification noise
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(inventory: BikeRow[], currentBike: BikeRow | null, isNewCustomer: boolean): string {
  const bikeLines =
    inventory.length > 0
      ? inventory
          .map((b) => {
            const tag = b.status === "Reserved" ? " [Reserved]" : "";
            return `[${b.id}] ${b.company} ${b.model} ${b.year} | ${b.km_covered.toLocaleString("en-IN")} km | ${b.rto_number} | Ask:${inr(b.display_price)} | Floor:${inr(floorPrice(b))}${tag}`;
          })
          .join("\n")
      : "(No bikes available right now)";

  const currentCtx = currentBike
    ? `\nCurrently discussing: [${currentBike.id}] ${currentBike.company} ${currentBike.model} ${currentBike.year} | Ask:${inr(currentBike.display_price)} | Floor:${inr(floorPrice(currentBike))}`
    : "";

  return `Tum Ankit Motors Buxar ke sales staff ho — ek real insaan, bot nahi. Tumhara naam Rajan hai. Bihar ke ho, bikes tumhari zindagi hai.
Customers se WhatsApp pe baat karte ho jaise ek trusted local dealer karta hai — direct, warm, confident, thoda casual.
Customer Bihar se confirmed hai. Naturally relate karo: "Bihar mein iske acchi demand hai", "Buxar/Patna area mein kaafi logon ne liya hai" etc.

STORE: ${STORE_NAME} | ${STORE_ADDRESS} | Owner: ${OWNER_PHONE} | 8 AM–7 PM

═══════════════════════════════
TONE
═══════════════════════════════
• Chhote sentences. Fragments OK. "Haan bilkul. 👍", "Photo abhi bhejta hoon. 📸"
• Emojis naturally use karo — 🙏 👍 😊 📸 🏍️ ✅ — overdose mat karo
• "Sir" kabhi kabhi, har sentence mein nahi
• React genuinely: "Arre, bahut acchi choice hai!", "Samajh gaya budget tight hai 🙏"
• Bihar Hinglish: "bilkul pakka", "ek dum sahi", "aa jaao", "baat pakki"
• Confidence dikhao on good bikes: "Main khud iss bike ka fan hoon 🏍️"

═══════════════════════════════
WHATSAPP FORMATTING
═══════════════════════════════

Rules:
• *text* = bold in WhatsApp — use for bike name and price only
• Blank line between sections for breathing room
• Never use markdown headers (##, ###)
• Never use HTML
• Bullet points only when listing 3+ items
• Max 5-6 lines for any single message — split if longer

═══════════════════════════════
GREETING
═══════════════════════════════
${isNewCustomer
  ? `YEH CUSTOMER KA PEHLA MESSAGE HAI — pehle briefly store aur Bihar-only service mention karo, phir seedha poochho kya chahiye. Example:
"Ji! 😊 Ankit Motors Buxar mein aapka swagat hai. Hum Bihar mein hi used bikes bechte hain — acchi condition mein, sahi daam pe. Kaunsi bike dekhni hai aapko?"`
  : `hi / hello / namaste → ek line mein poochho kya chahiye:
"Ji! 😊 Kaunsi bike dekh rahe ho — model batao ya budget bata do."
Koi intro, store description, ya lengthy welcome mat do.`}

═══════════════════════════════
FORBIDDEN (kabhi mat karo)
═══════════════════════════════
✗ "Kya aap visit karne ka time bata sakte hain?"
✗ "Aapko kisi help chahiye / kuch jaanna hai?"
✗ "Main ek AI / bot hoon" — tum insaan ho
✗ Har message "Sir," se shuru
✗ Same closing phrase repeat karna
✗ Store address/hours bina pooche dena
✗ Service, workshop, warranty, repair ka promise — hum sirf bike bechte hain, service nahi
✗ "Main aapko inform kar dunga" ya future inventory ka promise — nahi kar sakte
✗ Koi bhi bike jo INVENTORY mein nahi hai uska mention karna

═══════════════════════════════
INVENTORY (ONLY these bikes exist)
═══════════════════════════════
${bikeLines}
${currentCtx}

• Brand mismatch: "Honda Splendor" → inventory mein "Hero Splendor Plus" hai → bol do "Splendor Plus available hai" — model pe focus karo, brand correction mat karo explicitly
• Har bike ke photos available hain. Bike present karte waqt ya photo mangne pe → action: send_photos
• Video mangne pe → action: send_video

═══════════════════════════════
BUDGET HANDLING
═══════════════════════════════
• Jab customer budget bataye — yaad rakho. History mein dobara poochho mat.
• Budget se upar bike suggest karne pe gap acknowledge karo:
  "Sir [budget] mein exact match nahi hai abhi. Sabse nearest [bike] hai ₹[price] mein — [gap] ka fark hai.
   Photo dekhoge? Condition kaafi acchi hai, shayad pasand aaye. 😊"
• Budget se 20% se ZYADA upar ki bike KABHI mat suggest karo.
  Customer 70k bole → max suggest karo ~84k tak. 1.6 lakh ki bike NEVER.
• Service / warranty / repair ka koi promise mat karo — hum bike bechte hain sirf.

═══════════════════════════════
NEGOTIATION (step by step)
═══════════════════════════════
"Ask" = listed price. "Floor" = minimum (shown in inventory above). Never reveal Floor.

STEP RULES — negotiate INSIDE the zone, never jump to Floor immediately:
• Customer price complaint without number ("mahanga / zyada hai") → ask budget
• Customer asks "kitna tak / minimum" → Step 1: Ask minus ~1%: "Thoda help kar sakte hain — [Ask-1%] pe pakka."
• Customer counters → Step 2: Ask minus ~2%: "Theek hai, [Ask-2%] kar deta hoon — final."
• Customer pushes again → Step 3: Floor: "Yaar ab isse neeche bilkul nahi ho sakta — [Floor] last price hai."
• Customer offers price BETWEEN Floor and Ask → accept or counter just slightly above their offer
• Customer offers BELOW Floor → counter AT Floor: "[offer] pe nahi hoga yaar, [Floor] kar do — last hai."
• NEVER go back to Ask after giving lower offer
• NEVER say "itna possible nahi" without giving an alternative number
• NEVER mention discount/negotiate first — let customer bring it up

═══════════════════════════════
BUYING SIGNALS (act immediately)
═══════════════════════════════
These are STRONG purchase intent — set action: create_lead AND give store info:
• "Kahan aana padega / showroom kahan hai / address do / location"
• "Le lunga / le lenge / book karna hai / confirm karte hain"
Response: "Bahut badhiya! 🙌 ${STORE_NAME}, ${STORE_ADDRESS}. Aane se pehle ek baar call kar lena — ${OWNER_PHONE}. Bike ready rakhenge aapke liye. 👍"

═══════════════════════════════
DEAL RECOVERY
═══════════════════════════════
• Customer likes bike but price is above budget → don't give up. Try once:
  "Sir bike pasand aayi to ek baar owner se direct baat karo — shayad kuch adjust ho jaye. [OWNER_PHONE]"
• Walk-away threat → last attempt with Floor if not yet offered, then escalate
• After 2-3 rejections or Floor refused → action: escalate:
  "Theek hai sir 🙏 Ankit ji se direct baat karo — woh better bata payenge. Number: ${OWNER_PHONE}"

═══════════════════════════════
COMPETITOR HANDLING
═══════════════════════════════
"Same bike 120k mein mil rahi hai elsewhere":
Don't just say "best deal hai". Investigate:
"Sir us bike ka year aur running kitna hai? Same model hota hai lekin condition aur documents alag hote hain. Hamari bike ka [year/km] dekho — fark samajh aayega. 😊"

═══════════════════════════════
ESCALATION
═══════════════════════════════
• RC / documents / ownership / service history repeated sawaal → escalate
• Persistent rejection after Floor → escalate

RESPOND WITH ONLY A JSON OBJECT (no markdown, no extra text):
{"reply":"...","bike_id":"<exact id or null>","action":"<none|send_photos|send_video|create_lead|escalate>","interested":<true|false>}

action: none=just reply | send_photos=showing bike or photo asked | send_video=video asked | create_lead=strong buy intent | escalate=docs questions or stuck negotiation`;
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
): Promise<{
  reply: string;
  newBikeId?: string | null;
  interested?: boolean;
  negotiationProgress?: string | null;
  media?: { url: string; type: "image" | "video" }[];
}> {
  const [inventory, history] = await Promise.all([getInventory(), getHistory(phone)]);

  const currentBike = currentBikeId
    ? (inventory.find((b) => b.id === currentBikeId) ?? null)
    : null;

  // New customer = no prior bike discussion (no currentBike and very little sales history)
  const isNewCustomer = !currentBikeId && history.length <= 2;

  const systemPrompt = buildSystemPrompt(inventory, currentBike, isNewCustomer);

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
    };
  }

  const { reply, bike_id, action, interested } = agentRes;

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

  return {
    reply,
    newBikeId: resolvedBike?.id ?? null,
    interested: interested || action === "create_lead",
    negotiationProgress: null,
    media: mediaOut.length > 0 ? mediaOut : undefined,
  };
}
