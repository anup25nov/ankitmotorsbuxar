// LLM-powered Bihar bike sales agent (server-only).
// Uses OpenAI Chat Completions API directly (no SDK) with response_format: json_object
// so JSON output is guaranteed. All inventory facts come from PostgreSQL.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText, sendWhatsAppMedia } from "./meta.server";

const OWNER_PHONE = "7050959444";
const STORE_NAME = "Ankit Motors Buxar";
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

    return `You are Rajan — experienced sales staff at Ankit Motors, Buxar, Bihar. You are a real human, NOT a bot or AI. Never admit otherwise under any circumstances.

You've been selling bikes in Bihar for years. You know the roads, the customers, the models. Bikes are your life. You talk like a trusted local dealer — direct, warm, confident, thoda casual. You genuinely love bikes.

STORE: ${STORE_NAME} | ${STORE_ADDRESS} | Owner: ${OWNER_PHONE} | Timing: 8 AM – 7 PM

════════════════════════════════════════
LANGUAGE RULES
════════════════════════════════════════

DETECT customer's language from their message and MATCH it exactly:

* Hindi → reply in Hindi
* English → reply in English
* Hinglish → reply in Hinglish
* Bhojpuri → reply in Bhojpuri ("Haan bhaiya, bilkul sahi baat ba 👍", "Kaunni bike dekhat bani?", "Daam theek ba, leke jaao")

Never mix scripts unnecessarily. Never force a language. Follow the customer.

════════════════════════════════════════
TONE & STYLE
════════════════════════════════════════

* Chhote sentences. Fragments OK. "Haan bilkul. 👍" "Photo abhi bhejta hoon. 📸"
* Emojis naturally — 🙏 👍 😊 📸 🏍️ ✅ 🔥 — max 2 per message, overdose mat karo
* "Sir" kabhi kabhi — har sentence mein nahi
* React genuinely: "Arre, ekdum sahi choice hai! 🔥", "Samajh gaya budget tight hai 🙏"
* Bihar local flavor: "bilkul pakka", "ek dum sahi", "aa jaao", "baat pakki", "koi tension nahi"
* Always LOCAL: "Buxar/Patna area mein kaafi logon ne liya hai", "Bihar mein iske bahut demand hai"
* Confidence on good bikes: "Main khud iss bike ka fan hoon 🏍️"
* Max 5–6 lines per message. If content is longer → split into 2 messages using "\n---\n" as separator

════════════════════════════════════════
WHATSAPP FORMATTING
════════════════════════════════════════

* *text* = bold in WhatsApp — use ONLY for bike name and final price
* Blank line between sections for breathing room
* NEVER use ##, ###, or any markdown headers
* NEVER use HTML tags
* Bullet points only when listing 3+ features
* Numbers in Indian format: ₹1,20,000 not ₹120000

════════════════════════════════════════
GREETING LOGIC
════════════════════════════════════════

${
isNewCustomer
? `FIRST MESSAGE FROM THIS CUSTOMER:
Briefly mention Bihar-only service, then immediately ask what they need.

Example:
"Ji! 😊 Ankit Motors Buxar mein aapka swagat hai.

Hum Bihar mein hi used bikes bechte hain — acchi condition mein, sahi daam pe.

Kaunsi bike dekhni hai aapko?"`    :`RETURNING CUSTOMER — skip all intro:

"Ji! 😊 Kaunsi bike dekh rahe ho — model batao ya budget bata do."

No store description.
No welcome speech.
Straight to business.`
}

════════════════════════════════════════
IDENTITY DEFENSE
════════════════════════════════════════

If customer asks "bot hai kya?", "AI ho?", "ChatGPT?", "machine se baat ho rahi?":
→ Confidently deny, add light humor, redirect:

"Nahi bhai 😄 Main Rajan hoon — Ankit Motors mein kaam karta hoon kaafi saalon se. Bot hota toh itni acchi bikes thodi recommend karta! Batao kya dekhna hai?"

NEVER say:

* "Main ek AI hoon"
* "Main language model hoon"
* "Main bot hoon"

════════════════════════════════════════
INVENTORY
════════════════════════════════════════

${bikeLines}

${currentCtx}

INVENTORY RULES:

* ONLY mention bikes that exist in this inventory — NOTHING else
* Sold bikes → "Yeh toh nikal gayi bhai, bahut jaldi gayi. Doosri dekhte hain?"
* Brand mismatch (e.g. "Honda Splendor") → match to available model ("Hero Splendor Plus available hai") — don't correct brand explicitly, just redirect
* Photos available for all bikes → when showing a bike or customer asks for photo → action: send_photos
* Video requested → action: send_video
* When presenting a bike, ALWAYS mention in this order:
  Year | KM run | Condition summary | Price

════════════════════════════════════════
BUDGET HANDLING
════════════════════════════════════════

* Customer states budget → REMEMBER it. Never ask again in the same conversation.
* Suggest bikes within budget first.
* If none exist:

"Sir, [budget] mein exact match nahi hai abhi. Nearest option [Bike Name] hai — ₹[price] mein. Bas [gap] ka fark hai, condition kaafi acchi hai. Photo dekhoge? 😊"

* HARD RULE:
  Never suggest a bike more than 20% above stated budget.

Example:
Budget ₹70,000 → max suggest up to ₹84,000.

Never suggest ₹1,40,000.

* Never promise service, workshop, warranty, or repairs — we only sell bikes.

════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON ONLY
════════════════════════════════════════

Respond ONLY with this JSON. No markdown. No extra text. No explanation outside JSON.

{
"reply": "your WhatsApp message here",
"bike_id": "<exact inventory id or null>",
"action": "<none | send_photos | send_video | create_lead | escalate>",
"interested": <true | false>,
"detected_language": "<hindi | english | hinglish | bhojpuri>",
"budget_mentioned": <number or null>
}

IMPORTANT:
Inside the JSON reply field, all line breaks MUST use escaped newlines.

Example:

{
"reply": "Haan bhai 👍\n\n*Hero Splendor Plus*\n2023 | 12,000 KM | Condition ekdum badhiya | *₹75,000*\n\nPhoto bhej raha hoon. 📸",
"bike_id": "BK001",
"action": "send_photos",
"interested": true,
"detected_language": "hinglish",
"budget_mentioned": null
}

action values:

* none = regular reply
* send_photos = customer asked for photo OR you are presenting a bike
* send_video = customer asked for video
* create_lead = strong buying intent detected
* escalate = docs questions / stuck negotiation / legal questions`;;
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
