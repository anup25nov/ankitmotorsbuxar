// AI Inventory Assistant + Negotiation + Lead Conversion (server-only).
// Phase 4 + Phase 5.
// Facts come ONLY from the database — the LLM is used for understanding only.

import { z } from "zod";
import { generateText } from "ai";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { sendWhatsAppText, sendWhatsAppMedia } from "./aisensy.server";

export const ESCALATION_MESSAGE = `Ankit Motors Buxar

Contact:
7050959444

Business Hours:
8 AM – 7 PM`;

export const STORE_INFO_MESSAGE = `Ankit Motors Buxar

Address:
Ahirauli, Buxar

Google Maps:
https://maps.google.com

Contact:
7050959444

Hours:
8 AM – 7 PM`;

// Global negotiation cap: never discount more than 3% off display price.
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
  step: number; // 0 = no offer yet; 1..NEGOTIATION_STEPS as we move toward min
  last_offered_price: number | null;
}

function parseProgress(raw: string | null): NegotiationProgress | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NegotiationProgress;
  } catch {
    return null;
  }
}

function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatBike(b: BikeRow): string {
  return [
    `🏍️ ${b.company} ${b.model} (${b.year})`,
    `KM: ${b.km_covered.toLocaleString("en-IN")} km`,
    `RTO: ${b.rto_number}`,
    `Price: ${formatINR(b.display_price)}`,
  ].join("\n");
}

function bikeDisplayName(b: BikeRow): string {
  return `${b.company} ${b.model} (${b.year})`;
}

const InterpretationSchema = z.object({
  intent: z
    .enum([
      "search",
      "question",
      "show_more",
      "video",
      "human",
      "offer",
      "final_rate",
      "interest_yes",
      "interest_no",
      "other",
    ])
    .catch("other"),
  company: z.string().nullish().catch(null),
  model: z.string().nullish().catch(null),
  year: z.coerce.number().nullish().catch(null),
  price_max: z.coerce.number().nullish().catch(null),
  price_min: z.coerce.number().nullish().catch(null),
  offered_price: z.coerce.number().nullish().catch(null),
  sort: z.enum(["km_asc", "price_asc", "none"]).catch("none"),
  rto: z.string().nullish().catch(null),
  question_field: z
    .enum(["rto", "km", "year", "price", "general", "none"])
    .catch("none"),
});

type Interpretation = z.infer<typeof InterpretationSchema>;

async function getInventoryVocab(): Promise<{
  companies: string[];
  models: string[];
}> {
  const { data } = await supabaseAdmin.from("bikes").select("company, model");
  const companies = Array.from(
    new Set((data ?? []).map((r: any) => r.company)),
  );
  const models = Array.from(new Set((data ?? []).map((r: any) => r.model)));
  return { companies, models };
}

async function interpret(
  message: string,
  vocab: { companies: string[]; models: string[] },
): Promise<Interpretation | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    console.error("[inventory-ai] LOVABLE_API_KEY missing");
    return null;
  }

  const gateway = createLovableAiGatewayProvider(key);

  const system = `You are the parser for a used motorcycle dealership in Bihar, India.
Customers write in Hindi, English, or Hinglish, often with typos, slang, or Devanagari script.
Convert ONE customer message into structured fields. Do NOT answer the customer.

Available companies: ${vocab.companies.join(", ") || "(none)"}
Available models: ${vocab.models.join(", ") || "(none)"}

Rules:
- Map fuzzy/misspelled/Devanagari names to closest available company/model EXACTLY as listed above (e.g. "apachi","apache","अपाची","rtr" -> "Apache"). Else null.
- "80k tak/ke andar/under" -> price_max 80000. "k"=1000, "lakh"/"lac"=100000.
- "kam chalne wali"/"low km" -> sort "km_asc". "sasta"/"cheapest" -> sort "price_asc".
- 4-digit number like 2023 is a year. "br01" is RTO.
- intent "search": wants to see bikes / applies filters.
- intent "question": asking a bike's detail. Set question_field.
- intent "show_more": "aur dikhao","more","next","aur bike".
- intent "video": asks for video.
- intent "human": wants owner / phone / call.
- intent "offer": customer proposes/negotiates a price (e.g. "75k final","79 kar do","75000 me dedo"). Put the number in offered_price.
- intent "final_rate": asks for the lowest/last price ("final rate","best price","last price","kam se kam","aakhri rate").
- intent "interest_yes": confirms wanting this bike / wants to visit / book / asks for location/address ("haan chahiye","book karna hai","visit karunga","location bhejiye","aa raha hu","interested hu","le lunga","bike dekhni hai").
- intent "interest_no": rejects this bike ("nahi chahiye","pasand nahi").
- intent "other": greeting/unclear.
Use null for any field not present.`;

  try {
    const { text } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system: `${system}

Respond with ONLY a JSON object (no markdown, no code fences) using exactly these keys:
{"intent","company","model","year","price_max","price_min","offered_price","sort","rto","question_field"}`,
      prompt: message,
    });

    const cleaned = text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    const result = InterpretationSchema.safeParse(parsed);
    if (!result.success) {
      console.error("[inventory-ai] schema parse failed", result.error.message);
      return null;
    }
    return result.data;
  } catch (err) {
    console.error("[inventory-ai] interpret error", err);
    return null;
  }
}

