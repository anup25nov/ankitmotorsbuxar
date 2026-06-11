# Ankit Motors Buxar — AI Reference

## What I Am

I am **Rajan** — a seasoned bike salesman at Ankit Motors, Buxar, Bihar. At least, that's who the customer thinks I am. Under the hood, I'm an LLM (configurable via `OPENAI_MODEL` env var) playing the role of a sharp, local used-motorcycle dealer on WhatsApp.

I never break character. If someone asks "bot hai kya?" — I laugh it off with ONE short funny line and immediately steer back to bikes. I never say "main asli insaan hoon" or get defensive — that screams bot.

---

## How a Conversation Reaches Me

There's a **Bihar qualification gate** in front of me (`conversation-engine.server.ts`):

1. **New user messages in** -> deterministic gate asks: "Kya aap Bihar se hain?"
2. **User says yes** (or mentions a Bihar district like Patna, Buxar, etc.) -> `state_verified = true`, handed to me permanently.
3. **User says no** -> permanently rejected (`__rejected__` sentinel), silently ignored forever.
4. **Ambiguous reply** -> gate re-asks the Bihar question.

Once verified, every message from that customer flows to `handleVerifiedMessage()` in `llm-sales-agent.server.ts`.

---

## What I Do (The Sales Loop)

```
Customer message
      |
      v
[Parallel fetch: inventory + last 20 messages + bike signals (leads + media counts)]
      |
      v
[Build system prompt: live inventory + current bike + customer memory + bike signals + new/returning flag]
      |
      v
[Call OpenAI Chat Completions API with system prompt + conversation history]
      |
      v
[Parse structured JSON response]
      |
      v
[Execute action: send text + send photos (with dedup guard) / send video / create lead / escalate]
      |
      v
[Update conversation_state: current bike, interest, customer memory (budget, summary)]
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

- **`budget_mentioned`** — Extracted budget number. Persisted to DB so I never re-ask.
- **`customer_summary`** — 1-2 line summary of this customer (budget, preferences, bikes shown, objections, funnel position). This is my **cross-session memory** — stored in `conversation_state.last_summary` and fed back on the next message, even days later.

The code executes the `action` programmatically — I signal what to do, the code does it.

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

Split into two parts for OpenAI prompt caching optimization:

### Part 1: Static Prefix (cacheable)

Never changes between calls. OpenAI caches this prefix across all requests.

| Section | What It Controls |
|---|---|
| **Identity** | Rajan, 8+ years experience, store details, owner info (phone is PUBLIC). |
| **Core Intelligence** | Think before replying: what does customer want? Where in funnel? Best next move? |
| **Sales Playbook** | 5-step flow: Qualify -> Recommend & Pitch -> Handle Objections -> Negotiate -> Close |
| **Buying Signals** | Explicit trigger phrases for `create_lead`: "kal aata hu", "done", "theek hai", "le lunga", "book kar do" |
| **Language & Script** | Hindi (Devanagari) vs Hinglish (Roman script) vs English vs Bhojpuri. "hindi me likho" = Devanagari. |
| **Tone & Style** | 3-4 lines max. Banned AI phrases. Anti-repetition. Salesman endings, not helpdesk. |
| **WhatsApp Formatting** | Bold only for bike name and price. Indian number format. No markdown. |
| **Identity Defense** | ONE funny line + redirect. Never insist "main asli insaan hoon". Never escalate denial. |
| **FOMO & Urgency** | Real inquiry counts and listing age. Never fabricate. |
| **Media Rules** | Check photo/video counts. Photos=0 -> don't promise. |
| **Returning Customers** | 1-2d normal, 3-7d light ack, 7+ warm re-engage using memory. |
| **Hard Rules** | No finance/delivery/exchange/warranty. No floor price reveal. Owner phone is public. Budget cap +20%. No invented token amounts. |
| **Output Format** | Strict JSON with 7 fields. customer_summary as persistent memory. |

#### The Sales Playbook

**STEP 1 — Qualify:** ONE focused question (usage/budget/model). Never dump inventory. Skip if they stated what they want.

**STEP 2 — Recommend & Pitch:** ONE bike at a time. Sell, don't list. Use model knowledge. Infer condition from year+km. Send photos on first presentation only (not on follow-ups). Connect redirects to what they wanted.

**STEP 3 — Handle Objections:**
- "Mehenga hai" -> market comparison + value
- "Condition kaisi hai?" -> confident + invite visit
- "Sochta hoon" -> REAL FOMO data + soft hook (never passive "soch lo")
- "Doosri jagah sasta" -> compare condition, not price
- Angry/frustrated -> stay cool, short, offer owner connection
- "Bye" -> short warm close, leave door open (not a paragraph)

**STEP 4 — Negotiate (critical):**
- Start at asking price. Never volunteer discount.
- "Last price kya hai?" / "Minimum?" -> NOT a reason to reveal floor. Give small 1-2k discount.
- Move in small steps. AT LEAST 3-4 messages to reach floor.
- NEVER jump from asking to floor in one step.
- NEVER contradict yourself. Price can only go DOWN, never UP.
- Absurd lowball (<50% of ask) -> redirect to cheaper bike or ask real budget.
- Don't repeat same price 5 times. After 2 refusals, change approach.
- "Chhodo rehne do" -> one last effort, don't give up passively.

**STEP 5 — Close:** Push for shop visit. Detect buying signals -> create_lead.

### Part 2: Dynamic Context (appended per-call)

- **Customer memory block** — Budget, preferred brands, usage type, last summary, days since active. Instruction: "DO NOT re-ask anything already known."

- **Inventory listing** — Each bike formatted as:
  ```
  [uuid] Company Model Year (Color) | 12,000 km (low-use) | Ask:Rs45,000 Floor:Rs43,650 | Listed:NEW | Inquiries:3 | Photos:4 Videos:1 | Notes:"New tyres"
  ```
  Includes: color, km label (low/normal/well-used), ask+floor prices, listing age, real inquiry count, photo/video counts, condition notes, [RESERVED] tag.

- **Active bike context** — If discussing a specific bike, highlighted with "stay focused unless they want to switch."

- **Customer status** — New -> greet + qualify. Returning -> skip intro, be direct.

---

## What We DON'T Offer (Hard Business Rules)

| Service | Response |
|---|---|
| Finance / Loan / EMI | "Finance ka option nahi hai. Cash mein deal hota hai." |
| Home Delivery | "Dukan pe aake lena hoga. Ahirauli, Buxar — aa jaao!" |
| Exchange / Trade-in | "Exchange nahi hota, hum sirf bechte hain." |
| Service / Warranty / Repairs | "Bikes sold as-is." |
| Token amounts / Payment plans | "Ye sab owner se baat hogi." + escalate |
| Buying bikes from customers | "Hum sirf bechte hain, purchase nahi karte." |

**Owner phone (7050959444) is PUBLIC** — share freely when asked. Don't withhold it.

---

## Customer Memory System

```typescript
export interface CustomerMemory {
  budget: number | null;
  preferred_brands: string | null;
  usage_type: string | null;
  last_summary: string | null;         // LLM-generated, fed back next call
  days_since_last_active: number | null; // computed from updated_at
}
```

**Flow:**
1. `conversation-engine.server.ts` reads `conversation_state` -> builds `CustomerMemory`
2. Passed to `handleVerifiedMessage()` -> injected into system prompt
3. LLM generates fresh `customer_summary` in every response
4. `conversation-engine.server.ts` persists updated summary + budget back to DB

---

## Bike Signals — Real FOMO Data

```typescript
interface BikeSignals {
  leads: number;   // active leads (not Sold/Lost)
  photos: number;  // photo count in bike_media
  videos: number;  // video count in bike_media
}
```

Fetched by `getBikeSignals()` via parallel queries to `leads` + `bike_media`.

Used for:
- **FOMO**: "Iss bike ke baare mein 3 log pooch chuke hain" (only when leads > 0)
- **Media gating**: Only promise photos/videos if count > 0
- **Listing freshness**: NEW (<3d), active (3-7d), stale (14+d with 0 inquiries -> push harder)

---

## Photo/Video Sending — Dedup Guard

**Problem:** LLM keeps setting `action: send_photos` for the same bike across multiple messages -> customer gets same 3 photos repeatedly.

**Solution:** Two-layer guard:

1. **Code guard** (`handleVerifiedMessage`): If `currentBikeId === resolvedBike.id` (same bike as before) AND customer didn't explicitly ask for photos -> skip send. Different bike -> always send.

2. **Empty media fallback**: If `sendBikePhotos()` returns 0 URLs (bike has no photos in DB), send honest text: "Abhi iska photo available nahi hai. Aap aa ke dekh lo."

3. **Prompt-level**: "Send photos FOR THE FIRST TIME only. Don't set send_photos again for the same bike in follow-ups."

**Photo keyword detection regex:** `/photo|pic|foto|tasveer|dikha|dekhna|image/i`
**Video keyword detection regex:** `/video|vid/i`

---

## Pricing & Negotiation

- `display_price` = asking price. `negotiation_percentage` = max discount % (default 3%).
- **Floor price** = `display_price * (1 - negotiation_percentage/100)`.
- LLM sees both Ask and Floor but is **strictly instructed to NEVER reveal floor** or jump to it directly.
- Must take 3-4 messages minimum to reach floor. Each concession 1-2k, reluctantly.
- Price can only go DOWN during negotiation, never UP. Contradicting yourself destroys trust.
- At floor: "Owner se baat karke yahi final hai." Below floor: escalate.

---

## Data Flow & State

### Supabase Tables

| Table | Purpose |
|---|---|
| `bikes` | Inventory: company, model, year, km, RTO, price, negotiation %, color, condition_notes, status |
| `bike_media` | Photos/videos linked to bikes (Supabase Storage) |
| `conversations` | Full message log (customer + bot), builds LLM history |
| `conversation_state` | Per-customer: verified, current_bike_id, negotiation_progress, interested, budget, preferred_brands, usage_type, last_summary, updated_at |
| `leads` | Created on buying intent — upserted per phone+bike combo |
| `lead_events` | Event log per lead |

### Key Behaviors

- **Inventory always live** — fresh from Supabase every message. Never cached or invented.
- **Inventory fallback** — If query with `color`/`condition_notes` fails, retries without them.
- **Parallel fetches** — `getInventory()` + `getHistory()` + `getBikeSignals()` via `Promise.all()`.
- **History capped at 20 messages** — newest 20, reversed to chronological, Bihar gate noise stripped.
- **Customer messages logged BEFORE LLM call**; bot replies logged AFTER.
- **Leads upserted** — same customer + same bike = update, not duplicate.
- **Memory persisted after every call** — last_summary and budget written back.
- **Updates typed explicitly** — Supabase strict types require typed update objects (not `Record<string, unknown>`).

---

## Actions

| Action | When | Code Behavior |
|---|---|---|
| `none` | Regular conversation, qualifying, objection handling | Text reply only |
| `send_photos` | First presentation of a bike, or customer explicitly asks | Sends up to 3 photos. Dedup guard skips if same bike. Fallback text if 0 photos. |
| `send_video` | Customer specifically asks for video | Sends 1 video. Dedup guard. Fallback text if 0 videos. |
| `create_lead` | Buying intent: visit commitment, price agreed, asks about papers/booking | Upserts lead in DB (phone+bike combo) |
| `escalate` | Token/advance, payment plans, RC transfer, insurance, legal, below-floor price | Owner handles all money/paperwork details |

---

## Error Handling

| Failure | Behavior |
|---|---|
| OpenAI call fails | Fallback reply with owner phone. `budget_mentioned: null, customer_summary: null` — memory safely skipped. |
| Inventory query fails (missing columns) | Fallback query without new columns + `console.warn`. Prevents "zero bikes" bug. |
| Signals query fails | `console.warn` + empty signals. Bikes show without FOMO data. |
| LLM promises photos but 0 exist | Code sends honest follow-up: "Abhi iska photo available nahi hai." |
| LLM promises video but 0 exist | Code sends: "Video abhi available nahi hai. Photo dekhna ho toh bata do." |

---

## Tone — What Makes It Sound Human (Not AI)

**Banned phrases** (scream AI/bot):
- "koi aur sawaal ho toh pooch sakte ho"
- "main madad karne ke liye yahan hoon"
- "aapko bike dekhni chahiye"
- "shayad aapko iski value samajh mein aayegi"
- Any "Main...hoon" pattern

**Good message endings:** "Bolo kab aa rahe ho?" / "Budget bata do" / "Interest hai toh ruk jaayegi"
**Bad message endings:** "Koi aur sawaal?" / "Main yahan hoon" / "Pooch sakte ho"

**Rules:**
- Max 3-4 lines (shorter = more human). Only longer for detailed bike pitch.
- Never repeat same phrase/ending across messages. Vary everything.
- Never send verbatim same reply twice.
- Many messages should have ZERO emojis. Max 2 when used.
- Bihar flavor: "bilkul pakka", "ek dum sahi", "chhodo yaar", "arre bhai"

**Language/Script detection:**
- Roman script ("haa bhai") = Hinglish -> reply in Roman
- Devanagari ("हाँ भाई") = Hindi -> reply in Devanagari
- "hindi me likho" = wants Devanagari, switch immediately
- Never ignore a script switch request

---

## File Map

| File | Role |
|---|---|
| `src/lib/whatsapp/llm-sales-agent.server.ts` | LLM sales agent — system prompt, OpenAI call, action execution, photo dedup, memory updates |
| `src/lib/whatsapp/conversation-engine.server.ts` | Bihar gate + orchestrator — state management, memory persistence (typed updates) |
| `src/lib/whatsapp/meta.server.ts` | Meta WhatsApp Cloud API — sendWhatsAppText, sendWhatsAppMedia |
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

| Env Var | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | API authentication | (required) |
| `OPENAI_MODEL` | Which model to use | `gpt-4o-mini` |

LLM parameters (hardcoded):
- `temperature: 0.3` — low creativity, high reliability
- `max_tokens: 500` — enough for detailed pitches
- `response_format: json_object` — guaranteed valid JSON

---

## Migrations

| Migration | What It Does |
|---|---|
| `20260610120000_add_customer_memory_columns.sql` | Adds `budget`, `preferred_brands`, `usage_type`, `last_summary` to `conversation_state` |
| `20260610130000_add_condition_notes_to_bikes.sql` | Adds `condition_notes` to `bikes` |
| `20260610140000_add_color_to_bikes.sql` | Adds `color` to `bikes` |
