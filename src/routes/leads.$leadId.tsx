import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Phone, Bike as BikeIcon, IndianRupee, Trash2, Clock } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { supabase } from "@/integrations/supabase/client";
import {
  LEAD_STATUSES,
  addLeadEvent,
  fetchLead,
  fetchLeadEvents,
  formatDateTime,
  statusBadgeVariant,
  type LeadStatus,
} from "@/lib/leads";
import { formatINR } from "@/lib/bikes";

export const Route = createFileRoute("/leads/$leadId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Lead · Ankit Motors" }] }),
  component: LeadDetailPage,
});

function LeadDetailPage() {
  const { leadId } = Route.useParams();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: lead, refetch } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => fetchLead(leadId),
  });
  const { data: events = [], refetch: refetchEvents } = useQuery({
    queryKey: ["lead-events", leadId],
    queryFn: () => fetchLeadEvents(leadId),
  });

  const [price, setPrice] = useState("");
  const [summary, setSummary] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    if (lead) {
      setPrice(lead.last_offered_price != null ? String(lead.last_offered_price) : "");
      setSummary(lead.conversation_summary ?? "");
    }
  }, [lead]);

  const changeStatus = async (s: LeadStatus) => {
    const { error } = await supabase.from("leads").update({ status: s }).eq("id", leadId);
    if (error) return toast.error(error.message);
    toast.success(`Status set to ${s}`);
    refetch();
    refetchEvents();
  };

  const saveNotes = async () => {
    setSavingNotes(true);
    const { error } = await supabase
      .from("leads")
      .update({
        conversation_summary: summary || null,
        last_offered_price: price ? Number(price) : null,
      })
      .eq("id", leadId);
    if (!error) {
      await addLeadEvent(leadId, "Notes updated", "note");
      toast.success("Notes saved");
      refetch();
      refetchEvents();
    } else {
      toast.error(error.message);
    }
    setSavingNotes(false);
  };

  const remove = async () => {
    const { error } = await supabase.from("leads").delete().eq("id", leadId);
    if (error) return toast.error(error.message);
    toast.success("Lead deleted");
    router.navigate({ to: "/leads" });
  };

  if (!lead) {
    return (
      <Layout>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/leads">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to leads
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="mr-1 h-4 w-4 text-destructive" /> Delete lead
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <div className="rounded-lg border bg-card p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xl font-semibold">
                  <Phone className="h-5 w-5 text-muted-foreground" />
                  {lead.phone_number}
                </div>
                <p className="text-sm text-muted-foreground">
                  Created {formatDateTime(lead.created_at)}
                </p>
              </div>
              <Badge variant={statusBadgeVariant(lead.status)} className="text-sm">
                {lead.status}
              </Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <InfoTile
                icon={<BikeIcon className="h-4 w-4" />}
                label="Interested Bike"
                value={lead.bike_name ?? "—"}
              />
              <InfoTile
                icon={<IndianRupee className="h-4 w-4" />}
                label="Last Offered Price"
                value={
                  lead.last_offered_price != null
                    ? formatINR(Number(lead.last_offered_price))
                    : "—"
                }
              />
            </div>

            <Separator className="my-6" />

            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label className="text-sm">Change status</Label>
                <Select value={lead.status} onValueChange={(v) => changeStatus(v as LeadStatus)}>
                  <SelectTrigger className="max-w-xs">
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
              </div>

              <div className="grid gap-1.5">
                <Label className="text-sm">Last offered price (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="max-w-xs"
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-sm">Conversation summary</Label>
                <Textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>

              <div className="flex justify-end">
                <Button onClick={saveNotes} disabled={savingNotes}>
                  {savingNotes ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
              <Clock className="h-4 w-4" /> Timeline
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Every status change and note for this lead.
            </p>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ol className="relative space-y-5 border-l pl-5">
                {events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[27px] top-1.5 flex h-3 w-3 items-center justify-center">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                    </span>
                    <p className="text-sm">{e.description}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(e.created_at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {lead.phone_number} and its full timeline will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

function InfoTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
