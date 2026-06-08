// Rule-based Hindi/Hinglish parser. NO LLM.
// Converts a raw customer message into a structured Intent + Filters object
// using dictionaries, regex, and Levenshtein fuzzy matching against the
// live inventory vocabulary loaded from PostgreSQL.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Intent =
  | "search"
  | "question"
  | "show_more"
  | "video"
  | "photo"
  | "human"
  | "offer"
  | "final_rate"
  | "interest_yes"
  | "interest_no"
  | "greeting"
  | "unknown";

export type QuestionField = "rto" | "km" | "year" | "price" | "general" | "none";

export interface ParsedMessage {
  intent: Intent;
  company: string | null;
  model: string | null;
  year: number | null;
  price_max: number | null;
  price_min: number | null;
  offered_price: number | null;
  sort: "km_asc" | "price_asc" | "price_desc" | "year_desc" | "none";
  rto: string | null;
  question_field: QuestionField;
}

// ---------------- Dictionaries ----------------

// Brand aliases → canonical company name. Keys are normalized (lowercased, no diacritics).
const COMPANY_ALIASES: Record<string, string> = {
  // Hero
  hero: "Hero", "hero motocorp": "Hero", "hiro": "Hero",
  // Honda
  honda: "Honda", "hoda": "Honda",
  // TVS
  tvs: "TVS",
  // Bajaj
  bajaj: "Bajaj", "bajj": "Bajaj", "bajjaj": "Bajaj",
  // Yamaha
  yamaha: "Yamaha", "yamha": "Yamaha", "yamah": "Yamaha", "yemaha": "Yamaha",
  // Suzuki
  suzuki: "Suzuki", "suzki": "Suzuki",
  // Royal Enfield
  "royal enfield": "Royal Enfield", "re": "Royal Enfield", "enfield": "Royal Enfield",
  bullet: "Royal Enfield", "royalenfield": "Royal Enfield",
  // KTM
  ktm: "KTM",
};

// Model aliases → canonical model name (best-effort; live DB is the truth).
const MODEL_ALIASES: Record<string, string> = {
  // TVS Apache family
  apache: "Apache", apachi: "Apache", apace: "Apache", rtr: "Apache",
  "अपाची": "Apache",
  // Bajaj Pulsar
  pulsar: "Pulsar", pulsr: "Pulsar", pulser: "Pulsar", "पल्सर": "Pulsar",
  // Bajaj Platina / Discover
  platina: "Platina", discover: "Discover",
  // Hero Splendor / Passion / Glamour / HF Deluxe
  splendor: "Splendor", splender: "Splendor", "स्प्लेंडर": "Splendor",
  passion: "Passion", glamour: "Glamour", "hf deluxe": "HF Deluxe",
  // Honda Shine / Activa / Unicorn / SP125
  shine: "Shine", activa: "Activa", aktiva: "Activa", "एक्टिवा": "Activa",
  unicorn: "Unicorn", sp125: "SP 125", "sp 125": "SP 125",
  // Yamaha FZ / R15 / MT15
  fz: "FZ", "fz s": "FZ", fzs: "FZ", r15: "R15", mt15: "MT 15", "mt 15": "MT 15",
  // Suzuki Access / Gixxer
  access: "Access", gixxer: "Gixxer",
  // Royal Enfield Classic / Bullet / Meteor / Hunter
  classic: "Classic", meteor: "Meteor", hunter: "Hunter",
  // KTM Duke
  duke: "Duke",
};

// Hindi/Hinglish keyword maps.
const AFFIRM_WORDS = ["✅", "haan", "haa", "ha", "hn", "yes", "ok", "okay", "theek", "thik", "sahi"];
const NEGATIVE_WORDS = ["❌", "nahi", "nai", "nhi", "no", "mat", "band"];
const HUMAN_WORDS = ["call", "phone", "number", "owner", "malik", "baat", "human", "person", "manager", "direct"];
const VIDEO_WORDS = ["video", "vdo", "वीडियो"];
const PHOTO_WORDS = ["photo", "image", "pic", "picture", "tasveer", "तस्वीर", "फोटो"];
const SHOW_MORE_WORDS = ["aur", "more", "next", "next one", "aage", "dusra", "doosra", "alag"];
const FINAL_RATE_WORDS = [
  "final rate", "final price", "last price", "last rate", "best price", "best rate",
  "kam se kam", "minimum", "aakhri", "akhri", "lowest"
];
const INTEREST_YES_WORDS = [
  "le lunga", "le lungi", "le lenge", "book", "booking", "visit", "aaunga", "aaungi",
  "aa raha", "aa rhi", "aa rha", "interested", "chahiye", "chahta", "chahti",
  "location", "address", "dukan", "showroom", "kaha hai", "kahan", "kab khulta",
  "milte hain", "milna", "dekhna", "dikhao", "khareed", "kharid", "lunga", "lungi"
];
const INTEREST_NO_WORDS = ["nahi chahiye", "pasand nahi", "mat dikhao", "skip"];
const GREETING_WORDS = ["hi", "hello", "hey", "namaste", "namaskar", "ram ram", "salaam", "good morning", "good evening"];

