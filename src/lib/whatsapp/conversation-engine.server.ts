// Conversation engine (server-only). Implements the Phase 3 Bihar-only
// qualification flow and conversation-state management.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText } from "./aisensy.server";
import { handleVerifiedMessage } from "./inventory-ai.server";

export const BIHAR_PROMPT = `Namaste.

Hum filhaal sirf Bihar mein bike sale karte hain.

Kya aap Bihar se hain?

✅ Haan
❌ Nahi`;

export const REJECT_MESSAGE = `Sorry, currently we sell bikes only within Bihar.

Thank you for your interest.`;

export const CONTINUE_MESSAGE = `Bahut badhiya! 🙌

Aap kis bike mein interested hain? Company ya model ka naam bhejiye.`;

interface ConversationState {
  id: string;
  phone_number: string;
  state_verified: boolean;
  current_bike_id: string | null;
  negotiation_progress: string | null;
  interested: boolean;
}


function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function isAffirmative(text: string): boolean {
  const t = normalize(text);
  return (
    t.includes("✅") ||
    t.includes("haan") ||
    t.includes("haa") ||
    t.includes("ha") ||
    t === "yes" ||
    t.includes("yes") ||
    t.includes("y")
  );
}

function isNegative(text: string): boolean {
  const t = normalize(text);
  return (
    t.includes("❌") ||
    t.includes("nahi") ||
    t.includes("nai") ||
    t === "no" ||
    t.includes("no")
  );
}

async function getOrCreateState(
  phone: string,
): Promise<ConversationState> {
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

async function logMessage(
  phone: string,
  sender: "customer" | "bot",
  message: string,
) {
  await supabaseAdmin
    .from("conversations")
    .insert({ phone_number: phone, sender, message });
}

/**
 * Process one inbound customer message and respond per the Bihar-only flow.
 * Returns the bot reply that was sent (or null when no reply is appropriate).
 */
export async function handleIncomingMessage(
  phone: string,
  message: string,
): Promise<{ reply: string | null; stateVerified: boolean }> {
  const state = await getOrCreateState(phone);

  // Bihar qualification must be the first interaction.
  if (!state.state_verified) {
    if (isNegative(message)) {
      // Stop the flow: no inventory search, no AI, no lead creation.
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

    // First message or unrecognized → ask the Bihar qualification question.
    await sendWhatsAppText(phone, BIHAR_PROMPT);
    await logMessage(phone, "bot", BIHAR_PROMPT);
    return { reply: BIHAR_PROMPT, stateVerified: false };
  }

  // State verified — hand off to the AI inventory assistant (Phase 4).
  const result = await handleVerifiedMessage(
    phone,
    message,
    state.current_bike_id,
    state.negotiation_progress,
  );
  await logMessage(phone, "bot", result.reply);

  const updates: {
    current_bike_id?: string | null;
    interested?: boolean;
    negotiation_progress?: string | null;
  } = {};
  if (result.newBikeId !== undefined) updates.current_bike_id = result.newBikeId;
  if (result.interested) updates.interested = true;
  if (result.negotiationProgress !== undefined)
    updates.negotiation_progress = result.negotiationProgress;
  if (Object.keys(updates).length > 0) {
    await supabaseAdmin
      .from("conversation_state")
      .update(updates)
      .eq("id", state.id);
  }


  return { reply: result.reply, stateVerified: true };
}
