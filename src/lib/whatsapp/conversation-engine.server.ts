// Conversation engine (server-only).
// Strict Bihar-only gate → verified users go to LLM sales agent.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText } from "./meta.server";
import { handleVerifiedMessage } from "./llm-sales-agent.server";

// ─── Message templates ────────────────────────────────────────────────────────

const BIHAR_PROMPT = `Namaste! 🙏

Ankit Motors Buxar mein aapka swagat hai.

Hum abhi sirf Bihar ke customers ko serve karte hain.

Kya aap Bihar se hain?

1️⃣ Haan, Bihar se hoon
2️⃣ Nahi`;

const REJECT_MESSAGE = `Shukriya aapke interest ke liye! 🙏

Abhi hamari service sirf Bihar ke customers ke liye available hai.

Agar kabhi Bihar mein hon to zaroor contact karein.`;

const CONTINUE_MESSAGE = `Bahut badhiya! 🙌

Aap kaunsi bike dekhna chahte hain? Company, model ya budget — jo bhi batao.`;

// Sentinel stored in negotiation_progress to permanently mark rejected users.
// LLM always resets negotiation_progress to null for verified users, so no conflict.
const REJECTED_SENTINEL = "__rejected__";

// ─── Bihar districts — any mention = confirmed Bihar ─────────────────────────

const BIHAR_DISTRICTS = new Set([
  "patna", "gaya", "bhagalpur", "muzaffarpur", "darbhanga", "purnia",
  "araria", "ara", "buxar", "bhojpur", "rohtas", "kaimur", "aurangabad",
  "nawada", "nalanda", "sheikhpura", "lakhisarai", "jamui", "banka",
  "munger", "begusarai", "samastipur", "madhubani", "sitamarhi",
  "sheohar", "supaul", "madhepura", "saharsa", "khagaria",
  "chapra", "saran", "siwan", "gopalganj", "east champaran",
  "west champaran", "motihari", "betia", "vaishali", "hajipur",
  "jehanabad", "arwal", "katihar", "kishanganj",
]);

// ─── Intent detection ─────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function wordSet(t: string): Set<string> {
  return new Set(t.split(/[\s,।.!?]+/).filter(Boolean));
}

function isAffirmative(text: string): boolean {
  const t = normalize(text);
  const w = wordSet(t);

  // Substring-safe: these strings don't appear inside unrelated words
  if (t.includes("✅")) return true;
  if (t.includes("haan")) return true;
  if (t.includes("bilkul")) return true;
  if (t.includes("haan ji") || t.includes("ji haan")) return true;
  if (t.includes("bihar")) return true;

  // Bihar district names
  for (const d of BIHAR_DISTRICTS) {
    if (t.includes(d)) return true;
  }

  // Word-level only (single chars / short tokens appear inside other words as substrings)
  return (
    t === "1" ||
    w.has("haa") ||
    w.has("ha") ||
    w.has("han") ||
    w.has("yes") ||
    w.has("y") ||
    w.has("ok") ||
    w.has("okay") ||
    w.has("theek") ||
    w.has("thik")
  );
}

