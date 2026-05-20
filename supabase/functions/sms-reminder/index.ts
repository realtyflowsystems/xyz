// sms-reminder — RealtyFlow Systems
// Runs every 5 minutes via Supabase pg_cron.
// Sends Telnyx SMS 1 hour before each confirmed booking.
//
// To schedule: Dashboard → Database → Extensions → enable pg_cron, then:
// select cron.schedule('sms-reminder', '*/5 * * * *',
//   $$select net.http_post(
//     url:='https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/sms-reminder',
//     headers:='{"Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
//   )$$
// );

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const TELNYX_KEY   = Deno.env.get("TELNYX_API_KEY")!;
  const TELNYX_PHONE = Deno.env.get("TELNYX_PHONE")!;

  // Find confirmed bookings in the 55–65 min window that haven't been reminded
  const windowStart = new Date(Date.now() + 55 * 60 * 1000).toISOString();
  const windowEnd   = new Date(Date.now() + 65 * 60 * 1000).toISOString();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, lead_id, slot_time, status, reminder_1h_sent, leads(fname, phone, opted_out_sms)")
    .eq("status", "confirmed")
    .eq("reminder_1h_sent", false)
    .gte("slot_time", windowStart)
    .lte("slot_time", windowEnd);

  if (error) {
    console.error("DB query error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const results: { booking_id: string; status: string }[] = [];

  for (const booking of bookings ?? []) {
    const lead = booking.leads as { fname: string; phone: string | null; opted_out_sms: boolean } | null;
    if (!lead?.phone || lead.opted_out_sms) continue;

    const firstName = lead.fname ?? "there";
    const message =
      `Hi ${firstName} — your RealtyFlow Revenue Audit starts in 1 hour. ` +
      `We'll call you at this number. ` +
      `Questions? Email erics@realtyflow.xyz. Reply STOP to opt out.`;

    const telnyxRes = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: TELNYX_PHONE, to: lead.phone, text: message }),
    });

    const telnyxData = await telnyxRes.json();
    const msgId      = telnyxData?.data?.id ?? null;
    const msgStatus  = telnyxData?.data?.to?.[0]?.status ?? "queued";

    await supabase.from("sms_log").insert({
      lead_id:   booking.lead_id,
      to_phone:  lead.phone,
      message,
      twilio_sid: msgId,   // column kept for schema compatibility; stores Telnyx message ID
      status:    msgStatus,
    });

    await supabase
      .from("bookings")
      .update({ reminder_1h_sent: true })
      .eq("id", booking.id);

    results.push({ booking_id: booking.id, status: msgStatus });
  }

  return new Response(
    JSON.stringify({ checked: bookings?.length ?? 0, sent: results.length, results }),
    { headers: { "Content-Type": "application/json" } }
  );
});