const QUESTION_FIELD_PATTERNS: { field: QuestionField; words: string[] }[] = [
  { field: "rto", words: ["rto", "br0", "br ", "number plate", "registration"] },
  { field: "km", words: ["km", "kilometer", "chala", "chali", "chalne", "running"] },
  { field: "year", words: ["year", "model year", "kab ka", "kis saal"] },
  { field: "price", words: ["price", "rate", "kitne", "kitna", "daam", "keemat", "cost"] },
];

const SORT_PATTERNS: { sort: ParsedMessage["sort"]; words: string[] }[] = [
  { sort: "km_asc", words: ["kam chali", "kam chala", "low km", "least km", "kam km", "minimum km"] },
  { sort: "price_asc", words: ["sasta", "sasti", "cheapest", "cheap", "budget me", "kam paise"] },
  { sort: "price_desc", words: ["mehnga", "premium", "top model", "high end"] },
  { sort: "year_desc", words: ["latest", "naya", "new model", "recent"] },
];

// ---------------- Helpers ----------------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[।.,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

// Levenshtein distance (iterative, O(m*n)).
function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

// Fuzzy match a token against a list of canonical values. Returns the best
// match if edit distance is within tolerance.
function fuzzyPick(token: string, candidates: string[]): string | null {
  if (!token || candidates.length === 0) return null;
  const t = token.toLowerCase();
  let best: { val: string; d: number } | null = null;
  for (const c of candidates) {
    const cn = c.toLowerCase();
    if (cn === t) return c;
    if (cn.includes(t) || t.includes(cn)) return c;
    const d = lev(t, cn);
    if (!best || d < best.d) best = { val: c, d };
  }
  if (!best) return null;
  const tol = Math.max(1, Math.floor(best.val.length / 4));
  return best.d <= tol ? best.val : null;
}

// Parse Indian-style numbers: "80k", "80 thousand", "1.5 lakh", "75000".
function parseAmount(text: string): number | null {
  const t = text.replace(/[,₹\s]/g, " ").toLowerCase();
  // lakh / lac
  const lakh = t.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|lacs|lakhs)/);
  if (lakh) return Math.round(parseFloat(lakh[1]) * 100000);
  // k / thousand / hazaar
  const k = t.match(/(\d+(?:\.\d+)?)\s*(?:k\b|thousand|hazaar|hazar)/);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  // plain >= 4 digits assumed rupees
  const plain = t.match(/\b(\d{4,7})\b/);
  if (plain) return parseInt(plain[1], 10);
  return null;
}

// Detect "X tak / under X / X ke andar / X me" → price_max.
function detectPriceMax(text: string): number | null {
  if (
    /\b(tak|under|andar|niche|below|me\b|mein\b|budget)\b/.test(text) ||
    /\b(upto|up to|max|maximum)\b/.test(text)
  ) {
    return parseAmount(text);
  }
  return null;
}

// Detect "X se upar / above X / X+" → price_min.
function detectPriceMin(text: string): number | null {
  if (/\b(upar|above|over|more than|se zyada|se jyada)\b/.test(text)) {
    return parseAmount(text);
  }
  return null;
}

