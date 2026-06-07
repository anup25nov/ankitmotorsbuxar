import { createFileRoute } from "@tanstack/react-router";
import { handleIncomingMessage } from "@/lib/whatsapp/conversation-engine.server";

export const Route = createFileRoute("/api/test/simulate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const phone = (body as any)?.phone;
        const message = (body as any)?.message;

        if (!phone || !message) {
          return Response.json(
            { error: "Missing phone or message" },
            { status: 400 }
          );
        }

        try {
          const result = await handleIncomingMessage(String(phone), String(message));
          return Response.json(result);
        } catch (err) {
          console.error("[test/simulate] error", err);
          return Response.json(
            { error: String(err) },
            { status: 500 }
          );
        }
      },
    },
  },
});
