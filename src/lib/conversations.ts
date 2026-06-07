import { supabase } from "@/integrations/supabase/client";

export type ConversationSender = "customer" | "bot";

export interface Conversation {
  id: string;
  phone_number: string;
  sender: ConversationSender;
  message: string;
  created_at: string;
}

export interface ConversationState {
  id: string;
  phone_number: string;
  state_verified: boolean;
  current_bike_id: string | null;
  negotiation_progress: string | null;
  interested: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationThread {
  phone_number: string;
  last_message: string;
  last_at: string;
  count: number;
  state_verified: boolean;
  interested: boolean;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export async function fetchConversationStates(): Promise<ConversationState[]> {
  const { data, error } = await supabase
    .from("conversation_state")
    .select("*");
  if (error) throw error;
  return (data ?? []) as ConversationState[];
}

export function buildThreads(
  conversations: Conversation[],
  states: ConversationState[],
): ConversationThread[] {
  const stateMap = new Map(states.map((s) => [s.phone_number, s]));
  const byPhone = new Map<string, Conversation[]>();
  for (const c of conversations) {
    const arr = byPhone.get(c.phone_number) ?? [];
    arr.push(c);
    byPhone.set(c.phone_number, arr);
  }

  const threads: ConversationThread[] = [];
  for (const [phone, msgs] of byPhone) {
    const sorted = msgs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const st = stateMap.get(phone);
    threads.push({
      phone_number: phone,
      last_message: sorted[0]?.message ?? "",
      last_at: sorted[0]?.created_at ?? "",
      count: msgs.length,
      state_verified: st?.state_verified ?? false,
      interested: st?.interested ?? false,
    });
  }
  return threads.sort((a, b) => b.last_at.localeCompare(a.last_at));
}

export function formatDateTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