function detectYear(text: string): number | null {
  const m = text.match(/\b(19[89]\d|20[0-3]\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

function detectRto(text: string): string | null {
  const m = text.match(/\b(br[\s-]?\d{1,2})\b/i);
  return m ? m[1].replace(/[\s-]/g, "").toUpperCase() : null;
}

function detectSort(text: string): ParsedMessage["sort"] {
  for (const { sort, words } of SORT_PATTERNS) {
    if (containsAny(text, words)) return sort;
  }
  return "none";
}

function detectQuestionField(text: string): QuestionField {
  for (const { field, words } of QUESTION_FIELD_PATTERNS) {
    if (containsAny(text, words)) return field;
  }
  return "none";
}

// ---------------- Public API ----------------

export interface InventoryVocab {
  companies: string[];
  models: string[];
}

export async function loadInventoryVocab(): Promise<InventoryVocab> {
  const { data } = await supabaseAdmin.from("bikes").select("company, model");
  const companies = Array.from(new Set((data ?? []).map((r: any) => r.company)));
  const models = Array.from(new Set((data ?? []).map((r: any) => r.model)));
  return { companies, models };
}

function matchCompany(text: string, vocab: InventoryVocab): string | null {
  // 1. alias dictionary
  for (const alias of Object.keys(COMPANY_ALIASES)) {
    if (text.includes(alias)) {
      const canonical = COMPANY_ALIASES[alias];
      // confirm it exists in DB (case-insensitive)
      const hit = vocab.companies.find((c) => c.toLowerCase() === canonical.toLowerCase());
      if (hit) return hit;
    }
  }
  // 2. fuzzy against live vocabulary, token by token
  for (const token of text.split(" ")) {
    if (token.length < 3) continue;
    const m = fuzzyPick(token, vocab.companies);
    if (m) return m;
  }
  return null;
}

function matchModel(text: string, vocab: InventoryVocab): string | null {
  // 1. alias dictionary (supports multi-word like "sp 125")
  for (const alias of Object.keys(MODEL_ALIASES)) {
    if (text.includes(alias)) {
      const canonical = MODEL_ALIASES[alias];
      const hit = vocab.models.find((m) => m.toLowerCase() === canonical.toLowerCase());
      if (hit) return hit;
      // Even if not in vocab right now, return canonical for ILIKE search.
      return canonical;
    }
  }
  // 2. fuzzy against live vocabulary
  for (const token of text.split(" ")) {
    if (token.length < 3) continue;
    const m = fuzzyPick(token, vocab.models);
    if (m) return m;
  }
  return null;
}

export function parseMessage(raw: string, vocab: InventoryVocab): ParsedMessage {
  const text = normalize(raw);

  const result: ParsedMessage = {
    intent: "unknown",
    company: null,
    model: null,
    year: null,
    price_max: null,
    price_min: null,
    offered_price: null,
    sort: "none",
    rto: null,
    question_field: "none",
  };

  // ---- Pure intent shortcuts (no inventory data needed) ----
  if (containsAny(text, HUMAN_WORDS)) {
    result.intent = "human";
    return result;
  }
  if (containsAny(text, VIDEO_WORDS)) {
    result.intent = "video";
    return result;
  }
  if (containsAny(text, PHOTO_WORDS)) {
    result.intent = "photo";
    return result;
  }
  if (containsAny(text, FINAL_RATE_WORDS)) {
    result.intent = "final_rate";
    return result;
  }

  // ---- Filters that may co-exist with search/question intents ----
  result.company = matchCompany(text, vocab);
  result.model = matchModel(text, vocab);
  result.year = detectYear(text);
  result.rto = detectRto(text);
  result.price_max = detectPriceMax(text);
  result.price_min = detectPriceMin(text);
  result.sort = detectSort(text);

  // ---- Numeric offer (negotiation) ----
  const amount = parseAmount(text);
  const looksLikeOffer =
    amount !== null &&
    /\b(de\s?do|dedo|me\s?do|kar\s?do|final|le\s?lo|mil\s?jaye|chalega|ok\s?kar)\b/.test(text);
  if (looksLikeOffer) {
    result.intent = "offer";
    result.offered_price = amount;
    return result;
  }

  // ---- Interest yes/no (high-intent lead triggers) ----
  if (containsAny(text, INTEREST_NO_WORDS)) {
    result.intent = "interest_no";
    return result;
  }
  if (containsAny(text, INTEREST_YES_WORDS)) {
    result.intent = "interest_yes";
    return result;
  }

  // ---- Question about current bike ----
  const qf = detectQuestionField(text);
  if (qf !== "none") {
    result.intent = "question";
    result.question_field = qf;
    return result;
  }

  // ---- Show more ----
  if (containsAny(text, SHOW_MORE_WORDS) && !result.company && !result.model) {
    result.intent = "show_more";
    return result;
  }

  // ---- Search (any filter found) ----
  if (
    result.company ||
    result.model ||
    result.price_max ||
    result.price_min ||
    result.year ||
    result.rto ||
    result.sort !== "none"
  ) {
    result.intent = "search";
    return result;
  }

  // ---- Pure affirm/negative as last resort ----
  if (containsAny(text, AFFIRM_WORDS)) {
    result.intent = "interest_yes";
    return result;
  }
  if (containsAny(text, NEGATIVE_WORDS)) {
    result.intent = "interest_no";
    return result;
  }
  if (containsAny(text, GREETING_WORDS)) {
    result.intent = "greeting";
    return result;
  }

  return result;
}

// Re-export helpers for testing.
export const __internal = { lev, fuzzyPick, parseAmount, normalize };
