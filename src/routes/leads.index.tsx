import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  LEAD_STATUSES,
  fetchLeads,
  formatDate,
  statusBadgeVariant,
} from "@/lib/leads";
import { formatINR } from "@/lib/bikes";

export const Route = createFileRoute("/leads/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Leads · Ankit Motors" },
      { name: "description", content: "Potential customers and follow-ups." },
    ],
  }),
  component: LeadsPage,
});

function LeadsPage() {
  const router = useRouter();
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads"],
    queryFn: fetchLeads,
  });

  const [q, setQ] = useState("");
  const [bike, setBike] = useState("all");
  const [status, setStatus] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const bikeOptions = useMemo(
    () => Array.from(new Set(leads.map((l) => l.bike_name).filter(Boolean) as string[])).sort(),
    [leads],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const from = fromDate ? new Date(fromDate).getTime() : -Infinity;
    const to = toDate ? new Date(toDate).getTime() + 86_400_000 : Infinity;
    return leads.filter((l) => {
      if (status !== "all" && l.status !== status) return false;
      if (bike !== "all" && l.bike_name !== bike) return false;
      const t = new Date(l.created_at).getTime();
      if (t < from || t > to) return false;
      if (needle) {
        const hay = `${l.phone_number} ${l.bike_name ?? ""} ${l.status}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [leads, q, bike, status, fromDate, toDate]);

  const reset = () => {
    setQ("");
    setBike("all");
    setStatus("all");
    setFromDate("");
    setToDate("");
  };

  return (
    <Layout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading…" : `${filtered.length} of ${leads.length} leads`}
          </p>
        </div>
        <Button onClick={() => router.navigate({ to: "/leads/new" })}>
          <Plus className="mr-1 h-4 w-4" /> Add Lead
        </Button>
      </div>

      <div className="mb-4 rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search phone, bike, status…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-sm"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <FilterSelect label="Bike" value={bike} onChange={setBike} options={bikeOptions} />
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={LEAD_STATUSES}
          />
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">From date</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">To date</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="flex items-end justify-end">
            <Button variant="ghost" size="sm" onClick={reset}>
              Reset filters
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phone</TableHead>
              <TableHead>Bike Interested</TableHead>
              <TableHead>Last Offered</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {isLoading ? "Loading…" : "No leads match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((l) => (
                <TableRow
                  key={l.id}
                  className="cursor-pointer"
                  onClick={() =>
                    router.navigate({ to: "/leads/$leadId", params: { leadId: l.id } })
                  }
                >
                  <TableCell className="font-mono text-sm">
                    <Link
                      to="/leads/$leadId"
                      params={{ leadId: l.id }}
                      className="hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {l.phone_number}
                    </Link>
                  </TableCell>
                  <TableCell>{l.bike_name ?? "—"}</TableCell>
                  <TableCell>
                    {l.last_offered_price != null ? formatINR(Number(l.last_offered_price)) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(l.status)}>{l.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(l.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Layout>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <div className="grid gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
