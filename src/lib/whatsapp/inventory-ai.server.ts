// Deterministic Inventory + Negotiation + Lead Conversion (server-only).
// NO LLM. All responses are template-based, all facts come from PostgreSQL.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText, sendWhatsAppMedia } from "./meta.server";
import {
  loadInventoryVocab,
  parseMessage,
  type ParsedMessage,
} from "./parser.server";

// ----- Templates (Hindi/Hinglish, Bihar tone) -----

export const ESCALATION_MESSAGE = `Aap humse direct baat kar sakte hain:

Ankit Motors Buxar
7050959444
8 AM - 7 PM`;

export const STORE_INFO_MESSAGE = `Ankit Motors Buxar

Address:
Ahirauli, Buxar

Google Maps:
https://maps.google.com

Contact:
7050959444

Hours:
8 AM - 7 PM`;

export const GREETING_MESSAGE = `Namaste 🙏

Aap kis bike mein interested hain? Company, model ya budget bataiye.`;

export const FALLBACK_MESSAGE = `Maaf kijiye, samajh nahi paaya.

Aap bike ka naam, company ya budget bhej sakte hain. Jaise:
• Apache
• 80k tak bike
• Hero Splendor`;

export const NO_RESULT_MESSAGE = `Aapke requirement ke hisaab se abhi koi bike available nahi hai.

Aap budget ya model thoda adjust kar sakte hain?`;

export const INTEREST_PROMPT = `\n\nKya aap is bike ko dekhna chahenge?\n\n✅ Haan\n❌ Nahi\n🔄 Aur options`;

// Global hard cap. NEVER discount more than this off the display price.
const NEGOTIATION_CAP = 0.03;
const NEGOTIATION_STEPS = 3;

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

interface NegotiationProgress {
  bike_id: string;
  step: number;
  last_offered_price: number | null;
}

function parseProgress(raw: string | null): NegotiationProgress | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as NegotiationProgress; } catch { return null; }
}

