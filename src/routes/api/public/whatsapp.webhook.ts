// Public webhook for incoming AiSensy WhatsApp events.
// AiSensy posts inbound customer messages here. The path is under
// /api/public/* so it bypasses published-site auth (external caller).

import { createFileRoute } from "@tanstack/react-router";
import { handleIncomingMessage } from "@/lib/whatsapp/conversation-engine.server";

// AiSensy / WhatsApp payloads come in several shapes. Extract the sender phone
// and text body defensively from the common variants.
function extractMessage(payload: any): { phone: string; text: string } | null {
  if (!payload || typeof payload !== "object") return null;

  // Common AiSensy shapes
  const candidates = [
    payload?.data,
    payload?.message,
    payload?.data?.message,
    payload,
  ];

  // Phone
  const phone =
    payload?.data?.from ||
    payload?.from ||
    payload?.waId ||
    payload?.data?.waId ||
    payload?.sender?.phone ||
    payload?.data?.sender?.phone ||
    payload?.contacts?.[0]?.wa_id ||
    payload?.messages?.[0]?.from;

  // Text body across variants
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

  // WhatsApp Cloud-style nested messages array
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
      // AiSensy webhook verification / health check.
      GET: async () => new Response("ok", { status: 200 }),

      POST: async ({ request }) => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const parsed = extractMessage(payload);
        if (!parsed) {
          // Acknowledge non-message events (status updates, etc.) so AiSensy
          // does not retry.
          return Response.json({ ok: true, ignored: true });
        }

        try {
          const result = await handleIncomingMessage(parsed.phone, parsed.text);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[whatsapp webhook] processing error", err);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
