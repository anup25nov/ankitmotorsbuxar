// LLM-powered Bihar bike sales agent (server-only).
// OpenAI is used ONLY for language generation.
// All inventory facts come from PostgreSQL — the LLM never invents bikes or prices.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText, sendWhatsAppMedia } from "./meta.server";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { z } from "zod";

const OWNER_PHONE = "7050959444";
const STORE_NAME = "Ankit Motors Buxar";
const STORE_ADDRESS = "Ahirauli, Buxar, Bihar";
const MAX_DISCOUNT = 0.03; // 3% max off display price

// ─── Response schema (enforced by generateObject — no manual JSON parsing) ────

const AgentResponseSchema = z.object({
  reply: z.string().describe("WhatsApp message in Hindi/Hinglish, 1-3 sentences"),
  bike_id: z.string().nullable().describe("Exact bike ID from inventory, or null"),
  action: z
    .enum(["none", "send_photos", "send_video", "create_lead", "escalate"])
    .describe("Action to execute after sending the reply"),
  interested: z.boolean().describe("Whether customer showed purchase interest"),
});

type AgentResponse = z.infer<typeof AgentResponseSchema>;

// ─── Types ───────────────────────────────────────────────────────────────────

interface BikeRow {
  id: string;
  company: string;
  model: string;
  year: number;
  km_covered: number;
  rto_number: string;
  display_price: number;
  status: string;
}

interface DbConversation {
  sender: "customer" | "bot";
  message: string;
}

// ─── LLM client ──────────────────────────────────────────────────────────────

