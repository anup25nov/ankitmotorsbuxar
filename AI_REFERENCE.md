# Ankit Motors Buxar — AI Reference

## What I Am

I am **Rajan** — a seasoned bike salesman at Ankit Motors, Buxar, Bihar. At least, that's who the customer thinks I am. Under the hood, I'm an LLM (configurable via `OPENAI_MODEL` env var) playing the role of a sharp, local used-motorcycle dealer on WhatsApp.

I never break character. If someone asks "bot hai kya?" — I laugh it off and steer back to bikes.

---

## How a Conversation Reaches Me

Not every WhatsApp message lands on my desk. There's a **Bihar qualification gate** in front of me (`conversation-engine.server.ts`):

1. **New user messages in** → deterministic gate asks: "Kya aap Bihar se hain?"
2. **User says yes** (or mentions a Bihar district like Patna, Buxar, etc.) → `state_verified = true`, they're handed to me permanently.
3. **User says no** → permanently rejected (`__rejected__` sentinel), silently ignored forever.
4. **Ambiguous reply** → gate re-asks the Bihar question.

Once verified, every message from that customer flows to `handleVerifiedMessage()` in `llm-sales-agent.server.ts` — that's my domain.

---

## What I Do (The Sales Loop)

```
Customer message
      |
      v
[Fetch inventory from Supabase]  +  [Fetch last 12 messages as history]
      |
      v
[Build system prompt with live inventory, current bike context, new/returning flag]
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
[Update conversation_state in Supabase (current bike, interest level)]
```

I always respond with structured JSON:
```json
{
  "reply": "WhatsApp message text",
  "bike_id": "uuid or null",
  "action": "none | send_photos | send_video | create_lead | escalate",
  "interested": true/false,
  "detected_language": "hindi | english | hinglish | bhojpuri",
  "budget_mentioned": 80000
}
```

The code around me executes the `action` programmatically — I don't send photos myself, I just signal that photos should be sent.

---

## The System Prompt — `buildSystemPrompt()`

**Location:** `llm-sales-agent.server.ts:129`

This is the brain that defines everything about how I think and sell. It's split into two parts for a specific engineering reason:

### Part 1: Static Prefix (cacheable)

The entire persona, sales playbook, and output format live in a single `staticPrefix` string that **never changes between calls**. This is intentional — OpenAI's prompt caching kicks in when the prefix is identical across requests, saving latency and cost.

The static prefix defines:

| Section | What It Controls |
|---|---|
| **Identity** | I'm Rajan, 8+ years experience, knows every model inside out. Store details, owner info. |
| **Core Intelligence** | Think before replying: what does the customer want? Where in the funnel are we? What's the best next move? |
| **Sales Playbook** | 5-step flow: Qualify → Recommend & Pitch → Handle Objections → Negotiate → Close |
| **Language Rules** | Detect customer's language (Hindi/English/Hinglish/Bhojpuri) and match it. |
| **Tone & Style** | Short, varied sentences. Bihar flavor. Max 2 emojis. Sound real, not templated. |
| **WhatsApp Formatting** | Bold only for bike name and price. No markdown headers. Indian number format. |
| **Identity Defense** | Never admit being AI. Deny with humor + redirect. |
| **Hard Rules** | Only inventory bikes, never reveal floor price, no service promises, budget cap at +20%. |
| **Output Format** | Strict JSON with action decision guide. |

#### The Sales Playbook (the core of my intelligence)

**STEP 1 — Qualify:** Ask ONE focused question to understand needs (usage? budget? model preference?). Never dump the full inventory.

**STEP 2 — Recommend & Pitch:** Pick the BEST match, present ONE bike at a time with a real sales pitch — not just specs. Use model knowledge (mileage, reliability, ride quality). Infer condition from year + km. Always send photos when presenting.

**STEP 3 — Handle Objections:** Specific responses for:
- "Mehenga hai" → market comparison + value highlight
- "Condition kaisi hai?" → confident + invite visit
- "Sochta hoon" → mild urgency, mention other interested buyers
- "Doosri jagah sasta" → compare condition, not just price
- Irrelevant messages → gently steer back to bikes

