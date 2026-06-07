// AiSensy WhatsApp Business API client (server-only).
// Supports outgoing free-text (session) messages via the Project/Direct API
// and template messages via the Campaign API.

interface SendResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * AiSensy Project API keys are JWTs that embed the project id in their payload.
 * We decode it (without verifying — it is only used to build the request URL).
 */
function getProjectIdFromKey(key: string): string | null {
  try {
    const parts = key.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf-8"),
    );
    return payload.id || payload.projectId || payload.project_id || null;
  } catch {
    return null;
  }
}

/**
 * Send a free-text WhatsApp message inside the 24h session window using the
 * AiSensy Direct/Project API.
 */
export async function sendWhatsAppText(
  destination: string,
  message: string,
): Promise<SendResult> {
  const projectKey = process.env.AISENSY_PROJECT_API_KEY;
  if (!projectKey) {
    console.error("[aisensy] AISENSY_PROJECT_API_KEY is not configured");
    return { ok: false, status: 500, body: "Missing project API key" };
  }

  const projectId = getProjectIdFromKey(projectKey);
  if (!projectId) {
    console.error("[aisensy] could not derive project id from API key");
    return { ok: false, status: 500, body: "Invalid project API key" };
  }

  const url = `https://apis.aisensy.com/project-apis/v1/project/${projectId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AiSensy-Project-API-Pwd": projectKey,
        Authorization: `Bearer ${projectKey}`,
      },
      body: JSON.stringify({
        to: destination,
        type: "text",
        recipient_type: "individual",
        text: { body: message },
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[aisensy] send text failed ${res.status}: ${body}`);
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.error("[aisensy] send text error", err);
    return { ok: false, status: 500, body: String(err) };
  }
}

/**
 * Send a WhatsApp template message via the AiSensy Campaign API. Useful for
 * proactively re-opening a conversation outside the 24h session window.
 */
export async function sendWhatsAppCampaign(params: {
  campaignName: string;
  destination: string;
  userName?: string;
  templateParams?: string[];
}): Promise<SendResult> {
  const campaignKey = process.env.AISENSY_CAMPAIGN_API_KEY;
  if (!campaignKey) {
    console.error("[aisensy] AISENSY_CAMPAIGN_API_KEY is not configured");
    return { ok: false, status: 500, body: "Missing campaign API key" };
  }

  try {
    const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: campaignKey,
        campaignName: params.campaignName,
        destination: params.destination,
        userName: params.userName ?? "Customer",
        source: "ankit-motors-app",
        templateParams: params.templateParams ?? [],
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[aisensy] campaign send failed ${res.status}: ${body}`);
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.error("[aisensy] campaign send error", err);
    return { ok: false, status: 500, body: String(err) };
  }
}
