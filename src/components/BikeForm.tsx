import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUSES, type Bike, type BikeStatus } from "@/lib/bikes";

export type BikeFormValues = Omit<Bike, "id" | "created_at" | "updated_at">;

interface Props {
  initial?: Partial<BikeFormValues>;
  submitting?: boolean;
  submitLabel: string;
  onSubmit: (values: BikeFormValues) => void;
}

export function BikeForm({ initial, submitting, submitLabel, onSubmit }: Props) {
  const [v, setV] = useState<BikeFormValues>({
    company: initial?.company ?? "",
    model: initial?.model ?? "",
    year: initial?.year ?? new Date().getFullYear(),
    km_covered: initial?.km_covered ?? 0,
    rto_number: initial?.rto_number ?? "",
    display_price: initial?.display_price ?? 0,
    negotiation_percentage: initial?.negotiation_percentage ?? 3,
    status: (initial?.status as BikeStatus) ?? "Available",
  });

  const set = <K extends keyof BikeFormValues>(k: K, val: BikeFormValues[K]) =>
    setV((p) => ({ ...p, [k]: val }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
      className="grid gap-5 md:grid-cols-2"
    >
      <Field label="Company">
        <Input required value={v.company} onChange={(e) => set("company", e.target.value)} />
      </Field>
      <Field label="Model">
        <Input required value={v.model} onChange={(e) => set("model", e.target.value)} />
      </Field>
      <Field label="Year">
        <Input
          required
          type="number"
          min={1980}
          max={new Date().getFullYear() + 1}
          value={v.year}
          onChange={(e) => set("year", Number(e.target.value))}
        />
      </Field>
      <Field label="Distance Covered (KM)">
        <Input
          required
          type="number"
          min={0}
          value={v.km_covered}
          onChange={(e) => set("km_covered", Number(e.target.value))}
        />
      </Field>
      <Field label="RTO Number">
        <Input
          required
          value={v.rto_number}
          onChange={(e) => set("rto_number", e.target.value.toUpperCase())}
          placeholder="BR44A1234"
        />
      </Field>
      <Field label="Display Price (₹)">
        <Input
          required
          type="number"
          min={0}
          value={v.display_price}
          onChange={(e) => set("display_price", Number(e.target.value))}
        />
      </Field>
      <Field label="Negotiation %">
        <Input
          required
          type="number"
          step="0.5"
          min={0}
          max={100}
          value={v.negotiation_percentage}
          onChange={(e) => set("negotiation_percentage", Number(e.target.value))}
        />
      </Field>
      <Field label="Status">
        <Select value={v.status} onValueChange={(val) => set("status", val as BikeStatus)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="md:col-span-2 flex justify-end gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
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
