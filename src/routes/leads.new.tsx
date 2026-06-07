import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { supabase } from "@/integrations/supabase/client";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads";
import { fetchBikes } from "@/lib/bikes";

export const Route = createFileRoute("/leads/new")({
  ssr: false,
  head: () => ({ meta: [{ title: "Add Lead · Ankit Motors" }] }),
  component: NewLeadPage,
});

function NewLeadPage() {
  const router = useRouter();
  const { data: bikes = [] } = useQuery({ queryKey: ["bikes"], queryFn: fetchBikes });

  const [phone, setPhone] = useState("");
  const [bikeId, setBikeId] = useState<string>("none");
  const [price, setPrice] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<LeadStatus>("New");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const bike = bikes.find((b) => b.id === bikeId);
    const { data, error } = await supabase
      .from("leads")
      .insert({
        phone_number: phone.trim(),
        bike_id: bike ? bike.id : null,
        bike_name: bike ? `${bike.company} ${bike.model}` : null,
        last_offered_price: price ? Number(price) : null,
        conversation_summary: summary || null,
        status,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Lead created");
    router.navigate({ to: "/leads/$leadId", params: { leadId: data!.id } });
  };

  return (
    <Layout>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/leads">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to leads
          </Link>
        </Button>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Add Lead</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Manually record a customer enquiry. WhatsApp leads will land here automatically later.
        </p>
        <form onSubmit={submit} className="grid gap-5 md:grid-cols-2">
          <Field label="Phone Number">
            <Input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+919876543210"
            />
          </Field>
          <Field label="Interested Bike">
            <Select value={bikeId} onValueChange={setBikeId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {bikes.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.company} {b.model} · {b.rto_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Last Offered Price (₹)">
            <Input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Conversation Summary">
              <Textarea
                rows={5}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What did the customer say? Any specific requests?"
              />
            </Field>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Create Lead"}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}
