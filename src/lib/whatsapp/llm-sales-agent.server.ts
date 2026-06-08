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

function floorPrice(p: number): number {
  return Math.round(p * (1 - MAX_DISCOUNT));
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
  // Fetch newest 16 messages (DESC) then reverse → always has the latest customer message.
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("sender, message")
    .eq("phone_number", phone)
    .order("created_at", { ascending: false })
    .limit(16);
  return ((data ?? []) as DbConversation[]).reverse();
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(inventory: BikeRow[], currentBike: BikeRow | null): string {
  const bikeLines =
    inventory.length > 0
      ? inventory
          .map((b) => {
            const tag = b.status === "Reserved" ? " [Reserved]" : "";
            return `[${b.id}] ${b.company} ${b.model} ${b.year} | ${b.km_covered.toLocaleString("en-IN")} km | ${b.rto_number} | Ask:${inr(b.display_price)} | Floor:${inr(floorPrice(b.display_price))}${tag}`;
          })
          .join("\n")
      : "(No bikes available right now)";

  const currentCtx = currentBike
    ? `\nCurrently discussing: [${currentBike.id}] ${currentBike.company} ${currentBike.model} ${currentBike.year} | Ask:${inr(currentBike.display_price)} | Floor:${inr(floorPrice(currentBike.display_price))}`
    : "";

  return `You are a sharp used-bike sales agent for ${STORE_NAME}, Buxar, Bihar.
Reply in natural Hinglish. Short — 1 to 3 sentences max. Sound like a trusted local dealer.
Owner: ${OWNER_PHONE} | Store: ${STORE_ADDRESS} | Hours: 8 AM–7 PM

INVENTORY (these are the ONLY bikes that exist — do NOT mention any other bike):
${bikeLines}
${currentCtx}

RULES:
- ONLY discuss bikes from the inventory above. Never invent or mention a bike not listed.
- Every bike in the inventory HAS photos available. When presenting a bike OR when customer asks for photo, always set action to send_photos.
- Videos may also be available. If customer asks for video, set action to send_video.
- Sell the customer's chosen bike first. Alternatives only if: not in stock, customer rejects, budget too low, or customer asks.
- Never reveal Floor price. Never go below it. If customer asks for less than Floor: "Sir itna possible nahi hai."
- Negotiation: hold first → small step → final = Floor (after 2-3 pushes).
- Move every conversation toward visit/call/lead. Ask one question at a time.
- Bihar check is already done. Do not ask again.
- For RC/documents/ownership questions → escalate to owner.

RESPOND WITH ONLY A JSON OBJECT (no other text):
{"reply":"...","bike_id":"<exact id from inventory, or JSON null (not the string null)>","action":"<none|send_photos|send_video|create_lead|escalate>","interested":<true|false>}

action guide:
  none = just send reply
  send_photos = presenting a bike for first time OR customer asked for photo — ALWAYS use this when showing a bike
  send_video = customer asked for video
  create_lead = customer shows strong intent (le lunga / visit / booking / showroom kahan)
  escalate = RC/documents/ownership repeated questions or negotiation stuck`;
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
  const [inventory, history] = await Promise.all([getInventory(), getHistory(phone)]);

  const currentBike = currentBikeId
    ? (inventory.find((b) => b.id === currentBikeId) ?? null)
    : null;

  const systemPrompt = buildSystemPrompt(inventory, currentBike);

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