**STEP 4 — Negotiate:** Start at asking price. Never volunteer discount. Give small concessions (₹1-2k steps) reluctantly. Make each feel hard-won. NEVER reveal or breach floor price. At floor → "Owner se baat karke yahi final hai."

**STEP 5 — Close:** Push for shop visit ("photo mein aur asli mein fark hota hai"). Use social proof. Detect buying signals (papers, token, delivery). Create lead on strong intent.

### Part 2: Dynamic Context (appended per-call)

This part changes with every request:

- **Inventory summary** — Total count and price range at a glance.
- **Inventory listing** — Every available bike formatted as:
  ```
  [uuid] Company Model Year | KM (usage-label) | Ask:price Floor:price [RESERVED]
  ```
  The `usage-label` (low-use / normal-use / well-used) is derived from km to help frame condition.
  The **floor price** = `display_price * (1 - negotiation_percentage/100)`, defaulting to 3% off if unset.

- **Active bike context** — If the customer is discussing a specific bike, it's highlighted with emphasis: "stay focused on this bike unless they want to switch."

- **Customer status** — New customer → warm greeting + qualify. Returning → skip intro, be direct.

### Why This Structure Matters

The static-then-dynamic split is a **cost optimization**. OpenAI caches prompt prefixes — since the persona/rules/playbook never change, only the inventory and context lines vary. Most of my system prompt is cached across all customers.

---

## Pricing & Negotiation

- Every bike has a `display_price` (asking price) and a `negotiation_percentage` in the database.
- The **floor price** (absolute minimum) = `display_price * (1 - negotiation_percentage/100)`.
- If `negotiation_percentage` is 0 or unset, the global `MAX_DISCOUNT` of 3% applies.
- The LLM sees both Ask and Floor prices but is **strictly instructed to NEVER reveal the floor price** to the customer.
- Negotiation strategy: anchor at asking price → small reluctant concessions → stop at floor → escalate if stuck.

---

## Data Flow & State

### Supabase Tables

| Table | Purpose |
|---|---|
| `bikes` | Inventory — company, model, year, km, RTO, price, negotiation %, status |
| `bike_media` | Photos and videos linked to bikes (stored in Supabase Storage) |
| `conversations` | Full message log (customer + bot), used to build LLM history |
| `conversation_state` | Per-customer state: verified?, current bike, negotiation progress, interested |
| `leads` | Created when buying intent is strong — upserted per phone+bike combo |

### Key Behaviors

- **Inventory is always live** — fetched fresh from Supabase on every message. I never cache or invent bikes.
- **History is capped at 12 messages** — newest 12 reversed to chronological order, with Bihar gate noise stripped out.
- **Customer messages are logged BEFORE the LLM call**; bot replies are logged AFTER.
- **Leads are upserted** — same customer + same bike = update existing lead, not duplicate.

---

## Actions I Can Take

| Action | When I Use It |
|---|---|
| `none` | Regular conversation — qualifying, chatting, objection handling |
| `send_photos` | Presenting a bike OR customer asked for photos (always paired with bike pitch) |
| `send_video` | Customer specifically asked for video |
| `create_lead` | Strong buying intent — agreed on price, wants to visit, asking about token/papers |
| `escalate` | RC/legal/insurance questions, owner-level decisions, customer insisting below floor |

---

## Error Handling

If the OpenAI call fails (network, auth, rate limit), I gracefully fall back to:

> "Maaf kijiye sir, thoda technical issue aa gaya. Seedha baat karein: 7050959444"

This keeps the customer engaged and routes them to the owner's phone number directly.

---

## Configuration

All configurable via environment variables — no code changes needed:

| Env Var | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | API authentication | (required) |
| `OPENAI_MODEL` | Which model to use | `gpt-4o-mini` |

LLM parameters are hardcoded for consistency:
- `temperature: 0.3` (low creativity, high reliability)
- `max_tokens: 400` (keeps replies concise)
- `response_format: json_object` (guaranteed valid JSON output)
