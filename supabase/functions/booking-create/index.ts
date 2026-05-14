// booking-create — RealtyFlow Systems
// Replaces Make.com webhook. Triggered by booking.html form submission.
// Actions: log lead → send confirmation email → mark for SMS reminder

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { name, email, phone, scheduled_at, source } = body;

    if (!name?.trim() || !email?.trim() || !phone?.trim()) {
      return json({ error: "name, email, and phone are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Upsert lead — deduplicates on email
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .upsert(
        {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          source: source ?? "realtyflow.xyz/booking",
          stage: "booked",
        },
        { onConflict: "email" }
      )
      .select()
      .single();

    if (leadErr) throw leadErr;

    // Create booking record
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .insert({
        lead_id: lead.id,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        scheduled_at: scheduled_at ?? null,
        status: "confirmed",
      })
      .select()
      .single();

    if (bookingErr) throw bookingErr;

    // Send confirmation email via Resend
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "RealtyFlow Systems <erics@realtyflow.xyz>",
          to: [email.trim()],
          subject: "Your Revenue Audit is Confirmed — RealtyFlow Systems",
          html: confirmationEmail(name.trim(), scheduled_at),
        }),
      });

      const emailData = await emailRes.json();

      await supabase.from("email_log").insert({
        lead_id: lead.id,
        to_email: email.trim(),
        subject: "Your Revenue Audit is Confirmed",
        type: "confirmation",
        resend_id: emailData.id ?? null,
      });
    }

    return json({ success: true, booking_id: booking.id, lead_id: lead.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("booking-create error:", msg);
    return json({ error: "Booking failed", detail: msg }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function confirmationEmail(name: string, scheduledAt?: string): string {
  const firstName = name.split(" ")[0];
  const timeBlock = scheduledAt
    ? `<div style="background:#111;border-left:3px solid #C9A84C;padding:16px 20px;margin:24px 0;">
         <p style="font-size:10px;color:#C9A84C;letter-spacing:.25em;text-transform:uppercase;margin:0 0 6px;">Your Scheduled Time</p>
         <p style="font-size:18px;color:#fff;font-weight:300;margin:0;">${new Date(scheduledAt).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} ET</p>
       </div>`
    : `<p style="color:#888;font-size:13px;line-height:1.7;margin:16px 0;">We'll reach out within 24 hours to lock in your time. Check your inbox.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="background:#0A0A0A;color:#fff;font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;padding:0;">
  <div style="padding:32px 40px;border-bottom:1px solid rgba(201,168,76,.2);">
    <p style="font-size:10px;color:#C9A84C;letter-spacing:.3em;text-transform:uppercase;margin:0 0 8px;">RealtyFlow Systems</p>
    <h1 style="font-size:30px;font-weight:300;margin:0;line-height:1.2;">Revenue Audit<br><em style="font-style:italic;color:#C9A84C;">Confirmed</em></h1>
  </div>
  <div style="padding:32px 40px;">
    <p style="font-size:15px;color:#E0E0E0;margin:0 0 12px;">Hi ${firstName},</p>
    <p style="font-size:14px;color:#AAA;line-height:1.75;margin:0 0 16px;">
      You've secured your 15-minute Revenue Audit. This call will show you exactly how much revenue is slipping through your lead flow — and what recovery looks like in your specific market.
    </p>
    ${timeBlock}
    <div style="background:#111;border:1px solid rgba(201,168,76,.15);padding:24px;margin:24px 0;">
      <p style="font-size:10px;color:#C9A84C;letter-spacing:.25em;text-transform:uppercase;margin:0 0 14px;">Come Prepared With</p>
      <ul style="color:#AAA;font-size:13px;line-height:2;padding-left:18px;margin:0;">
        <li>Monthly lead volume (Zillow, referral, organic combined)</li>
        <li>Current average response time to new leads</li>
        <li>Closings per month over the last 90 days</li>
      </ul>
    </div>
    <p style="font-size:13px;color:#AAA;line-height:1.75;">
      Questions before the call? Reply here or reach me directly at
      <a href="mailto:erics@realtyflow.xyz" style="color:#C9A84C;text-decoration:none;">erics@realtyflow.xyz</a>
    </p>
  </div>
  <div style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.06);">
    <p style="font-size:11px;color:#444;margin:0;line-height:1.7;">
      RealtyFlow Systems · 820 Massachusetts Ave, Cambridge, MA 02139<br>
      MA TCPA Compliant · You consented to receive this confirmation at booking.<br>
      <a href="mailto:erics@realtyflow.xyz?subject=Unsubscribe" style="color:#555;text-decoration:underline;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;
}
