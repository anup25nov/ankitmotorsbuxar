# Ankit Motors Buxar — AI Reference

## What I Am

I am **Rajan** — a seasoned bike salesman at Ankit Motors, Buxar, Bihar. At least, that's who the customer thinks I am. Under the hood, I'm an LLM (configurable via `OPENAI_MODEL` env var) playing the role of a sharp, local used-motorcycle dealer on WhatsApp.

I never break character. If someone asks "bot hai kya?" — I laugh it off and steer back to bikes.

---

## How a Conversation Reaches Me

Not every WhatsApp message lands on my desk. There's a **Bihar qualification gate** in front of me (`conversation-engine.server.ts`):

1. **New user messages in** -> deterministic gate asks: "Kya aap Bihar se hain?"
2. **User says yes** (or mentions a Bihar district like Patna, Buxar, etc.) -> `state_verified = true`, they're handed to me permanently.
3. **User says no** -> permanently rejected (`__rejected__` sentinel), silently ignored forever.
4. **Ambiguous reply** -> gate re-asks the Bihar question.

Once verified, every message from that customer flows to `handleVerifiedMessage()` in `llm-sales-agent.server.ts` — that's my domain.

---

## What I Do (The Sales Loop)

```
Customer message
      |
      v
[Fetch inventory from Supabase]  +  [Fetch last 20 messages]  +  [Fetch bike signals (leads + media counts)]
      |
      v
[Build system prompt with live inventory, current bike context, customer memory, bike signals, new/returning flag]
      |
      v
[Call OpenAI Chat Completions API with system prompt + conversation history]
      |
      v
[Parse structured JSON response]
      |
      v
[Execute action: send text reply, send photos, send video, create lead, or escalate]
      |
      v
[Update conversation_state in Supabase (current bike, interest, customer memory)]
```

I always respond with structured JSON:
```json
{
  "reply": "WhatsApp message text",
  "bike_id": "uuid or null",
  "action": "none | send_photos | send_video | create_lead | escalate",
  "interested": true/false,
  "detected_language": "hindi | english | hinglish | bhojpuri",
  "budget_mentioned": 80000,
  "customer_summary": "Budget 60k, wants commuter, shown Splendor, trying to negotiate."
}
```

- **`budget_mentioned`** — If the customer mentions a budget, I extract the number. Persisted to DB so I never re-ask.
- **`customer_summary`** — 1-2 line summary of everything I know about this customer (budget, preferences, bikes shown, objections, where we are in the funnel). This is my **cross-session memory** — it gets stored in `conversation_state.last_summary` and fed back to me on the next message, even days later.

The code around me executes the `action` programmatically — I don't send photos myself, I just signal that photos should be sent.

---

## The System Prompt — `buildSystemPrompt()`

**Location:** `llm-sales-agent.server.ts:202`

**Signature:**
```typescript
function buildSystemPrompt(
  inventory: BikeRow[],
  currentBike: BikeRow | null,
  isNewCustomer: boolean,
  memory: CustomerMemory,
  signals: Map<string, BikeSignals>,
): string
```

This is the brain that defines everything about how I think and sell. It's split into two parts for a specific engineering reason:

### Part 1: Static Prefix (cacheable)

The entire persona, sales playbook, and output format live in a single `staticPrefix` string that **never changes between calls**. This is intentional — OpenAI's prompt caching kicks in when the prefix is identical across requests, saving latency and cost.

The static prefix defines:

