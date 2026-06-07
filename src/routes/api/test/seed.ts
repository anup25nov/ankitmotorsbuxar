import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEMO_BIKES = [
  {
    company: "TVS",
    model: "Apache RTR 160",
    year: 2022,
    km_covered: 15000,
    rto_number: "BR01",
    display_price: 85000,
    status: "Available",
  },
  {
    company: "Hero",
    model: "Splendor Plus",
    year: 2021,
    km_covered: 25000,
    rto_number: "BR02",
    display_price: 65000,
    status: "Available",
  },
  {
    company: "Honda",
    model: "Activa 6G",
    year: 2023,
    km_covered: 8000,
    rto_number: "BR03",
    display_price: 72000,
    status: "Available",
  },
];

export const Route = createFileRoute("/api/test/seed")({
  server: {
    handlers: {
      POST: async () => {
        try {
          // Check if bikes already exist
          const { data: existing } = await supabaseAdmin
            .from("bikes")
            .select("id")
            .limit(1);

          if ((existing ?? []).length > 0) {
            return Response.json({
              message: "Bikes already exist in the database. Skipped seeding.",
              count: 0,
            });
          }

          const { data, error } = await supabaseAdmin
            .from("bikes")
            .insert(DEMO_BIKES)
            .select("id");

          if (error) {
            console.error("[test/seed] insert error", error);
            return Response.json({ error: error.message }, { status: 500 });
          }

          return Response.json({
            message: `Seeded ${(data ?? []).length} demo bikes.`,
            count: (data ?? []).length,
          });
        } catch (err) {
          console.error("[test/seed] error", err);
          return Response.json({ error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
