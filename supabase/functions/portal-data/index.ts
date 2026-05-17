// portal-data — RealtyFlow Systems
// Public endpoint: validates portal_token and returns client data for the portal page.
// Called by portal/index.html on load with ?token= query param.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const token = new URL(req.url).searchParams.get("token");

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return json({ error: "Invalid token" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await supabase
    .from("clients")
    .select(`
      id,
      onboarding_stage,
      onboarding_stage_name,
      intake_completed,
      setup_completed,
      go_live_date,
      notes,
      leads ( fname, lname, email, phone, tier ),
      payments ( amount_cents, tier, description, status )
    `)
    .eq("portal_token", token)
    .single();

  if (error || !data) {
    return json({ error: "Portal not found" }, 404);
  }

  return json({ client: data });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
