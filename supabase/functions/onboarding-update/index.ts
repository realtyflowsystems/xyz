// onboarding-update — RealtyFlow Systems
// JWT-required. Called from command center to advance a client's build milestone.
// POST { client_id, stage } — updates onboarding_stage/stage_name, sends Resend email
// for stage >= 3, and logs to activity_log.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STAGE_NAMES: Record<number, string> = {
  0: "Welcome",
  1: "Kickoff Complete",
  2: "Build Started",
  3: "Live Setup",
  4: "Review",
  5: "Live",
};

const STAGE_SUBTITLES: Record<number, string> = {
  0: "Kickoff call being scheduled",
  1: "Credentials & database received",
  2: "System infrastructure being configured",
  3: "Sub-60s response active · sequences running",
  4: "Final review & optimizations in progress",
  5: "Your revenue system is fully live",
};

const STAGE_EMAIL_DESC: Record<number, string> = {
  3: "Your lead response system is live. New leads are getting immediate follow-up starting now.",
  4: "We're running final tests and optimizations. You'll hear from us within 24 hours.",
  5: "Your revenue infrastructure is fully live. The system is running.",
};

const PORTAL_BASE_URL = "https://realtyflow.xyz/portal";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: { client_id?: string; stage?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { client_id, stage } = body;

  if (!client_id) {
    return json({ error: "client_id is required" }, 400);
  }

  if (stage === undefined || stage === null || !Number.isInteger(stage) || stage < 0 || stage > 5) {
    return json({ error: "stage must be an integer 0–5" }, 400);
  }

  const stageName = STAGE_NAMES[stage];

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // 1. Update client milestone
  const { error: updateError } = await supabase
    .from("clients")
    .update({
      onboarding_stage: stage,
      onboarding_stage_name: stageName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", client_id);

  if (updateError) {
    console.error("clients update error:", updateError);
    return json({ error: updateError.message }, 500);
  }

  // 2. Get client + associated lead for email and activity log
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("id, portal_token, lead_id, leads(id, fname, lname, email)")
    .eq("id", client_id)
    .single();

  if (clientError || !clientRow) {
    console.error("client fetch error:", clientError);
    return json({ error: "Client not found after update" }, 404);
  }

  const lead = Array.isArray(clientRow.leads) ? clientRow.leads[0] : clientRow.leads;
  const leadId = lead?.id ?? clientRow.lead_id ?? null;
  const fname = lead?.fname ?? "there";
  const email = lead?.email ?? null;

  // 3. Send milestone email for stage >= 3
  if (stage >= 3 && email) {
    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const portalLink = clientRow.portal_token
      ? `${PORTAL_BASE_URL}/index.html?token=${clientRow.portal_token}`
      : `${PORTAL_BASE_URL}`;
    const emailDesc = STAGE_EMAIL_DESC[stage] ?? STAGE_SUBTITLES[stage];

    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>RealtyFlow Systems — ${stageName}</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'DM Sans',Arial,sans-serif;color:#FFFFFF;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:40px 20px;">
    <tr>
      <td>
        <!-- Logo -->
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:#C9A84C;letter-spacing:.08em;margin-bottom:4px;">RealtyFlow</div>
        <div style="font-size:9px;color:#888;letter-spacing:.2em;text-transform:uppercase;margin-bottom:36px;">SYSTEMS</div>

        <!-- Eyebrow -->
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#C9A84C;letter-spacing:.3em;text-transform:uppercase;margin-bottom:14px;">BUILD UPDATE</div>

        <!-- Greeting -->
        <p style="font-size:15px;color:#E0E0E0;line-height:1.7;margin:0 0 8px;">Hi ${fname}, quick update on your build:</p>

        <!-- Stage headline -->
        <div style="border-left:3px solid #C9A84C;padding:16px 20px;margin:24px 0;background:#111;">
          <div style="font-family:Georgia,serif;font-size:24px;font-weight:300;color:#FFFFFF;margin-bottom:8px;">${stageName}</div>
          <div style="font-size:13px;color:#C9A84C;letter-spacing:.05em;">Stage ${stage} of 5</div>
        </div>

        <!-- Description -->
        <p style="font-size:14px;color:#AAAAAA;line-height:1.75;margin:0 0 28px;">${emailDesc}</p>

        <!-- CTA -->
        <a href="${portalLink}" style="display:inline-block;padding:13px 28px;background:#C9A84C;color:#0A0A0A;font-size:11px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;text-decoration:none;">Track Your Progress →</a>

        <!-- Footer -->
        <div style="margin-top:40px;padding-top:20px;border-top:1px solid rgba(255,255,255,.08);">
          <p style="font-size:11px;color:#555;line-height:1.7;margin:0;">Questions? Reply to this email or text (617) 702-2742.<br/>RealtyFlow Systems · 820 Massachusetts Ave, Cambridge, MA 02139</p>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Erics at RealtyFlow <erics@realtyflow.xyz>",
        to: [email],
        subject: `Your RealtyFlow system — ${stageName}`,
        html: htmlBody,
      }),
    });

    if (!resendRes.ok) {
      const resendErr = await resendRes.json();
      console.error("Resend error:", resendErr);
      // Non-fatal — continue even if email fails
    }
  }

  // 4. Log to activity_log
  if (leadId) {
    const { error: logError } = await supabase.from("activity_log").insert({
      lead_id: leadId,
      type: "milestone_updated",
      description: `Build milestone: ${stageName}`,
      metadata: { stage, client_id },
    });

    if (logError) {
      console.error("activity_log insert error:", logError);
      // Non-fatal — continue
    }
  }

  return json({ success: true, stage, stage_name: stageName });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
