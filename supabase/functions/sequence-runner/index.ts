// sequence-runner — RealtyFlow Systems
// Replaces both sms-reminder and email-sequence functions.
// Handles ALL sequence steps (email + SMS) using the actual DB schema:
// sequences → sequence_steps → sequence_enrollments → leads
//
// Run every 30 minutes via pg_cron:
// select cron.schedule('sequence-runner', '*/30 * * * *',
//   $$select net.http_post(
//     url:='https://wufmcymarbkrjzaqapuu.supabase.co/functions/v1/sequence-runner',
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

  const now = new Date().toISOString();

  // Get all active enrollments that are due
  const { data: enrollments, error } = await supabase
    .from("sequence_enrollments")
    .select(`
      id,
      lead_id,
      sequence_id,
      current_step,
      next_send_at,
      leads ( id, fname, lname, email, phone, opted_out_sms ),
      sequences ( id, name, active )
    `)
    .eq("paused", false)
    .eq("cancelled", false)
    .is("completed_at", null)
    .lte("next_send_at", now)
    .limit(100);

  if (error) {
    console.error("sequence_enrollments query:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!enrollments?.length) {
    return new Response(JSON.stringify({ processed: 0, message: "Nothing due" }), { status: 200 });
  }

  const resendKey  = Deno.env.get("RESEND_API_KEY")!;
  const telnyxKey  = Deno.env.get("TELNYX_API_KEY")!;
  const fromPhone  = Deno.env.get("TELNYX_PHONE")!;

  let sent = 0;
  const errors: string[] = [];

  for (const enrollment of enrollments) {
    const lead     = enrollment.leads as Lead;
    const sequence = enrollment.sequences as Sequence;

    if (!sequence?.active) continue;

    const nextStepNumber = enrollment.current_step + 1;

    // Get the next step for this sequence
    const { data: step } = await supabase
      .from("sequence_steps")
      .select("*")
      .eq("sequence_id", enrollment.sequence_id)
      .eq("step_number", nextStepNumber)
      .single();

    if (!step) {
      // No more steps — mark complete
      await supabase
        .from("sequence_enrollments")
        .update({ completed_at: now })
        .eq("id", enrollment.id);
      continue;
    }

    // Personalize template variables
    const fname  = lead.fname ?? "there";
    const body   = personalize(step.body_text ?? "", fname);
    const subject = step.subject ? personalize(step.subject, fname) : null;

    let sendOk = false;

    if (step.channel === "email") {
      sendOk = await sendEmail(resendKey, {
        to:      lead.email,
        subject: subject ?? "(no subject)",
        html:    wrapEmailHtml(fname, personalize(step.body_html ?? step.body_text ?? "", fname)),
      });

      if (sendOk) {
        await supabase.from("emails").insert({
          lead_id:       lead.id,
          subject:       subject,
          type:          "sequence",
          sequence_id:   enrollment.sequence_id,
          sequence_step: nextStepNumber,
          sent_at:       now,
        });
      }
    } else if (step.channel === "sms") {
      if (lead.opted_out_sms || !lead.phone) {
        sendOk = true; // skip silently, advance step
      } else {
        sendOk = await sendSMS(telnyxKey, fromPhone, lead.phone, body);

        if (sendOk) {
          await supabase.from("sms_messages").insert({
            lead_id:  lead.id,
            body,
            type:     "reminder",
            direction: "outbound",
            status:   "queued",
            sent_at:  now,
          });
        }
      }
    }

    if (!sendOk) {
      errors.push(`enrollment ${enrollment.id} step ${nextStepNumber}`);
      continue;
    }

    // Find the step after next to schedule next_send_at
    const { data: futureStep } = await supabase
      .from("sequence_steps")
      .select("delay_hours")
      .eq("sequence_id", enrollment.sequence_id)
      .eq("step_number", nextStepNumber + 1)
      .single();

    const nextSendAt = futureStep
      ? new Date(Date.now() + futureStep.delay_hours * 3_600_000).toISOString()
      : null;

    await supabase
      .from("sequence_enrollments")
      .update({
        current_step: nextStepNumber,
        next_send_at: nextSendAt,
        ...(futureStep ? {} : { completed_at: now }),
      })
      .eq("id", enrollment.id);

    // Activity log
    await supabase.from("activity_log").insert({
      lead_id:     lead.id,
      type:        `sequence_${step.channel}_sent`,
      description: `${sequence.name} step ${nextStepNumber} (${step.channel}) sent`,
      metadata:    { sequence_id: enrollment.sequence_id, step: nextStepNumber },
    });

    sent++;
  }

  return new Response(
    JSON.stringify({ processed: enrollments.length, sent, errors: errors.length }),
    { headers: { "Content-Type": "application/json" } }
  );
});

// ── Helpers ────────────────────────────────────────────────────────────────

function personalize(template: string, fname: string): string {
  return template.replace(/\{\{fname\}\}/g, fname).replace(/\{\{name\}\}/g, fname);
}

async function sendEmail(
  apiKey: string,
  opts: { to: string; subject: string; html: string }
): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Erics at RealtyFlow <erics@realtyflow.xyz>",
        to:   [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendSMS(
  apiKey: string,
  from: string,
  to: string,
  body: string
): Promise<boolean> {
  try {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, text: body }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function wrapEmailHtml(fname: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/></head>
<body style="background:#0A0A0A;color:#fff;font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 40px;">
  <p style="font-size:10px;color:#C9A84C;letter-spacing:.3em;text-transform:uppercase;margin:0 0 24px;">RealtyFlow Systems</p>
  <div style="font-size:14px;color:#E0E0E0;line-height:1.8;">${content}</div>
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid rgba(255,255,255,.06);">
    <p style="font-size:11px;color:#444;margin:0;line-height:1.7;">
      RealtyFlow Systems · 820 Massachusetts Ave, Cambridge, MA 02139<br>
      <a href="mailto:erics@realtyflow.xyz?subject=Unsubscribe" style="color:#555;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;
}

// ── Types ──────────────────────────────────────────────────────────────────
interface Lead {
  id: string;
  fname: string;
  lname: string;
  email: string;
  phone: string | null;
  opted_out_sms: boolean;
}

interface Sequence {
  id: string;
  name: string;
  active: boolean;
}
