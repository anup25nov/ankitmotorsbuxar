// Public webhook for incoming Meta WhatsApp Cloud API events.
// Meta posts inbound customer messages here. The path is under
// /api/public/* so it bypasses published-site auth (external caller).

import { createFileRoute } from "@tanstack/react-router";
import { handleIncomingMessage } from "@/lib/whatsapp/conversation-engine.server";

/**
 * Extract the sender phone and text body from the Meta WhatsApp Cloud API
 * webhook payload (and also handles older AiSensy-style payloads as a fallback).
 *
 * Meta payload shape:
 * {
 *   object: "whatsapp_business_account",
 *   entry: [{
 *     changes: [{
 *       value: {
 *         messages: [{ from: "919876543210", type: "text", text: { body: "..." } }]
 *       }
 *     }]
 *   }]
 * }
 */
function extractMessage(payload: any): { phone: string; text: string } | null {
  if (!payload || typeof payload !== "object") return null;

  // --- Meta Cloud API format ---
  if (payload.object === "whatsapp_business_account" || payload.entry) {
    try {
      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const msg = value?.messages?.[0];

      if (!msg || !msg.from) return null;
      if (msg.type !== "text" && msg.type !== "button" && msg.type !== "interactive") {
        // Non-text messages (status updates, etc.) — ignore silently
        return null;
      }

      const phone = String(msg.from);
      const text: string =
        msg?.text?.body ||
        msg?.button?.text ||
        msg?.interactive?.button_reply?.title ||
        msg?.interactive?.list_reply?.title ||
        "";

      if (!text) return null;
      return { phone, text };
    } catch {
      return null;
    }
  }

  // --- Fallback: AiSensy / generic shapes ---
  const candidates = [
    payload?.data,
    payload?.message,
    payload?.data?.message,
    payload,
  ];

  const phone =
    payload?.data?.from ||
    payload?.from ||
    payload?.waId ||
    payload?.data?.waId ||
    payload?.sender?.phone ||
    payload?.data?.sender?.phone ||
    payload?.contacts?.[0]?.wa_id ||
    payload?.messages?.[0]?.from;

  let text: string | undefined;
  for (const c of candidates) {
    if (!c) continue;
    text =
      (typeof c.text === "string" ? c.text : undefined) ||
      c?.text?.body ||
      c?.message?.text ||
      c?.message?.text?.body ||
      c?.body ||
      c?.button?.text ||
      c?.interactive?.button_reply?.title ||
      c?.interactive?.list_reply?.title;
    if (text) break;
  }

  if (!text && Array.isArray(payload?.messages)) {
    const m = payload.messages[0];
    text =
      m?.text?.body ||
      m?.button?.text ||
      m?.interactive?.button_reply?.title ||
      m?.interactive?.list_reply?.title;
  }

  if (!phone || !text) return null;
  return { phone: String(phone), text: String(text) };
}

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      /**
       * Meta webhook verification handshake.
       * Meta sends: GET ?hub.mode=subscribe&hub.challenge=XXXX&hub.verify_token=YOUR_TOKEN
       * We must respond with just the challenge string if the token matches.
       */
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const challenge = url.searchParams.get("hub.challenge");
        const token = url.searchParams.get("hub.verify_token");

        const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

        if (mode === "subscribe" && token === expectedToken && challenge) {
          console.log("[whatsapp webhook] Meta verification successful");
          return new Response(challenge, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }

        // Non-Meta GET requests (health checks etc.)
        return new Response("ok", { status: 200 });
      },

      /**
       * Incoming WhatsApp message from Meta Cloud API.
       * Meta always expects a 200 OK response quickly (within 20s).
       */
      POST: async ({ request }) => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const parsed = extractMessage(payload);
        if (!parsed) {
          // Acknowledge non-message events (status updates, read receipts, etc.)
          // Meta will retry if we don't return 200.
          return Response.json({ ok: true, ignored: true });
        }

        try {
          const result = await handleIncomingMessage(parsed.phone, parsed.text);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[whatsapp webhook] processing error", err);
          // Still return 200 so Meta doesn't retry the same message in a loop.
          return Response.json({ ok: false, error: "internal" }, { status: 200 });
        }
      },
    },
  },
});
