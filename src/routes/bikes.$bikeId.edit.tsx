import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

import { Layout } from "@/components/Layout";
import { BikeForm, type BikeFormValues } from "@/components/BikeForm";
import { MediaManager } from "@/components/MediaManager";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchBike } from "@/lib/bikes";

export const Route = createFileRoute("/bikes/$bikeId/edit")({
  ssr: false,
  head: () => ({ meta: [{ title: "Edit Bike · Ankit Motors" }] }),
  component: EditBikePage,
});

function EditBikePage() {
  const { bikeId } = Route.useParams();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const { data: bike, isLoading, refetch } = useQuery({
    queryKey: ["bike", bikeId],
    queryFn: () => fetchBike(bikeId),
  });

  const onSubmit = async (values: BikeFormValues) => {
    setSaving(true);
    const { error } = await supabase.from("bikes").update(values).eq("id", bikeId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Bike updated");
    refetch();
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to inventory
          </Link>
        </Button>
        <Button variant="outline" onClick={() => router.navigate({ to: "/" })}>
          Done
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="rounded-lg border bg-card p-6 lg:col-span-3">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Edit Bike</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            {bike ? `${bike.company} ${bike.model} · ${bike.rto_number}` : "Loading…"}
          </p>
          {isLoading || !bike ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <BikeForm
              initial={bike}
              submitLabel="Save Changes"
              submitting={saving}
              onSubmit={onSubmit}
            />
          )}
        </div>

        <div className="rounded-lg border bg-card p-6 lg:col-span-2">
          <h2 className="mb-1 text-lg font-semibold">Photos & Video</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Upload multiple photos and one video for this bike.
          </p>
          <MediaManager bikeId={bikeId} />
        </div>
      </div>
    </Layout>
  );
}