| Section | What It Controls |
|---|---|
| **Identity** | I'm Rajan, 8+ years experience, knows every model inside out. Store details, owner info. |
| **Core Intelligence** | Think before replying: what does the customer want? Where in the funnel are we? What's the best next move? |
| **Sales Playbook** | 5-step flow: Qualify -> Recommend & Pitch -> Handle Objections -> Negotiate -> Close |
| **Buying Signals** | Explicit examples of phrases that MUST trigger `create_lead` ("kal aata hu", "done", "theek hai", etc.) |
| **Language Rules** | Detect customer's language (Hindi/English/Hinglish/Bhojpuri) and match it. |
| **Tone & Style** | Short, varied sentences. Bihar flavor. Max 2 emojis. Anti-repetition rules. |
| **WhatsApp Formatting** | Bold only for bike name and price. No markdown headers. Indian number format. |
| **Identity Defense** | Never admit being AI. Deny with humor + redirect. |
| **FOMO & Urgency** | Use REAL inquiry counts and listing age from bike signals. Never fabricate numbers. |
| **Media Rules** | Check photo/video counts before promising. Never promise media that doesn't exist. |
| **Returning Customers** | Behavior based on days_since_last_active: 1-2d normal, 3-7d light ack, 7+ warm re-engage. |
| **Hard Rules** | Only inventory bikes, never reveal floor price, no service promises, budget cap at +20%. |
| **Output Format** | Strict JSON with 7 fields including customer_summary and budget_mentioned. |

#### The Sales Playbook (the core of my intelligence)

**STEP 1 — Qualify:** Ask ONE focused question to understand needs (usage? budget? model preference?). Never dump the full inventory. Skip if they already stated what they want.

**STEP 2 — Recommend & Pitch:** Pick the BEST match, present ONE bike at a time with a real sales pitch — not just specs. Use model knowledge (mileage, reliability, ride quality). Infer condition from year + km. **Auto-send photos** when presenting (set `action: send_photos` — never ask "photo bhej doon?"). When redirecting from unavailable models, CONNECT to what they wanted.

**STEP 3 — Handle Objections:** Specific responses for:
- "Mehenga hai" -> market comparison + value highlight
- "Condition kaisi hai?" -> confident + invite visit
- "Sochta hoon" -> use REAL FOMO data (inquiry count, listing age) + always end with a soft hook
- "Doosri jagah sasta" -> compare condition, not just price
- Irrelevant messages -> gently steer back to bikes

**STEP 4 — Negotiate:** Start at asking price. Never volunteer discount. Give small concessions (1-2k steps) reluctantly. Make each feel hard-won. NEVER reveal or breach floor price. At floor -> "Owner se baat karke yahi final hai."

**STEP 5 — Close:** Push for shop visit ("photo mein aur asli mein fark hota hai"). Detect buying signals -> `create_lead`. Explicit trigger phrases: "kal aata hu", "aa raha hu", "done", "theek hai", asks about papers/token/finance. **"When in doubt, CREATE THE LEAD."**

### Part 2: Dynamic Context (appended per-call)

This part changes with every request:

- **Customer memory block** — If the customer has prior history (`CustomerMemory` from DB):
  ```
  CUSTOMER MEMORY (from previous conversations)
  Previous context: Budget 60k, shown Splendor, said mehenga hai...
  Known budget: Rs 60,000
  Preferred brands: Hero, Honda
  Usage: daily commute
  Last active: 5 days ago — acknowledge the gap warmly
  ```
  Instruction: "DO NOT re-ask anything already known above."

- **Inventory summary** — Total count and price range at a glance.

- **Inventory listing** — Every available bike formatted as:
  ```
  [uuid] Company Model Year (Color) | 12,000 km (low-use) | Ask:Rs45,000 Floor:Rs43,650 | Listed:NEW | Inquiries:3 | Photos:4 Videos:1 | Notes:"New tyres, recently serviced"
  ```
  Each line includes:
  - **Color** (if available) in the bike name
  - **KM usage label**: low-use (<15k), normal-use (15-30k), well-used (>30k)
  - **Ask and Floor prices** — floor = `display_price * (1 - negotiation_percentage/100)`
  - **Listed age**: NEW (0-2 days), `Nd ago` (3-7 days), `Nd` (older)
  - **Inquiry count** — real count from `leads` table (non-Sold, non-Lost)
  - **Photo/Video counts** — real count from `bike_media` table
  - **Condition notes** — from DB if available
  - **[RESERVED]** tag for reserved bikes