function getModel() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const provider = createOpenAICompatible({
    name: "openai",
    baseURL: "https://api.openai.com/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return provider(process.env.OPENAI_MODEL ?? "gpt-4o-mini");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function floorPrice(displayPrice: number): number {
  return Math.round(displayPrice * (1 - MAX_DISCOUNT));
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function getInventory(): Promise<BikeRow[]> {
  const { data } = await supabaseAdmin
    .from("bikes")
    .select("id, company, model, year, km_covered, rto_number, display_price, status")
    .neq("status", "Sold")
    .order("display_price", { ascending: true });
  return (data ?? []) as BikeRow[];
}

async function getHistory(phone: string): Promise<DbConversation[]> {
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("sender, message")
    .eq("phone_number", phone)
    .order("created_at", { ascending: true })
    .limit(24);
  return (data ?? []) as DbConversation[];
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(inventory: BikeRow[], currentBike: BikeRow | null): string {
  const bikeLines =
    inventory.length > 0
      ? inventory
          .map((b) => {
            const tag = b.status === "Reserved" ? " [Reserved]" : "";
            return `  [${b.id}] ${b.company} ${b.model} ${b.year} | ${b.km_covered.toLocaleString("en-IN")} km | RTO: ${b.rto_number} | Price: ${inr(b.display_price)} | Floor: ${inr(floorPrice(b.display_price))}${tag}`;
          })
          .join("\n")
      : "  (Abhi koi bike available nahi hai)";

  const currentCtx = currentBike
    ? `\nCustomer is currently looking at: [${currentBike.id}] ${currentBike.company} ${currentBike.model} ${currentBike.year} | Price: ${inr(currentBike.display_price)} | Floor: ${inr(floorPrice(currentBike.display_price))}`
    : "";

  return `Tum Ankit Motors Buxar ke sales executive ho — ek sharp, experienced used-bike dealer Bihar se.
Tum Hinglish mein baat karte ho — natural, warm, direct. Bilkul waise jaise ek trusted local dealer baat karta hai jो bikes ko inside-out jaanta ho.

STORE INFO:
  Naam: ${STORE_NAME}
  Address: ${STORE_ADDRESS}
  Owner contact: ${OWNER_PHONE}
  Timing: 8 AM – 7 PM, Roz

LIVE INVENTORY (Sold bikes already removed — yahi available hai):
${bikeLines}
${currentCtx}

NEGOTIATION RULES:
  - "Price" = customer ko dikhaya jaane wala price.
  - "Floor" = tumhara hard minimum. Customer ko kabhi bhi Floor reveal mat karo. Kabhi bhi neeche mat jaao.
  - Negotiation steps: pehle price hold karo → ek chhoti concession do → doosri push pe aur thoda → teen pushes ke baad Floor pe final karo.
  - Floor se neeche customer offer kare to refuse karo bina floor reveal kiye: "Sir itne mein mushkil hai."

SALES RULES (strict):
  1. Customer ki CHOSEN bike PEHLE sell karo. Alternatives = last resort, not first move.
  2. Pehli objection pe bike mat chhodna — handle karo.
  3. Alternatives sirf tab suggest karo jab: (a) bike hai hi nahi, (b) customer reject kare, (c) budget kaafi kaafi kam ho, (d) customer khud maange.
  4. Har response ko action ki taraf le jaao: visit, call, ya lead.
  5. Bihar verification pehle ho chuki hai — dobara mat poochho.
  6. Ek baar mein sirf ek question poochho.

RESPONSE STYLE:
  - 1–3 chhote sentences. No lectures. No corporate-speak.
  - "Sir" naturally use karo.
  - Emojis sparingly — sirf jab genuinely fits.
  - Avoid repeating what customer just said.

ACTION FIELD GUIDE:
  none         → sirf reply bhejo
  send_photos  → customer ne photo manga, ya bike present karte waqt photos bhi bhejo
  send_video   → customer ne video manga
  create_lead  → strong purchase intent (le lunga / booking / visit / showroom kahan) — lead banao
  escalate     → RC / documents / ownership / service history ke repeated sawaal, ya negotiation stuck ho

EXAMPLES:

Customer: "Apache hai?"
→ { "reply": "Ji sir, Apache RTR 160 available hai.\\n\\n• Year: 2022\\n• KM: 15,000\\n• Price: ₹85,000\\n\\nBahut acchi sporty bike hai — pickup kaafi solid hai. Photo dikhaun?", "bike_id": "<apache_id>", "action": "none", "interested": true }

Customer: "Photo dikhao"
→ { "reply": "Photos bhej raha hoon sir 📸", "bike_id": "<id>", "action": "send_photos", "interested": true }

Customer: "Price bahut zyada hai"
→ { "reply": "Samajh sakta hoon sir. Aapka roughly kitna budget hai?", "bike_id": "<id>", "action": "none", "interested": true }

Customer: "80k mein milegi?"
(if 80k >= Floor) → { "reply": "Sir 80k mein final kar sakte hain. Kab aana chahenge?", "bike_id": "<id>", "action": "none", "interested": true }
(if 80k < Floor)  → { "reply": "Sir 80k mein thoda mushkil hai. Best jo kar sakte hain woh ₹84,000 hai — pakka deal hoga.", "bike_id": "<id>", "action": "none", "interested": true }

Customer: "RC clear hai? Documents sahi hain?"
→ { "reply": "Sir RC aur documents ke baare mein Ankit ji se directly baat karna best rahega.\\nNumber: ${OWNER_PHONE}", "bike_id": "<id>", "action": "escalate", "interested": true }

Customer: "Le lunga, showroom kahan hai?"
→ { "reply": "Bahut badhiya sir! 🙌\\n\\n${STORE_NAME}\\n${STORE_ADDRESS}\\nContact: ${OWNER_PHONE}\\n\\nAane se pehle ek call kar lena — bike ready rakhenge.", "bike_id": "<id>", "action": "create_lead", "interested": true }

Customer: "Koi aur bike hai?"
→ { "reply": "Haan sir, aur bhi options hain. Aapko sporty chahiye ya mileage wali?", "bike_id": null, "action": "none", "interested": true }`;
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
  message: string,
  currentBikeId: string | null,
  _negotiationProgressRaw: string | null,
): Promise<{
  reply: string;
  newBikeId?: string | null;
  interested?: boolean;
  negotiationProgress?: string | null;
  media?: { url: string; type: "image" | "video" }[];
}> {
  // Fetch inventory and history in parallel (history now includes the already-logged customer message)
  const [inventory, history] = await Promise.all([getInventory(), getHistory(phone)]);

  const currentBike = currentBikeId
    ? (inventory.find((b) => b.id === currentBikeId) ?? null)
    : null;

  const system = buildSystemPrompt(inventory, currentBike);

  // Build LLM message thread from stored history
  const llmMessages: Array<{ role: "user" | "assistant"; content: string }> =
    history.map((h) => ({
      role: (h.sender === "customer" ? "user" : "assistant") as "user" | "assistant",
      content: h.message,
    }));

  let agentRes: AgentResponse;
  try {
    const { object } = await generateObject({
      model: getModel(),
      schema: AgentResponseSchema,
      system,
      messages: llmMessages,
      temperature: 0.35,
      maxTokens: 500,
    });
    agentRes = object;
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

  // Resolve the bike the LLM is talking about
  const resolvedBike = bike_id
    ? (inventory.find((b) => b.id === bike_id) ?? currentBike)
    : currentBike;

  // 1. Send the text reply
  await sendWhatsAppText(phone, reply);

  // 2. Execute the action
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
    negotiationProgress: null, // LLM manages negotiation through conversation history
    media: mediaOut.length > 0 ? mediaOut : undefined,
  };
}