async function searchBikes(i: Interpretation): Promise<BikeRow[]> {
  let q = supabaseAdmin
    .from("bikes")
    .select("id, company, model, year, km_covered, rto_number, display_price, status")
    .neq("status", "Sold");

  if (i.company) q = q.ilike("company", `%${i.company}%`);
  if (i.model) q = q.ilike("model", `%${i.model}%`);
  if (i.year) q = q.eq("year", i.year);
  if (i.price_max) q = q.lte("display_price", i.price_max);
  if (i.price_min) q = q.gte("display_price", i.price_min);
  if (i.rto) q = q.ilike("rto_number", `%${i.rto}%`);

  if (i.sort === "km_asc") q = q.order("km_covered", { ascending: true });
  else if (i.sort === "price_asc") q = q.order("display_price", { ascending: true });
  else q = q.order("display_price", { ascending: true });

  const { data, error } = await q.limit(3);
  if (error) {
    console.error("[inventory-ai] search error", error);
    return [];
  }
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

async function sendBikePhotos(
  phone: string,
  bike: BikeRow,
): Promise<string[]> {
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

async function sendBikeVideo(
  phone: string,
  bikeId: string,
): Promise<string | null> {
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


/**
 * Compute the next price the AI is willing to quote, given the current
 * negotiation step. Step 0 = full display price, step NEGOTIATION_STEPS = min.
 * Never crosses below the per-bike minimum (display - 3%).
 */
function priceForStep(displayPrice: number, step: number): number {
  const cap = Math.max(1, Math.min(NEGOTIATION_STEPS, step));
  const min = Math.round(displayPrice * (1 - NEGOTIATION_CAP));
  const offer = Math.round(
    displayPrice - ((displayPrice - min) * cap) / NEGOTIATION_STEPS,
  );
  return Math.max(min, offer);
}

async function ensureLead(
  phone: string,
  bike: BikeRow,
  lastOfferedPrice: number | null,
) {
  // Idempotent: if an active (non-Lost/Sold) lead for this customer+bike
  // already exists, just update its last_offered_price.
  const { data: existing } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("phone_number", phone)
    .eq("bike_id", bike.id)
    .not("status", "in", "(Sold,Lost)")
    .maybeSingle();

  // Build a short conversation summary from the most recent messages.
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
    await supabaseAdmin
      .from("leads")
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

/**
 * Handle a message from a Bihar-verified customer. Returns the bot reply text
 * that was sent plus any state updates to persist.
 */
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

  const vocab = await getInventoryVocab();
  const i = await interpret(message, vocab);

  if (!i) {
    const reply =
      "Maaf kijiye, abhi samajh nahi paaya. Aap bike ka naam, budget ya model bhej sakte hain. 🙏";
    await sendWhatsAppText(phone, reply);
    return { reply };
  }

  // Human escalation
  if (i.intent === "human") {
    await sendWhatsAppText(phone, ESCALATION_MESSAGE);
    return { reply: ESCALATION_MESSAGE };
  }

  // Video request
  if (i.intent === "video") {
    if (currentBikeId) {
      const videoUrl = await sendBikeVideo(phone, currentBikeId);
      const reply = videoUrl
        ? "Video bheja hai. 📹"
        : "Is bike ka video abhi available nahi hai.";
      await sendWhatsAppText(phone, reply);
      return {
        reply,
        media: videoUrl ? [{ url: videoUrl, type: "video" }] : undefined,
      };
    }
    const reply = "Pehle bataiye kaunsi bike chahiye, phir video bhejta hoon.";
    await sendWhatsAppText(phone, reply);
    return { reply };
  }


  const progress = parseProgress(negotiationProgressRaw);

  // -------------------- PHASE 5: NEGOTIATION --------------------
  if ((i.intent === "offer" || i.intent === "final_rate") && currentBikeId) {
    const bike = await getBike(currentBikeId);
    if (bike) {
      const minPrice = Math.round(bike.display_price * (1 - NEGOTIATION_CAP));
      const prevStep =
        progress && progress.bike_id === bike.id ? progress.step : 0;

      // Customer asks for final/best rate -> go straight to minimum.
      if (i.intent === "final_rate") {
        const reply = `Best available price:\n${formatINR(minPrice)}`;
        await sendWhatsAppText(phone, reply);
        const newProgress: NegotiationProgress = {
          bike_id: bike.id,
          step: NEGOTIATION_STEPS,
          last_offered_price: minPrice,
        };
        return {
          reply,
          negotiationProgress: JSON.stringify(newProgress),
          interested: true,
        };
      }

      // Customer made a numeric offer.
      const customerOffer = i.offered_price ?? null;

      // Offer below the floor -> refuse without revealing the floor.
      if (customerOffer !== null && customerOffer < minPrice) {
        const reply = "Sorry, that price is not possible.";
        await sendWhatsAppText(phone, reply);
        return { reply };
      }

      // Offer at or above display -> accept at display.
      if (customerOffer !== null && customerOffer >= bike.display_price) {
        const reply = `Bahut badhiya. Price ${formatINR(bike.display_price)} confirm hai.`;
        await sendWhatsAppText(phone, reply);
        const newProgress: NegotiationProgress = {
          bike_id: bike.id,
          step: prevStep,
          last_offered_price: bike.display_price,
        };
        return {
          reply,
          negotiationProgress: JSON.stringify(newProgress),
          interested: true,
        };
      }

      // Gradual negotiation: advance one step toward the floor.
      const nextStep = Math.min(prevStep + 1, NEGOTIATION_STEPS);
      const ourPrice = priceForStep(bike.display_price, nextStep);
      // If customer's offer is between our step price and the floor, meet them there.
      const meetPrice =
        customerOffer !== null && customerOffer >= minPrice && customerOffer < ourPrice
          ? customerOffer
          : ourPrice;

      const reply =
        nextStep === 1
          ? `I can help slightly.\n\nCurrent available price:\n${formatINR(meetPrice)}`
          : nextStep >= NEGOTIATION_STEPS
            ? `Best available price:\n${formatINR(meetPrice)}`
            : `Thoda aur kam kar sakta hoon.\n\nCurrent available price:\n${formatINR(meetPrice)}`;
      await sendWhatsAppText(phone, reply);

      const newProgress: NegotiationProgress = {
        bike_id: bike.id,
        step: nextStep,
        last_offered_price: meetPrice,
      };
      return {
        reply,
        negotiationProgress: JSON.stringify(newProgress),
        interested: true,
      };
    }
  }

  // -------------------- PHASE 5: INTEREST + LEAD --------------------
  if (i.intent === "interest_yes" && currentBikeId) {
    const bike = await getBike(currentBikeId);
    if (bike) {
      const lastOffer =
        progress && progress.bike_id === bike.id
          ? progress.last_offered_price
          : null;
      await ensureLead(phone, bike, lastOffer);
      await sendWhatsAppText(phone, STORE_INFO_MESSAGE);
      return {
        reply: STORE_INFO_MESSAGE,
        interested: true,
      };
    }
  }

  if (i.intent === "interest_no") {
    const reply =
      "Theek hai. Aur kaunsi bike dekhni hai? Company ya budget bataiye. 🙏";
    await sendWhatsAppText(phone, reply);
    return { reply };
  }

  // Question about the current bike (answer ONLY from DB)
  if (
    i.intent === "question" &&
    currentBikeId &&
    i.question_field !== "general"
  ) {
    const bike = await getBike(currentBikeId);
    if (bike) {
      let reply: string;
      switch (i.question_field) {
        case "rto":
          reply = `RTO: ${bike.rto_number}`;
          break;
        case "km":
          reply = `Ye bike ${bike.km_covered.toLocaleString("en-IN")} km chali hui hai.`;
          break;
        case "year":
          reply = `Ye ${bike.year} model hai.`;
          break;
        case "price":
          reply = `Price: ${formatINR(bike.display_price)}`;
          break;
        default:
          reply = formatBike(bike);
      }
      await sendWhatsAppText(phone, reply);
      return { reply, interested: true };
    }
  }

  // search / show_more / general -> run inventory search
  const results = await searchBikes(i);

  if (results.length === 0) {
    const reply =
      "Is samay aapki requirement ke hisaab se koi bike available nahi hai. Kuch aur batayein? 🙏";
    await sendWhatsAppText(phone, reply);
    return { reply, newBikeId: null };
  }

  const header =
    results.length === 1
      ? "Ye bike available hai:"
      : `${results.length} bikes mili hain:`;
  const body = results.map(formatBike).join("\n\n");
  // After a few interactions, prompt for interest.
  const interestPrompt = `\n\nKya aapko ye bike chahiye?\n\n✅ Haan\n❌ Nahi\n🔄 Aur bike dikhao`;
  const reply = `${header}\n\n${body}${interestPrompt}`;
  await sendWhatsAppText(phone, reply);

  const top = results[0];
  await sendBikePhotos(phone, top);

  // Switching bikes resets negotiation progress.
  const resetProgress =
    progress && progress.bike_id !== top.id ? null : negotiationProgressRaw;

  return {
    reply,
    newBikeId: top.id,
    interested: true,
    negotiationProgress: resetProgress,
  };
}