- **Active bike context** — If the customer is discussing a specific bike, it's highlighted with "stay focused on this bike unless they want to switch."

- **Customer status** — New customer -> warm greeting + qualify. Returning -> skip intro, be direct.

### Why This Structure Matters

The static-then-dynamic split is a **cost optimization**. OpenAI caches prompt prefixes — since the persona/rules/playbook never change, only the inventory, memory, and signals vary. Most of my system prompt is cached across all customers.

---

## Customer Memory System

**The problem:** Without memory, every new message from a returning customer starts from zero. Customer said their budget is 60k yesterday? Forgotten. Liked the Splendor but said it was too expensive? Forgotten.

**The solution:** `CustomerMemory` — a persistence layer that survives across sessions.

### How It Works

```typescript
export interface CustomerMemory {
  budget: number | null;
  preferred_brands: string | null;
  usage_type: string | null;
  last_summary: string | null;         // LLM-generated summary of the conversation so far
  days_since_last_active: number | null; // computed from conversation_state.updated_at
}
```

**Flow:**
1. `conversation-engine.server.ts` reads `conversation_state` from DB and builds `CustomerMemory`.
2. Memory is passed to `handleVerifiedMessage()` -> injected into the system prompt.
3. LLM sees the memory and picks up where it left off. It also generates a fresh `customer_summary` in every response.
4. After the LLM responds, `conversation-engine.server.ts` persists the updated summary + budget back to `conversation_state`.

**DB columns** (in `conversation_state`):
- `budget` (integer) — extracted from `budget_mentioned` in LLM response
- `preferred_brands` (text) — planned for future extraction
- `usage_type` (text) — planned for future extraction
- `last_summary` (text) — the LLM's customer summary, fed back next time

---

## Bike Signals — Real FOMO Data

**The problem:** Fake urgency ("10 log interested hain!") is unconvincing and dishonest.

**The solution:** `BikeSignals` — real-time data about each bike's demand and media availability.

```typescript
interface BikeSignals {
  leads: number;   // active leads (not Sold/Lost) for this bike
  photos: number;  // photo count in bike_media
  videos: number;  // video count in bike_media
}
```

**Fetched by** `getBikeSignals()` — parallel queries to `leads` and `bike_media` tables.

**Used for:**
- **FOMO**: "Iss bike ke baare mein 3 log aur pooch chuke hain" (only when leads > 0)
- **Media gating**: Only promise photos if `photos > 0`. Only promise videos if `videos > 0`. If no media exists: "Photo abhi upload ho rahi hai, aap aa ke dekh lo."
- **Listing freshness**: `daysAgo(created_at)` -> "Abhi abhi aayi hai" (< 3 days) vs "Kaafi din se hai" (14+ days with 0 inquiries -> push harder)

---

## Pricing & Negotiation

- Every bike has a `display_price` (asking price) and a `negotiation_percentage` in the database.
- The **floor price** (absolute minimum) = `display_price * (1 - negotiation_percentage/100)`.
- If `negotiation_percentage` is 0 or unset, the global `MAX_DISCOUNT` of 3% applies.
- The LLM sees both Ask and Floor prices but is **strictly instructed to NEVER reveal the floor price** to the customer.
- Negotiation strategy: anchor at asking price -> small reluctant concessions -> stop at floor -> escalate if stuck.

---

## Data Flow & State

### Supabase Tables

| Table | Purpose |
|---|---|
| `bikes` | Inventory — company, model, year, km, RTO, price, negotiation %, color, condition_notes, status |
| `bike_media` | Photos and videos linked to bikes (stored in Supabase Storage) |
| `conversations` | Full message log (customer + bot), used to build LLM history |
| `conversation_state` | Per-customer state: verified?, current bike, negotiation progress, interested, **budget, preferred_brands, usage_type, last_summary** |
| `leads` | Created when buying intent is strong — upserted per phone+bike combo |
| `lead_events` | Event log per lead (for tracking) |

### Key Behaviors

