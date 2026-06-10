import { supabase } from "@/integrations/supabase/client";

export type BikeStatus = "Available" | "Reserved" | "Sold";
export type MediaType = "photo" | "video";

export interface Bike {
  id: string;
  company: string;
  model: string;
  year: number;
  km_covered: number;
  rto_number: string;
  display_price: number;
  negotiation_percentage: number;
  color: string | null;
  condition_notes: string | null;
  status: BikeStatus;
  created_at: string;
  updated_at: string;
}

export interface BikeMedia {
  id: string;
  bike_id: string;
  media_type: MediaType;
  file_url: string;
  created_at: string;
}

export const STATUSES: BikeStatus[] = ["Available", "Reserved", "Sold"];

export async function fetchBikes(): Promise<Bike[]> {
  const { data, error } = await supabase
    .from("bikes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Bike[]) ?? [];
}

export async function fetchBike(id: string): Promise<Bike> {
  const { data, error } = await supabase.from("bikes").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Bike;
}

export async function fetchBikeMedia(bikeId: string): Promise<BikeMedia[]> {
  const { data, error } = await supabase
    .from("bike_media")
    .select("*")
    .eq("bike_id", bikeId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as BikeMedia[]) ?? [];
}

export async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("bike-media").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function uploadMedia(bikeId: string, file: File, type: MediaType) {
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${bikeId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("bike-media")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (upErr) throw upErr;
  const { error } = await supabase
    .from("bike_media")
    .insert({ bike_id: bikeId, media_type: type, file_url: path });
  if (error) throw error;
}

export async function deleteMedia(media: BikeMedia) {
  await supabase.storage.from("bike-media").remove([media.file_url]);
  const { error } = await supabase.from("bike_media").delete().eq("id", media.id);
  if (error) throw error;
}

export function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}
