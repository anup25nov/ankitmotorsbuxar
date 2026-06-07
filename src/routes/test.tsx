import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Send, Bot, User, Trash2, RefreshCcw, Database } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ChatMessage {
  role: "customer" | "bot";
  text: string;
  time: string;
  media?: { url: string; type: "image" | "video" }[];
}


export const Route = createFileRoute("/test")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Test Simulator · Ankit Motors" }],
  }),
  component: TestSimulatorPage,
});

function TestSimulatorPage() {
  const [phone, setPhone] = useState("+919999999999");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "bot",
      text: "Namaste.\n\nHum filhaal sirf Bihar mein bike sale karte hain.\n\nKya aap Bihar se hain?\n\n✅ Haan\n❌ Nahi",
      time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [sending, setSending] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const sendMessage = async () => {
    if (!input.trim() || !phone.trim()) return;
    const text = input.trim();
    setInput("");
    const now = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    setMessages((prev) => [...prev, { role: "customer", text, time: now }]);
    setSending(true);

    try {
      const res = await fetch("/api/test/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Simulation failed");
      } else if (data.reply) {
        setMessages((prev) => [
          ...prev,
          {
            role: "bot",
            text: data.reply,
            time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
            media: data.media,
          },
        ]);
      }

    } catch (err) {
      toast.error(String(err));
    } finally {
      setSending(false);
    }
  };

  const seedData = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/test/seed", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Demo bikes seeded!");
      } else {
        toast.error(data.error || "Seed failed");
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSeeding(false);
    }
  };

  const resetChat = () => {
    setMessages([
      {
        role: "bot",
        text: "Namaste.\n\nHum filhaal sirf Bihar mein bike sale karte hain.\n\nKya aap Bihar se hain?\n\n✅ Haan\n❌ Nahi",
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  return (
    <Layout>
      <div className="mx-auto max-w-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">WhatsApp Test Simulator</h1>
            <p className="text-sm text-muted-foreground">
              Simulate customer conversations without real WhatsApp.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={seedData} disabled={seeding}>
              <Database className="mr-1 h-4 w-4" />
              {seeding ? "Seeding…" : "Seed Bikes"}
            </Button>
            <Button variant="ghost" size="sm" onClick={resetChat}>
              <Trash2 className="mr-1 h-4 w-4" /> Reset
            </Button>
          </div>
        </div>

        <div className="mb-3 flex gap-2">
          <label className="text-sm text-muted-foreground">Phone:</label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-8 max-w-[200px]"
            placeholder="+91..."
          />
        </div>

        <div className="mb-4 rounded-lg border bg-card">
          <div className="max-h-[500px] overflow-y-auto p-4 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-2 ${m.role === "customer" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    m.role === "bot"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {m.role === "bot" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                </div>
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-line ${
                    m.role === "bot"
                      ? "bg-muted text-foreground"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  {m.text}
                  {m.media && m.media.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {m.media.map((media, idx) =>
                        media.type === "image" ? (
                          <img
                            key={idx}
                            src={media.url}
                            alt="Bike"
                            className="rounded-md border object-cover w-full h-32"
                          />
                        ) : (
                          <video
                            key={idx}
                            src={media.url}
                            controls
                            className="rounded-md border w-full col-span-2"
                          />
                        ),
                      )}
                    </div>
                  )}
                  <div
                    className={`mt-1 text-[10px] ${
                      m.role === "bot" ? "text-muted-foreground" : "text-primary-foreground/70"
                    }`}
                  >
                    {m.time}
                  </div>

                </div>
              </div>
            ))}
            {sending && (
              <div className="flex gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <RefreshCcw className="h-4 w-4 animate-spin" />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 border-t p-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Type a customer message…"
              disabled={sending}
              className="flex-1"
            />
            <Button onClick={sendMessage} disabled={sending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Test script — try this flow:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Type <strong>✅ Haan</strong> (Bihar qualification)</li>
            <li>Type <strong>Apache</strong> (search inventory)</li>
            <li>Type <strong>75k final</strong> (negotiate price)</li>
            <li>Type <strong>book karna hai</strong> (show interest → lead created)</li>
          </ol>
          <p className="mt-2">Then check <strong>/conversations</strong> and <strong>/leads</strong> to see the data.</p>
        </div>
      </div>
    </Layout>
  );
}
