import { supabase } from "@/integrations/supabase/client";

export type LeadStatus =
  | "New"
  | "Store Visit Scheduled"
  | "Visited"
  | "Sold"
  | "Lost";

export const LEAD_STATUSES: LeadStatus[] = [
  "New",
  "Store Visit Scheduled",
  "Visited",
  "Sold",
  "Lost",
];

export interface Lead {
  id: string;
  phone_number: string;
  bike_id: string | null;
  bike_name: string | null;
  last_offered_price: number | null;
  conversation_summary: string | null;
  status: LeadStatus;
  created_at: string;
  updated_at: string;
}

export interface LeadEvent {
  id: string;
  lead_id: string;
  event_type: string;
  description: string;
  created_at: string;
}

export async function fetchLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Lead[]) ?? [];
}

export async function fetchLead(id: string): Promise<Lead> {
  const { data, error } = await supabase.from("leads").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Lead;
}

export async function fetchLeadEvents(leadId: string): Promise<LeadEvent[]> {
  const { data, error } = await supabase
    .from("lead_events")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as LeadEvent[]) ?? [];
}

export async function addLeadEvent(leadId: string, description: string, eventType = "note") {
  const { error } = await supabase
    .from("lead_events")
    .insert({ lead_id: leadId, event_type: eventType, description });
  if (error) throw error;
}

export const statusBadgeVariant = (
  s: LeadStatus,
): "default" | "secondary" | "outline" | "destructive" => {
  switch (s) {
    case "New":
      return "default";
    case "Store Visit Scheduled":
      return "secondary";
    case "Visited":
      return "secondary";
    case "Sold":
      return "outline";
    case "Lost":
      return "destructive";
  }
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