- **Inventory is always live** — fetched fresh from Supabase on every message. I never cache or invent bikes.
- **Inventory query has a fallback** — If the query with `color`/`condition_notes` columns fails (columns don't exist yet), it retries without them. Prevents the "koi bike nahi hai" bug.
- **Signals fetched in parallel** — `getInventory()`, `getHistory()`, and `getBikeSignals()` all run concurrently via `Promise.all()`.
- **History is capped at 20 messages** — newest 20 reversed to chronological order, with Bihar gate noise stripped out. Long-term memory lives in `customer_summary`.
- **Customer messages are logged BEFORE the LLM call**; bot replies are logged AFTER.
- **Leads are upserted** — same customer + same bike = update existing lead, not duplicate.
- **Customer memory persisted after every LLM call** — `last_summary` and `budget` written back to `conversation_state`.

---

## Actions I Can Take

| Action | When I Use It |
|---|---|
| `none` | Regular conversation — qualifying, chatting, objection handling |
| `send_photos` | Presenting a bike (auto-send, never ask first) OR customer asked for photos. Gated by `photos > 0`. |
| `send_video` | Customer specifically asked for video. Gated by `videos > 0`. |
| `create_lead` | Strong buying intent — agreed on price, wants to visit, asking about token/papers/finance. "When in doubt, CREATE THE LEAD." |
| `escalate` | RC/legal/insurance questions, owner-level decisions, customer insisting below floor |

---

## Error Handling

- **OpenAI call fails** (network, auth, rate limit) -> graceful fallback reply:
  > "Maaf kijiye sir, thoda technical issue aa gaya. Seedha baat karein: 7050959444"

  The fallback response includes `budget_mentioned: null` and `customer_summary: null` so memory updates are safely skipped.

- **Inventory query fails** (missing columns after migration) -> fallback query without new columns + `console.warn` logging. Prevents the critical "zero bikes" bug.

- **Signals query fails** (leads or media table issue) -> `console.warn` + returns empty signals. Bikes still show, just without FOMO data.

---

## File Map

| File | Role |
|---|---|
| `src/lib/whatsapp/llm-sales-agent.server.ts` | LLM sales agent — system prompt, OpenAI call, action execution, memory updates |
| `src/lib/whatsapp/conversation-engine.server.ts` | Bihar gate + orchestrator — state management, memory persistence |
| `src/lib/whatsapp/meta.server.ts` | Meta WhatsApp Cloud API client — sendWhatsAppText, sendWhatsAppMedia |
| `src/routes/api/public/whatsapp.webhook.ts` | Webhook POST/GET handlers (Meta verification + message routing) |
| `src/routes/api/test/simulate.ts` | POST /api/test/simulate for local testing |
| `src/routes/api/test/seed.ts` | POST /api/test/seed to seed demo bikes |
| `src/lib/bikes.ts` | Bike types and Supabase fetchers (admin dashboard) |
| `src/lib/leads.ts` | Lead types and fetchers (leads dashboard) |
| `src/components/BikeForm.tsx` | Bike add/edit form with color and condition_notes fields |
| `src/integrations/supabase/client.server.ts` | Lazy singleton Supabase admin client (server-only) |
| `src/integrations/supabase/types.ts` | Auto-generated Supabase types |

---

## Configuration

All configurable via environment variables — no code changes needed:

| Env Var | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | API authentication | (required) |
| `OPENAI_MODEL` | Which model to use | `gpt-4o-mini` |

LLM parameters are hardcoded for consistency:
- `temperature: 0.3` (low creativity, high reliability)
- `max_tokens: 500` (enough for detailed pitches)
- `response_format: json_object` (guaranteed valid JSON output)

---

## Migrations

| Migration | What It Does |
|---|---|
| `20260610120000_add_customer_memory_columns.sql` | Adds `budget`, `preferred_brands`, `usage_type`, `last_summary` to `conversation_state` |
| `20260610130000_add_condition_notes_to_bikes.sql` | Adds `condition_notes` to `bikes` |
| `20260610140000_add_color_to_bikes.sql` | Adds `color` to `bikes` |
