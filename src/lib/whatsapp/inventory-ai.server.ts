// AI Inventory Assistant (server-only).
// Understands Hindi/English/Hinglish (incl. typos & Devanagari), converts the
// customer message into structured inventory filters, searches real inventory,
// and produces grounded replies. Facts come ONLY from the database — the LLM is
// used for understanding, never for stating inventory facts.

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

const InterpretationSchema = z.object({
  intent: z
    .enum(["search", "question", "show_more", "video", "human", "other"])
    .catch("other"),
  company: z.string().nullish().catch(null),
  model: z.string().nullish().catch(null),
  year: z.coerce.number().nullish().catch(null),
  price_max: z.coerce.number().nullish().catch(null),
  price_min: z.coerce.number().nullish().catch(null),
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
  const { data } = await supabaseAdmin
    .from("bikes")
    .select("company, model");
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
Convert ONE customer message into structured search/intent fields. Do NOT answer the customer.

Available companies: ${vocab.companies.join(", ") || "(none)"}
Available models: ${vocab.models.join(", ") || "(none)"}

Rules:
- Map fuzzy/misspelled/Devanagari bike names to the closest available company or model EXACTLY as listed above (e.g. "apachi", "apache", "अपाची", "rtr" -> "Apache"). If nothing matches, use null.
- "80k tak/ke andar/under" -> price_max 80000. "k" means thousand, "lakh"/"lac" means 100000.
- "kam chalne wali"/"low km"/"kam chala" -> sort "km_asc". "sasta"/"cheapest" -> sort "price_asc".
- A 4-digit number like 2023 is a year. Short codes like "br01", "br 01" are RTO values.
- intent "search": customer wants to see bikes / applies filters.
- intent "question": asking about a bike's detail (RTO, KM, year, price). Set question_field.
- intent "show_more": "aur dikhao", "more", "next".
- intent "video": asks for video.
- intent "human": wants to talk to owner / phone number / call.
- intent "other": greeting/unclear.
Use null for any field not present.`;

  try {
    const { text } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system: `${system}

Respond with ONLY a JSON object (no markdown, no code fences) using exactly these keys:
{"intent","company","model","year","price_max","price_min","sort","rto","question_field"}`,
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

async function sendBikePhotos(phone: string, bike: BikeRow) {
  const { data: media } = await supabaseAdmin
    .from("bike_media")
    .select("file_url, media_type")
    .eq("bike_id", bike.id)
    .eq("media_type", "photo")
    .limit(3);

  for (const m of media ?? []) {
    const { data: signed } = await supabaseAdmin.storage
      .from("bike-media")
      .createSignedUrl((m as any).file_url, 3600);
    if (signed?.signedUrl) {
      await sendWhatsAppMedia(phone, signed.signedUrl, "image");
    }
  }
}

async function sendBikeVideo(phone: string, bikeId: string): Promise<boolean> {
  const { data: media } = await supabaseAdmin
    .from("bike_media")
    .select("file_url")
    .eq("bike_id", bikeId)
    .eq("media_type", "video")
    .limit(1)
    .maybeSingle();
  if (!media) return false;
  const { data: signed } = await supabaseAdmin.storage
    .from("bike-media")
    .createSignedUrl((media as any).file_url, 3600);
  if (signed?.signedUrl) {
    await sendWhatsAppMedia(phone, signed.signedUrl, "video");
    return true;
  }
  return false;
}

/**
 * Handle a message from a Bihar-verified customer. Returns the bot reply text
 * that was sent (media is sent separately) and any state updates to persist.
 */
export async function handleVerifiedMessage(
  phone: string,
  message: string,
  currentBikeId: string | null,
): Promise<{ reply: string; newBikeId?: string | null; interested?: boolean }> {
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

  // Video request for the currently viewed bike
  if (i.intent === "video") {
    if (currentBikeId) {
      const sent = await sendBikeVideo(phone, currentBikeId);
      const reply = sent
        ? "Video bheja hai. 📹"
        : "Is bike ka video abhi available nahi hai.";
      await sendWhatsAppText(phone, reply);
      return { reply };
    }
    const reply = "Pehle bataiye kaunsi bike chahiye, phir video bhejta hoon.";
    await sendWhatsAppText(phone, reply);
    return { reply };
  }

  // Question about the current bike (answer ONLY from DB)
  if (i.intent === "question" && currentBikeId && i.question_field !== "general") {
    const { data: bike } = await supabaseAdmin
      .from("bikes")
      .select("id, company, model, year, km_covered, rto_number, display_price, status")
      .eq("id", currentBikeId)
      .maybeSingle();
    if (bike) {
      const b = bike as BikeRow;
      let reply: string;
      switch (i.question_field) {
        case "rto":
          reply = `RTO: ${b.rto_number}`;
          break;
        case "km":
          reply = `Ye bike ${b.km_covered.toLocaleString("en-IN")} km chali hui hai.`;
          break;
        case "year":
          reply = `Ye ${b.year} model hai.`;
          break;
        case "price":
          reply = `Price: ${formatINR(b.display_price)}`;
          break;
        default:
          reply = formatBike(b);
      }
      await sendWhatsAppText(phone, reply);
      return { reply, interested: true };
    }
  }

  // search / show_more / general question -> run inventory search
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
  const reply = `${header}\n\n${body}`;
  await sendWhatsAppText(phone, reply);

  // Send photos for the top match and remember it as the current bike.
  const top = results[0];
  await sendBikePhotos(phone, top);

  return { reply, newBikeId: top.id, interested: true };
}
