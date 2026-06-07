import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

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
  STATUSES,
  fetchBikes,
  formatINR,
  type Bike,
  type BikeStatus,
} from "@/lib/bikes";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Inventory · Ankit Motors Buxar" },
      { name: "description", content: "Used two-wheeler inventory for Ankit Motors, Buxar." },
    ],
  }),
  component: InventoryPage,
});

const statusVariant = (s: BikeStatus) =>
  s === "Available" ? "default" : s === "Reserved" ? "secondary" : "outline";

function InventoryPage() {
  const router = useRouter();
  const { data: bikes = [], isLoading, refetch } = useQuery({
    queryKey: ["bikes"],
    queryFn: fetchBikes,
  });

  const [q, setQ] = useState("");
  const [company, setCompany] = useState<string>("all");
  const [model, setModel] = useState<string>("all");
  const [year, setYear] = useState<string>("all");
  const [rto, setRto] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [minPrice, setMinPrice] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [toDelete, setToDelete] = useState<Bike | null>(null);

  const opts = useMemo(() => {
    const u = <K extends keyof Bike>(k: K) =>
      Array.from(new Set(bikes.map((b) => String(b[k])))).sort();
    return {
      companies: u("company"),
      models: u("model"),
      years: u("year"),
      rtos: u("rto_number"),
    };
  }, [bikes]);

  const filtered = useMemo(() => {
    const min = minPrice ? Number(minPrice) : -Infinity;
    const max = maxPrice ? Number(maxPrice) : Infinity;
    const needle = q.trim().toLowerCase();
    return bikes.filter((b) => {
      if (company !== "all" && b.company !== company) return false;
      if (model !== "all" && b.model !== model) return false;
      if (year !== "all" && String(b.year) !== year) return false;
      if (rto !== "all" && b.rto_number !== rto) return false;
      if (status !== "all" && b.status !== status) return false;
      if (b.display_price < min || b.display_price > max) return false;
      if (needle) {
        const hay =
          `${b.company} ${b.model} ${b.year} ${b.rto_number} ${b.status}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [bikes, q, company, model, year, rto, status, minPrice, maxPrice]);

  const updateStatus = async (b: Bike, s: BikeStatus) => {
    const { error } = await supabase.from("bikes").update({ status: s }).eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${s}`);
    refetch();
  };

  const remove = async (b: Bike) => {
    const { error } = await supabase.from("bikes").delete().eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success("Bike deleted");
    setToDelete(null);
    refetch();
  };

  const resetFilters = () => {
    setQ("");
    setCompany("all");
    setModel("all");
    setYear("all");
    setRto("all");
    setStatus("all");
    setMinPrice("");
    setMaxPrice("");
  };

  return (
    <Layout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading…" : `${filtered.length} of ${bikes.length} bikes`}
          </p>
        </div>
        <Button onClick={() => router.navigate({ to: "/bikes/new" })}>
          <Plus className="mr-1 h-4 w-4" /> Add Bike
        </Button>
      </div>

      <div className="mb-4 rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company, model, RTO…"
            className="max-w-sm"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <FilterSelect label="Company" value={company} onChange={setCompany} options={opts.companies} />
          <FilterSelect label="Model" value={model} onChange={setModel} options={opts.models} />
          <FilterSelect label="Year" value={year} onChange={setYear} options={opts.years} />
          <FilterSelect label="RTO" value={rto} onChange={setRto} options={opts.rtos} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES} />
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">Price range (₹)</label>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="Min"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
              />
              <Input
                type="number"
                placeholder="Max"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Reset filters
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Year</TableHead>
              <TableHead>KM</TableHead>
              <TableHead>RTO</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  {isLoading ? "Loading…" : "No bikes match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.company}</TableCell>
                  <TableCell>{b.model}</TableCell>
                  <TableCell>{b.year}</TableCell>
                  <TableCell>{b.km_covered.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="font-mono text-xs">{b.rto_number}</TableCell>
                  <TableCell>{formatINR(b.display_price)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(b.status)}>{b.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Select value="" onValueChange={(v) => updateStatus(b, v as BikeStatus)}>
                        <SelectTrigger className="h-8 w-[120px]">
                          <SelectValue placeholder="Mark…" />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.filter((s) => s !== b.status).map((s) => (
                            <SelectItem key={s} value={s}>
                              Mark {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button asChild variant="ghost" size="icon">
                        <Link to="/bikes/$bikeId/edit" params={{ bikeId: b.id }}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setToDelete(b)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this bike?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && `${toDelete.company} ${toDelete.model} (${toDelete.rto_number}) `}
              will be permanently removed along with its photos and video.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove(toDelete)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
