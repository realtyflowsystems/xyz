// intake-submit — RealtyFlow Systems
// POST { token, name, email, phone, market, brokerage, monthly_leads,
//         lead_sources, response_time, closings_90d, avg_commission,
//         current_crm, after_hours_flow, cold_follow_up, biggest_challenge }
// JWT off — called from public /intake page.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const {
    token,
    name,
    email,
    phone,
    market,
    brokerage,
    monthly_leads,
    lead_sources,
    response_time,
    closings_90d,
    avg_commission,
    current_crm,
    after_hours_flow,
    cold_follow_up,
    biggest_challenge,
  } = body as {
    token?: string;
    name?: string;
    email?: string;
    phone?: string;
    market?: string;
    brokerage?: string;
    monthly_leads?: number | null;
    lead_sources?: string[];
    response_time?: string;
    closings_90d?: number | null;
    avg_commission?: number | null;
    current_crm?: string;
    after_hours_flow?: string;
    cold_follow_up?: string;
    biggest_challenge?: string;
  };

  // Validate required fields
  if (!name || !name.trim()) {
    return new Response(JSON.stringify({ error: "Full name is required." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  if (!email || !email.trim()) {
    return new Response(JSON.stringify({ error: "Email address is required." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const nameParts = name.trim().split(/\s+/);
  const fname = nameParts[0] ?? "";
  const lname = nameParts.slice(1).join(" ") || "";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Step 1: Look up payment by stripe_checkout_session_id if token provided
  let lead_id: string | null = null;

  if (token && token.trim()) {
    const { data: payment } = await supabase
      .from("payments")
      .select("lead_id")
      .eq("stripe_checkout_session_id", token.trim())
      .maybeSingle();

    if (payment?.lead_id) {
      lead_id = payment.lead_id;
    }
  }

  // Step 2: Upsert lead by email — update name/phone/market fields
  const upsertPayload: Record<string, unknown> = {
    email: normalizedEmail,
    fname,
    lname,
  };
  if (phone)  upsertPayload.phone  = (phone as string).trim();
  if (market) upsertPayload.market = (market as string).trim();

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .upsert(upsertPayload, { onConflict: "email" })
    .select()
    .single();

  if (leadErr) {
    console.error("lead upsert error:", leadErr);
    return new Response(JSON.stringify({ error: "Failed to save lead." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Use the lead_id from payment lookup or from the upserted lead
  if (!lead_id) {
    lead_id = lead.id;
  }

  // Step 3: Insert activity_log entry
  const metadata = {
    token:             token || null,
    name:              name.trim(),
    email:             normalizedEmail,
    phone:             phone || null,
    market:            market || null,
    brokerage:         brokerage || null,
    monthly_leads:     monthly_leads ?? null,
    lead_sources:      lead_sources || [],
    response_time:     response_time || null,
    closings_90d:      closings_90d ?? null,
    avg_commission:    avg_commission ?? null,
    current_crm:       current_crm || null,
    after_hours_flow:  after_hours_flow || null,
    cold_follow_up:    cold_follow_up || null,
    biggest_challenge: biggest_challenge || null,
  };

  const { error: logErr } = await supabase.from("activity_log").insert({
    lead_id,
    type:        "intake_submitted",
    description: "Audit intake form submitted",
    metadata,
  });

  if (logErr) {
    console.error("activity_log insert error:", logErr);
    // Non-fatal — continue
  }

  // Step 4: Notify Erics via Resend
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    const subject = `Audit Intake Received — ${name.trim()}`;

    const formatRow = (label: string, value: unknown): string => {
      const display = Array.isArray(value)
        ? (value as string[]).join(", ") || "—"
        : value != null && value !== ""
        ? String(value)
        : "—";
      return `<tr>
        <td style="padding:8px 12px;font-size:12px;color:#AAAAAA;font-family:Arial,sans-serif;
                   white-space:nowrap;border-bottom:1px solid rgba(255,255,255,.05);
                   vertical-align:top;">${label}</td>
        <td style="padding:8px 12px;font-size:12px;color:#E0E0E0;font-family:Arial,sans-serif;
                   border-bottom:1px solid rgba(255,255,255,.05);
                   vertical-align:top;">${display}</td>
      </tr>`;
    };

    const tableRows = [
      formatRow("Name",              name.trim()),
      formatRow("Email",             normalizedEmail),
      formatRow("Phone",             phone),
      formatRow("Market",            market),
      formatRow("Brokerage",         brokerage),
      formatRow("Monthly Leads",     monthly_leads),
      formatRow("Lead Sources",      lead_sources),
      formatRow("Response Time",     response_time),
      formatRow("Closings (90d)",    closings_90d),
      formatRow("Avg Commission",    avg_commission != null ? `$${avg_commission.toLocaleString()}` : null),
      formatRow("CRM / Follow-Up",   current_crm),
      formatRow("After-Hours Flow",  after_hours_flow),
      formatRow("Cold Follow-Up",    cold_follow_up),
      formatRow("Biggest Challenge", biggest_challenge),
    ].join("");

    const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0A0A0A;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;">
<tr><td align="center" style="padding:40px 20px;">
<table width="560" cellpadding="0" cellspacing="0"
       style="max-width:560px;width:100%;background:#0A0A0A;border:1px solid rgba(201,168,76,.15);">

<tr><td style="padding:32px 40px 20px;border-bottom:1px solid rgba(201,168,76,.15);">
  <p style="margin:0 0 8px;font-size:10px;color:#C9A84C;letter-spacing:.3em;
            text-transform:uppercase;font-family:Arial,sans-serif;">RealtyFlow Systems — Internal</p>
  <h1 style="margin:0;font-size:24px;font-weight:300;color:#FFFFFF;
             font-family:Georgia,serif;line-height:1.2;">
    Audit Intake Received<br/>
    <em style="font-style:italic;color:#C9A84C;">${name.trim()}</em>
  </h1>
</td></tr>

<tr><td style="padding:28px 40px;">
  <table width="100%" cellpadding="0" cellspacing="0"
         style="background:#111111;border:1px solid rgba(255,255,255,.06);">
    <tr>
      <th style="padding:10px 12px;font-size:10px;color:#C9A84C;letter-spacing:.2em;
                 text-transform:uppercase;font-family:Arial,sans-serif;text-align:left;
                 border-bottom:1px solid rgba(201,168,76,.2);">Field</th>
      <th style="padding:10px 12px;font-size:10px;color:#C9A84C;letter-spacing:.2em;
                 text-transform:uppercase;font-family:Arial,sans-serif;text-align:left;
                 border-bottom:1px solid rgba(201,168,76,.2);">Answer</th>
    </tr>
    ${tableRows}
  </table>
</td></tr>

<tr><td style="padding:0 40px 32px;">
  <p style="margin:0;font-size:12px;color:#555555;font-family:Arial,sans-serif;line-height:1.6;">
    Token: ${token || "none"}<br/>
    Lead ID: ${lead_id}
  </p>
</td></tr>

<tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.05);">
  <p style="margin:0;font-size:11px;color:#333;font-family:Arial,sans-serif;line-height:1.6;">
    RealtyFlow Systems &middot; 820 Massachusetts Ave, Cambridge, MA 02139<br/>
    <a href="mailto:erics@realtyflow.xyz" style="color:#555;text-decoration:none;">erics@realtyflow.xyz</a>
    &middot; (617) 702-2742
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "RealtyFlow Systems internal <erics@realtyflow.xyz>",
          to:   ["erics@realtyflow.xyz"],
          subject,
          html: emailHtml,
        }),
      });
    } catch (err) {
      console.error("Resend notification failed:", err);
      // Non-fatal — return success regardless
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
