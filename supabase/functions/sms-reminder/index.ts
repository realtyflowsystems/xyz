// sms-reminder — RealtyFlow Systems
// Runs every 5 minutes via Supabase pg_cron.
// Sends Twilio SMS 1 hour before each confirmed booking.
//
// To schedule: Dashboard → Database → Extensions → enable pg_cron, then:
// select cron.schedule('sms-reminder', '*/5 * * * *',
//   $$select net.http_post(
//     url:='https://YOUR_PROJECT_ID.supabase.co/functions/v1/sms-reminder',
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

  // Find confirmed bookings in the 55–65 min window that haven't been reminded
  const windowStart = new Date(Date.now() + 55 * 60 * 1000).toISOString();
  const windowEnd   = new Date(Date.now() + 65 * 60 * 1000).toISOString();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("status", "confirmed")
    .eq("sms_reminder_sent", false)
    .gte("scheduled_at", windowStart)
    .lte("scheduled_at", windowEnd);

  if (error) {
    console.error("DB query error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const results: { booking_id: string; status: string }[] = [];

  for (const booking of bookings ?? []) {
    if (!booking.phone) continue;

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken  = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const fromPhone  = Deno.env.get("TWILIO_PHONE_NUMBER")!;

    const firstName = booking.name.split(" ")[0];
    const message =
      `Hi ${firstName} — your RealtyFlow Revenue Audit starts in 1 hour. ` +
      `We'll call you at this number. ` +
      `Questions? Email erics@realtyflow.xyz. Reply STOP to opt out.`;

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: fromPhone,
          To:   booking.phone,
          Body: message,
        }).toString(),
      }
    );

    const twilioData = await twilioRes.json();

    await supabase.from("sms_log").insert({
      lead_id:    booking.lead_id,
      to_phone:   booking.phone,
      message,
      twilio_sid: twilioData.sid ?? null,
      status:     twilioData.status ?? "queued",
    });

    await supabase
      .from("bookings")
      .update({ sms_reminder_sent: true })
      .eq("id", booking.id);

    results.push({ booking_id: booking.id, status: twilioData.status ?? "sent" });
  }

  return new Response(
    JSON.stringify({ checked: bookings?.length ?? 0, sent: results.length, results }),
    { headers: { "Content-Type": "application/json" } }
  );
});
