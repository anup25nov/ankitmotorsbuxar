import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

import { Layout } from "@/components/Layout";
import { BikeForm, type BikeFormValues } from "@/components/BikeForm";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/bikes/new")({
  ssr: false,
  head: () => ({ meta: [{ title: "Add Bike · Ankit Motors" }] }),
  component: NewBikePage,
});

function NewBikePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const onSubmit = async (values: BikeFormValues) => {
    setSaving(true);
    const { data, error } = await supabase
      .from("bikes")
      .insert(values)
      .select("id")
      .single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Bike added. Add photos and video on the next screen.");
    router.navigate({ to: "/bikes/$bikeId/edit", params: { bikeId: data!.id } });
  };

  return (
    <Layout>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to inventory
          </Link>
        </Button>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Add Bike</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Enter the bike details. You can add photos and a video after saving.
        </p>
        <BikeForm submitLabel="Save & Continue" submitting={saving} onSubmit={onSubmit} />
      </div>
    </Layout>
  );
}