function formatINR(value: number): string {
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

function bikeDisplayName(b: BikeRow): string {
  return `${b.company} ${b.model} (${b.year})`;
}

function formatSingleBike(b: BikeRow): string {
  const reserved = b.status === "Reserved" ? "\n\n⚠ Note: Ye bike abhi reserved hai." : "";
  return `${b.company} ${b.model} available hai:

• Year: ${b.year}
• KM: ${b.km_covered.toLocaleString("en-IN")} km
• RTO: ${b.rto_number}
• Price: ${formatINR(b.display_price)}${reserved}`;
}

function formatMultipleBikes(rows: BikeRow[]): string {
  const lines = rows.map(
    (b, i) => `${i + 1}. ${b.company} ${b.model} (${b.year}) - ${formatINR(b.display_price)}`,
  );
  return `Aapke requirement ke hisaab se ye bikes available hain:\n\n${lines.join("\n")}\n\nKaun si bike pasand aayi?`;
}

// ----- SQL search (single source of truth) -----

async function searchBikes(p: ParsedMessage, offset = 0): Promise<BikeRow[]> {
  let q = supabaseAdmin
    .from("bikes")
    .select("id, company, model, year, km_covered, rto_number, display_price, status")
    .neq("status", "Sold");

  if (p.company) q = q.ilike("company", `%${p.company}%`);
  if (p.model) q = q.ilike("model", `%${p.model}%`);
  if (p.year) q = q.eq("year", p.year);
  if (p.price_max) q = q.lte("display_price", p.price_max);
  if (p.price_min) q = q.gte("display_price", p.price_min);
  if (p.rto) q = q.ilike("rto_number", `%${p.rto}%`);

  switch (p.sort) {
    case "km_asc": q = q.order("km_covered", { ascending: true }); break;
    case "price_asc": q = q.order("display_price", { ascending: true }); break;
    case "price_desc": q = q.order("display_price", { ascending: false }); break;
    case "year_desc": q = q.order("year", { ascending: false }); break;
    default: q = q.order("display_price", { ascending: true });
  }

  const { data, error } = await q.range(offset, offset + 2);
  if (error) { console.error("[inventory] search error", error); return []; }
  return (data ?? []) as BikeRow[];
}

async function getBike(id: string): Promise<BikeRow | null> {
  const { data } = await supabaseAdmin
    .from("bikes")
    .select("id, company, model, year, km_covered, rto_number, display_price, status")
    .eq("id", id)
    .maybeSingle();
  return (data as BikeRow) ?? null;
}

// ----- Media -----

async function sendBikePhotos(phone: string, bike: BikeRow): Promise<string[]> {
  const { data: media } = await supabaseAdmin
    .from("bike_media")
    .select("file_url, media_type")
    .eq("bike_id", bike.id)
    .eq("media_type", "photo")
    .limit(3);

  const urls: string[] = [];
  for (const m of media ?? []) {
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
  const { data: media } = await supabaseAdmin
    .from("bike_media")
    .select("file_url")
    .eq("bike_id", bikeId)
    .eq("media_type", "video")
    .limit(1)
    .maybeSingle();
  if (!media) return null;
  const { data: signed } = await supabaseAdmin.storage
    .from("bike-media")
    .createSignedUrl((media as any).file_url, 3600);
  if (signed?.signedUrl) {
    await sendWhatsAppMedia(phone, signed.signedUrl, "video");
    return signed.signedUrl;
  }
  return null;
}

// ----- Negotiation engine -----

function priceForStep(displayPrice: number, step: number): number {
  const cap = Math.max(1, Math.min(NEGOTIATION_STEPS, step));
  const min = Math.round(displayPrice * (1 - NEGOTIATION_CAP));
  const offer = Math.round(displayPrice - ((displayPrice - min) * cap) / NEGOTIATION_STEPS);
  return Math.max(min, offer);
}

// ----- Lead creation -----

async function ensureLead(phone: string, bike: BikeRow, lastOfferedPrice: number | null) {
  const { data: existing } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("phone_number", phone)
    .eq("bike_id", bike.id)
    .not("status", "in", "(Sold,Lost)")
    .maybeSingle();

  const { data: msgs } = await supabaseAdmin
    .from("conversations")
    .select("sender, message, created_at")
    .eq("phone_number", phone)
    .order("created_at", { ascending: false })
    .limit(12);
  const summary = (msgs ?? [])
    .reverse()
    .map((m: any) => `${m.sender === "customer" ? "C" : "B"}: ${m.message}`)
    .join("\n")
    .slice(0, 1800);

  if (existing) {
    await supabaseAdmin.from("leads")
      .update({
        last_offered_price: lastOfferedPrice,
        conversation_summary: summary,
        bike_name: bikeDisplayName(bike),
      })
      .eq("id", (existing as any).id);
    return;
  }

  await supabaseAdmin.from("leads").insert({
    phone_number: phone,
    bike_id: bike.id,
    bike_name: bikeDisplayName(bike),
    last_offered_price: lastOfferedPrice,
    conversation_summary: summary,
    status: "New",
  });
}

// ----- Main handler -----

export async function handleVerifiedMessage(
  phone: string,
  message: string,
  currentBikeId: string | null,
  negotiationProgressRaw: string | null,
): Promise<{
  reply: string;
  newBikeId?: string | null;
  interested?: boolean;
  negotiationProgress?: string | null;
  media?: { url: string; type: "image" | "video" }[];
}> {
  const vocab = await loadInventoryVocab();
  const p = parseMessage(message, vocab);
  const progress = parseProgress(negotiationProgressRaw);

  // 1) Human escalation
  if (p.intent === "human") {
    await sendWhatsAppText(phone, ESCALATION_MESSAGE);
    return { reply: ESCALATION_MESSAGE };
  }

  // 2) Video request
  if (p.intent === "video") {
    if (currentBikeId) {
      const videoUrl = await sendBikeVideo(phone, currentBikeId);
      const reply = videoUrl ? "Video bheja hai. 📹" : "Is bike ka video abhi available nahi hai.";
      await sendWhatsAppText(phone, reply);
      return { reply, media: videoUrl ? [{ url: videoUrl, type: "video" }] : undefined };
    }
    const reply = "Pehle bataiye kaunsi bike chahiye, phir video bhejta hoon.";
    await sendWhatsAppText(phone, reply);
    return { reply };
  }

  // 3) Photo request
  if (p.intent === "photo") {
    if (currentBikeId) {
      const bike = await getBike(currentBikeId);
      if (bike) {
        const urls = await sendBikePhotos(phone, bike);
        const reply = urls.length > 0 ? "Photos bheja hai. 📸" : "Is bike ka photo abhi available nahi hai.";
        await sendWhatsAppText(phone, reply);
        return { reply, media: urls.map((url) => ({ url, type: "image" as const })) };
      }
    }
    const reply = "Pehle bataiye kaunsi bike chahiye, phir photo bhejta hoon.";
    await sendWhatsAppText(phone, reply);
    return { reply };
  }

  // 4) Negotiation
  if ((p.intent === "offer" || p.intent === "final_rate") && currentBikeId) {
    const bike = await getBike(currentBikeId);
    if (bike) {
      const minPrice = Math.round(bike.display_price * (1 - NEGOTIATION_CAP));
      const prevStep = progress && progress.bike_id === bike.id ? progress.step : 0;

      // final rate → straight to minimum
      if (p.intent === "final_rate") {
        const reply = `Best available price:\n${formatINR(minPrice)}`;
        await sendWhatsAppText(phone, reply);
        const np: NegotiationProgress = { bike_id: bike.id, step: NEGOTIATION_STEPS, last_offered_price: minPrice };
        return { reply, negotiationProgress: JSON.stringify(np), interested: true };
      }

      const offer = p.offered_price ?? null;

      // Below floor → refuse without revealing floor
      if (offer !== null && offer < minPrice) {
        const reply = "Sorry, itne mein possible nahi hai.";
        await sendWhatsAppText(phone, reply);
        return { reply };
      }

      // At/above display → accept
      if (offer !== null && offer >= bike.display_price) {
        const reply = `Bahut badhiya. Price ${formatINR(bike.display_price)} confirm hai.`;
        await sendWhatsAppText(phone, reply);
        const np: NegotiationProgress = { bike_id: bike.id, step: prevStep, last_offered_price: bike.display_price };
        return { reply, negotiationProgress: JSON.stringify(np), interested: true };
      }

      // Gradual step down
      const nextStep = Math.min(prevStep + 1, NEGOTIATION_STEPS);
      const ourPrice = priceForStep(bike.display_price, nextStep);
      const meetPrice = offer !== null && offer >= minPrice && offer < ourPrice ? offer : ourPrice;

      const reply =
        nextStep === 1
          ? `Thoda help kar sakte hain.\n\nCurrent available price:\n${formatINR(meetPrice)}`
          : nextStep >= NEGOTIATION_STEPS
            ? `Best available price:\n${formatINR(meetPrice)}`
            : `Thoda aur kam kar sakte hain.\n\nCurrent available price:\n${formatINR(meetPrice)}`;
      await sendWhatsAppText(phone, reply);
      const np: NegotiationProgress = { bike_id: bike.id, step: nextStep, last_offered_price: meetPrice };
      return { reply, negotiationProgress: JSON.stringify(np), interested: true };
    }
  }

  // 5) Interest yes (lead trigger)
  if (p.intent === "interest_yes" && currentBikeId) {
    const bike = await getBike(currentBikeId);
    if (bike) {
      const lastOffer = progress && progress.bike_id === bike.id ? progress.last_offered_price : null;
      await ensureLead(phone, bike, lastOffer);
      await sendWhatsAppText(phone, STORE_INFO_MESSAGE);
      return { reply: STORE_INFO_MESSAGE, interested: true };
    }
  }

  if (p.intent === "interest_no") {
    const reply = "Theek hai. Aur kaunsi bike dekhni hai? Company ya budget bataiye. 🙏";
    await sendWhatsAppText(phone, reply);
    return { reply };
  }

  // 6) Question about current bike (DB only)
  if (p.intent === "question" && currentBikeId && p.question_field !== "general") {
    const bike = await getBike(currentBikeId);
    if (bike) {
      let reply: string;
      switch (p.question_field) {
        case "rto": reply = `RTO: ${bike.rto_number}`; break;
        case "km": reply = `Ye bike ${bike.km_covered.toLocaleString("en-IN")} km chali hui hai.`; break;
        case "year": reply = `Ye ${bike.year} model hai.`; break;
        case "price": reply = `Price: ${formatINR(bike.display_price)}`; break;
        default: reply = formatSingleBike(bike);
      }
      await sendWhatsAppText(phone, reply);
      return { reply, interested: true };
    }
  }

  // 7) Greeting
  if (p.intent === "greeting") {
    await sendWhatsAppText(phone, GREETING_MESSAGE);
    return { reply: GREETING_MESSAGE };
  }

  // 8) Search / show_more / unknown → run SQL search
  const isSearchable =
    p.intent === "search" ||
    p.intent === "show_more" ||
    p.intent === "unknown";

  if (!isSearchable) {
    await sendWhatsAppText(phone, FALLBACK_MESSAGE);
    return { reply: FALLBACK_MESSAGE };
  }

  const results = await searchBikes(p);
  if (results.length === 0) {
    await sendWhatsAppText(phone, NO_RESULT_MESSAGE);
    return { reply: NO_RESULT_MESSAGE, newBikeId: null };
  }

  const top = results[0];
  const body = results.length === 1
    ? formatSingleBike(top) + INTEREST_PROMPT
    : formatMultipleBikes(results) + INTEREST_PROMPT;

  await sendWhatsAppText(phone, body);
  const photoUrls = await sendBikePhotos(phone, top);

  const resetProgress = progress && progress.bike_id !== top.id ? null : negotiationProgressRaw;

  return {
    reply: body,
    newBikeId: top.id,
    interested: true,
    negotiationProgress: resetProgress,
    media: photoUrls.map((url) => ({ url, type: "image" as const })),
  };
}
