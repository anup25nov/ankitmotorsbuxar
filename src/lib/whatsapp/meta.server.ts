// Meta WhatsApp Cloud API client (server-only).
// Replaces the AiSensy integration. Reads credentials from environment:
//   META_WHATSAPP_TOKEN     — permanent system-user access token
//   META_PHONE_NUMBER_ID    — the WhatsApp Business phone number ID from
//                             Meta Developer dashboard → WhatsApp → Getting Started

const META_API_VERSION = "v20.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

interface SendResult {
  ok: boolean;
  status: number;
  body: string;
}

function getCredentials(): { token: string; phoneNumberId: string } | null {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!token) {
    console.error("[meta-wa] META_WHATSAPP_TOKEN is not configured");
    return null;
  }
  if (!phoneNumberId) {
    console.error("[meta-wa] META_PHONE_NUMBER_ID is not configured");
    return null;
  }
  return { token, phoneNumberId };
}

/**
 * Send a free-text WhatsApp message via the Meta Cloud API.
 * Works within and outside the 24h session window for template-initiated
 * conversations; for session (user-initiated) windows any text is allowed.
 */
export async function sendWhatsAppText(
  destination: string,
  message: string,
): Promise<SendResult> {
  const creds = getCredentials();
  if (!creds) return { ok: false, status: 500, body: "Missing credentials" };

  const url = `${META_BASE}/${creds.phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: destination,
        type: "text",
        text: { preview_url: false, body: message },
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      console.error(`[meta-wa] send text failed ${res.status}: ${body}`);
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.error("[meta-wa] send text error", err);
    return { ok: false, status: 500, body: String(err) };
  }
}

/**
 * Send a media message (image or video) via the Meta Cloud API.
 * The mediaUrl must be publicly accessible (e.g. a Supabase signed URL).
 */
export async function sendWhatsAppMedia(
  destination: string,
  mediaUrl: string,
  type: "image" | "video",
  caption?: string,
): Promise<SendResult> {
  const creds = getCredentials();
  if (!creds) return { ok: false, status: 500, body: "Missing credentials" };

  const url = `${META_BASE}/${creds.phoneNumberId}/messages`;

  const mediaObject: Record<string, string> = { link: mediaUrl };
  if (caption) mediaObject.caption = caption;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: destination,
        type,
        [type]: mediaObject,
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      console.error(`[meta-wa] send ${type} failed ${res.status}: ${body}`);
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.error(`[meta-wa] send ${type} error`, err);
    return { ok: false, status: 500, body: String(err) };
  }
}

/**
 * Send a WhatsApp template message via the Meta Cloud API.
 * Templates must be pre-approved in Meta Business Manager.
 * Use this to re-open conversations outside the 24h customer-initiated window.
 */
export async function sendWhatsAppTemplate(params: {
  destination: string;
  templateName: string;
  languageCode?: string;
  components?: object[];
}): Promise<SendResult> {
  const creds = getCredentials();
  if (!creds) return { ok: false, status: 500, body: "Missing credentials" };

  const url = `${META_BASE}/${creds.phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.destination,
        type: "template",
        template: {
          name: params.templateName,
          language: { code: params.languageCode ?? "en_US" },
          components: params.components ?? [],
        },
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      console.error(
        `[meta-wa] send template "${params.templateName}" failed ${res.status}: ${body}`,
      );
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.error("[meta-wa] send template error", err);
    return { ok: false, status: 500, body: String(err) };
  }
}
