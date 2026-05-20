// monthly-report — RealtyFlow Systems
// Emails every active client (onboarding_stage >= 4) a 30-day performance summary.
//
// To schedule: select cron.schedule('monthly-report', '0 9 1 * *',
//   $$select net.http_post(
//     url:='https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/monthly-report',
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

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.warn("RESEND_API_KEY not set — email sending skipped");
  }

  // Month label for subject and email body
  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // 30-day window
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. Get all live clients (onboarding_stage >= 4) with lead info ─────────
  const { data: clients, error: clientsErr } = await supabase
    .from("clients")
    .select(`
      id,
      portal_token,
      onboarding_stage,
      lead_id,
      leads (
        id,
        fname,
        lname,
        email,
        tier
      )
    `)
    .gte("onboarding_stage", 4);

  if (clientsErr) {
    console.error("clients fetch:", clientsErr);
    return new Response(JSON.stringify({ error: clientsErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!clients || clients.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, skipped: "no live clients" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── 2. System-wide stats for the past 30 days ─────────────────────────────

  // bookings_count: leads who reached booked stage (stage >= 3) with bookings in window
  const { count: bookingsCount } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
    .in(
      "lead_id",
      (
        await supabase
          .from("leads")
          .select("id")
          .gte("stage", 3)
      ).data?.map((l: { id: string }) => l.id) ?? []
    );

  // new_leads_count: all leads created in the past 30 days
  const { count: newLeadsCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  // emails_sent_count: emails sent in the past 30 days
  const { count: emailsSentCount } = await supabase
    .from("emails")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", since);

  // revenue_30d: sum of succeeded payments in the past 30 days
  const { data: revenueRows } = await supabase
    .from("payments")
    .select("amount_cents")
    .eq("status", "succeeded")
    .gte("created_at", since);

  const revenue30d = (revenueRows ?? []).reduce(
    (sum: number, row: { amount_cents: number }) => sum + (row.amount_cents ?? 0),
    0
  ) / 100;

  const stats = {
    bookingsCount:  bookingsCount  ?? 0,
    newLeadsCount:  newLeadsCount  ?? 0,
    emailsSentCount: emailsSentCount ?? 0,
    revenue30d,
  };

  // ── 3. Send each client their report ──────────────────────────────────────
  const results: Array<{ client_id: string; email: string; status: string }> = [];

  for (const client of clients) {
    const lead = (client as unknown as { leads: { id: string; fname: string; lname: string; email: string; tier: string | null } | null }).leads;

    if (!lead?.email) {
      console.warn(`client ${client.id}: no lead email, skipping`);
      results.push({ client_id: client.id, email: "", status: "skipped_no_email" });
      continue;
    }

    const portalToken = (client as unknown as { portal_token: string }).portal_token;

    if (!resendKey) {
      results.push({ client_id: client.id, email: lead.email, status: "skipped_no_resend_key" });
      continue;
    }

    const subject  = `Your RealtyFlow Report — ${monthYear}`;
    const html     = monthlyReportEmail(lead.fname, monthYear, stats, portalToken);

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Erics at RealtyFlow <erics@realtyflow.xyz>",
          to:   [lead.email],
          subject,
          html,
        }),
      });

      const payload = await res.json();

      if (!res.ok) {
        console.error(`send to ${lead.email}:`, payload);
        results.push({ client_id: client.id, email: lead.email, status: `error_${res.status}` });
        continue;
      }

      console.log(`sent to ${lead.email}:`, payload?.id);
      results.push({ client_id: client.id, email: lead.email, status: "sent" });

      // Log the send in emails table
      await supabase.from("emails").insert({
        lead_id: lead.id,
        subject,
        type:    "monthly_report",
        sent_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`send error for ${lead.email}:`, err);
      results.push({ client_id: client.id, email: lead.email, status: "error_exception" });
    }
  }

  const sentCount = results.filter(r => r.status === "sent").length;
  console.log(`monthly-report complete: ${sentCount}/${clients.length} sent`);

  return new Response(
    JSON.stringify({ sent: sentCount, results }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

// ── Email helpers ─────────────────────────────────────────────────────────────

interface ReportStats {
  newLeadsCount:   number;
  bookingsCount:   number;
  emailsSentCount: number;
  revenue30d:      number;
}

function emailShell(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0A0A0A;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;">
<tr><td align="center" style="padding:40px 20px;">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0A0A0A;border:1px solid rgba(201,168,76,.15);">
${body}
<tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.05);">
  <p style="margin:0;font-size:11px;color:#333;font-family:Arial,sans-serif;line-height:1.6;">
    RealtyFlow Systems &middot; 820 Massachusetts Ave Cambridge MA<br/>
    <a href="mailto:erics@realtyflow.xyz" style="color:#555;text-decoration:none;">erics@realtyflow.xyz</a>
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function monthlyReportEmail(
  fname: string,
  monthYear: string,
  stats: ReportStats,
  portalToken: string
): string {
  const portalUrl = `https://realtyflow.xyz/portal?token=${portalToken}`;

  return emailShell(`
<tr><td style="padding:36px 40px 24px;border-bottom:1px solid rgba(201,168,76,.15);">
  <p style="margin:0 0 10px;font-size:10px;color:#C9A84C;letter-spacing:.3em;text-transform:uppercase;font-family:Arial,sans-serif;">RealtyFlow Systems</p>
  <h1 style="margin:0;font-size:26px;font-weight:300;color:#FFFFFF;line-height:1.2;font-family:Georgia,serif;">
    Monthly Performance Report
  </h1>
  <p style="margin:8px 0 0;font-size:13px;color:#777;font-family:Arial,sans-serif;">${monthYear}</p>
</td></tr>

<tr><td style="padding:28px 40px 20px;">
  <p style="margin:0;font-size:14px;color:#AAAAAA;line-height:1.7;font-family:Arial,sans-serif;">
    Hi ${fname},
  </p>
  <p style="margin:12px 0 0;font-size:14px;color:#AAAAAA;line-height:1.7;font-family:Arial,sans-serif;">
    Here's your system activity for ${monthYear}.
  </p>
</td></tr>

<tr><td style="padding:0 40px 32px;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="33%" style="padding:0 8px 0 0;text-align:center;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid rgba(201,168,76,.12);">
          <tr><td style="padding:24px 16px 20px;text-align:center;">
            <p style="margin:0 0 6px;font-size:32px;font-weight:700;color:#FFFFFF;font-family:Arial,sans-serif;line-height:1;">${stats.newLeadsCount}</p>
            <p style="margin:0;font-size:9px;color:#C9A84C;letter-spacing:.2em;text-transform:uppercase;font-family:Arial,sans-serif;">New Leads<br/>Captured</p>
          </td></tr>
        </table>
      </td>
      <td width="33%" style="padding:0 4px;text-align:center;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid rgba(201,168,76,.12);">
          <tr><td style="padding:24px 16px 20px;text-align:center;">
            <p style="margin:0 0 6px;font-size:32px;font-weight:700;color:#FFFFFF;font-family:Arial,sans-serif;line-height:1;">${stats.bookingsCount}</p>
            <p style="margin:0;font-size:9px;color:#C9A84C;letter-spacing:.2em;text-transform:uppercase;font-family:Arial,sans-serif;">Bookings<br/>Generated</p>
          </td></tr>
        </table>
      </td>
      <td width="33%" style="padding:0 0 0 8px;text-align:center;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid rgba(201,168,76,.12);">
          <tr><td style="padding:24px 16px 20px;text-align:center;">
            <p style="margin:0 0 6px;font-size:32px;font-weight:700;color:#FFFFFF;font-family:Arial,sans-serif;line-height:1;">${stats.emailsSentCount}</p>
            <p style="margin:0;font-size:9px;color:#C9A84C;letter-spacing:.2em;text-transform:uppercase;font-family:Arial,sans-serif;">Emails<br/>Delivered</p>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px 28px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(255,255,255,.06);">
    <tr><td style="padding:24px 0 0;">
      <p style="margin:0;font-size:14px;color:#888;line-height:1.8;font-family:Georgia,serif;font-style:italic;">
        Your system is actively working. Every lead that comes through gets an immediate response — while your competitors are still checking their phones.
      </p>
    </td></tr>
  </table>
</td></tr>

<tr><td style="padding:0 40px 36px;">
  <a href="${portalUrl}"
     style="display:inline-block;padding:16px 32px;background:#C9A84C;color:#0A0A0A;
            font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;
            text-decoration:none;font-family:Arial,sans-serif;">
    View Your Portal &rarr;
  </a>
</td></tr>
`);
}