function isNegative(text: string): boolean {
  const t = normalize(text);
  const w = wordSet(t);

  if (t.includes("❌")) return true;
  if (t.includes("nahi")) return true;
  if (t.includes("nai")) return true;
  if (t.includes("nhi")) return true;
  if (t.includes("nahin")) return true;

  return t === "2" || w.has("no") || w.has("nope");
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

interface ConversationState {
  id: string;
  phone_number: string;
  state_verified: boolean;
  current_bike_id: string | null;
  negotiation_progress: string | null;
  interested: boolean;
  budget: number | null;
  preferred_brands: string | null;
  usage_type: string | null;
  last_summary: string | null;
  updated_at: string;
}

async function getOrCreateState(phone: string): Promise<ConversationState> {
  const { data: existing } = await supabaseAdmin
    .from("conversation_state")
    .select("*")
    .eq("phone_number", phone)
    .maybeSingle();

  if (existing) return existing as ConversationState;

  const { data: created, error } = await supabaseAdmin
    .from("conversation_state")
    .insert({ phone_number: phone })
    .select("*")
    .single();

  if (error) throw error;
  return created as ConversationState;
}

async function logMessage(phone: string, sender: "customer" | "bot", message: string) {
  await supabaseAdmin.from("conversations").insert({ phone_number: phone, sender, message });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleIncomingMessage(
  phone: string,
  message: string,
): Promise<{
  reply: string | null;
  stateVerified: boolean;
  media?: { url: string; type: "image" | "video" }[];
}> {
  const state = await getOrCreateState(phone);

  // ── GATE 1: Permanently rejected users ──────────────────────────────────────
  // Once rejected, we log their message but send no reply — hard stop.
  if (state.negotiation_progress === REJECTED_SENTINEL) {
    await logMessage(phone, "customer", message);
    console.log(`[engine] rejected user ${phone} messaged again — silently ignored`);
    return { reply: null, stateVerified: false };
  }

  // Log every inbound message (for rejected users we logged above and returned)
  await logMessage(phone, "customer", message);

  // ── GATE 2: Bihar qualification ──────────────────────────────────────────────
  if (!state.state_verified) {
    if (isNegative(message)) {
      // Mark as permanently rejected so future messages get a hard stop
      await supabaseAdmin
        .from("conversation_state")
        .update({ negotiation_progress: REJECTED_SENTINEL })
        .eq("id", state.id);
      await sendWhatsAppText(phone, REJECT_MESSAGE);
      await logMessage(phone, "bot", REJECT_MESSAGE);
      return { reply: REJECT_MESSAGE, stateVerified: false };
    }

    if (isAffirmative(message)) {
      await supabaseAdmin
        .from("conversation_state")
        .update({ state_verified: true })
        .eq("id", state.id);
      await sendWhatsAppText(phone, CONTINUE_MESSAGE);
      await logMessage(phone, "bot", CONTINUE_MESSAGE);
      return { reply: CONTINUE_MESSAGE, stateVerified: true };
    }

    // Unrecognized / first message → ask Bihar question
    await sendWhatsAppText(phone, BIHAR_PROMPT);
    await logMessage(phone, "bot", BIHAR_PROMPT);
    return { reply: BIHAR_PROMPT, stateVerified: false };
  }

  // ── VERIFIED: Hand off to LLM sales agent ───────────────────────────────────
  const result = await handleVerifiedMessage(
    phone,
    message,
    state.current_bike_id,
    state.negotiation_progress,
    {
      budget: state.budget,
      preferred_brands: state.preferred_brands,
      usage_type: state.usage_type,
      last_summary: state.last_summary,
      days_since_last_active: state.updated_at
        ? Math.floor((Date.now() - new Date(state.updated_at).getTime()) / 86_400_000)
        : null,
    },
  );
  await logMessage(phone, "bot", result.reply);

  // Persist state + customer memory updates from the LLM agent
  const updates: {
    current_bike_id?: string | null;
    interested?: boolean;
    negotiation_progress?: string | null;
    last_summary?: string;
    budget?: number;
    preferred_brands?: string;
    usage_type?: string;
  } = {};
  if (result.newBikeId !== undefined) updates.current_bike_id = result.newBikeId;
  if (result.interested) updates.interested = true;
  if (result.negotiationProgress !== undefined)
    updates.negotiation_progress = result.negotiationProgress;

  // Merge customer memory updates (budget, summary, etc.)
  if (result.customerMemoryUpdate) {
    const mem = result.customerMemoryUpdate;
    if (mem.last_summary) updates.last_summary = mem.last_summary;
    if (mem.budget) updates.budget = mem.budget;
    if (mem.preferred_brands) updates.preferred_brands = mem.preferred_brands;
    if (mem.usage_type) updates.usage_type = mem.usage_type;
  }

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin
      .from("conversation_state")
      .update(updates)
      .eq("id", state.id);
  }

  return { reply: result.reply, stateVerified: true, media: result.media };
}
