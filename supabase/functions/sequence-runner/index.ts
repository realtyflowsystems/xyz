/**
 * sequence-runner — Supabase Edge Function (Cron)
 * Processes all due sequence steps across active enrollments.
 * Replaces Make.com / Zapier automated follow-up flows.
 *
 * Schedule: every 30 minutes via Supabase pg_cron
 *   select cron.schedule('sequence-runner', '*/30 * * * *',
 *     $$select net.http_post(
 *       url:='https://<project>.supabase.co/functions/v1/sequence-runner',
 *       headers:='{"Authorization":"Bearer <anon_key>"}'::jsonb
 *     ) as request_id$$);
 *
 * Deploy:
 *   supabase functions deploy sequence-runner
 *
 * Required env vars:
 *   RESEND_API_KEY
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER
 *   RFS_FROM_EMAIL
 *   SUPABASE_URL            (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const now = new Date().toISOString();

  // Fetch all enrollments with a step due right now
  const { data: enrollments, error } = await supabase
    .from('sequence_enrollments')
    .select(`
      id, lead_id, sequence_id, current_step, next_send_at,
      sequences ( id, name ),
      leads ( id, fname, lname, email, phone, opted_out_sms )
    `)
    .eq('paused', false)
    .eq('cancelled', false)
    .is('completed_at', null)
    .lte('next_send_at', now);

  if (error) {
    console.error('Failed to fetch enrollments:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!enrollments || enrollments.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  let processed = 0;
  let skipped = 0;

  for (const enrollment of enrollments) {
    const lead = enrollment.leads as any;
    if (!lead) { skipped++; continue; }

    // Fetch the next step to send
    const nextStepNumber = enrollment.current_step + 1;
    const { data: step } = await supabase
      .from('sequence_steps')
      .select('*')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_number', nextStepNumber)
      .single();

    if (!step) {
      // No more steps — mark enrollment complete
      await supabase
        .from('sequence_enrollments')
        .update({ completed_at: now })
        .eq('id', enrollment.id);
      continue;
    }

    // Personalise content
    const personalise = (text: string | null): string => {
      if (!text) return '';
      return text
        .replace(/\{\{fname\}\}/g, lead.fname)
        .replace(/\{\{lname\}\}/g, lead.lname)
        .replace(/\{\{email\}\}/g, lead.email);
    };

    let sendError: string | null = null;

    if (step.channel === 'email') {
      const result = await sendSequenceEmail(
        lead,
        personalise(step.subject),
        personalise(step.body_html),
        enrollment.sequence_id,
        step.step_number
      );
      sendError = result?.error || null;

      await supabase.from('emails').insert({
        lead_id: lead.id,
        resend_id: result?.id || null,
        subject: personalise(step.subject),
        type: 'follow-up',
        sequence_id: enrollment.sequence_id,
        sequence_step: step.step_number,
        sent_at: now,
        error: sendError,
      });

    } else if (step.channel === 'sms' && !lead.opted_out_sms && lead.phone) {
      const result = await sendSequenceSMS(lead, personalise(step.body_text));
      sendError = result?.error || null;

      await supabase.from('sms_messages').insert({
        lead_id: lead.id,
        twilio_sid: result?.sid || null,
        body: personalise(step.body_text),
        status: result?.status || 'failed',
        type: 'follow-up',
        sent_at: now,
        error: sendError,
      });
    }

    // Check if there is a next step after this one
    const { data: nextStep } = await supabase
      .from('sequence_steps')
      .select('delay_hours')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('step_number', nextStepNumber + 1)
      .single();

    const nextSendAt = nextStep
      ? new Date(Date.now() + nextStep.delay_hours * 60 * 60 * 1000).toISOString()
      : null;

    await supabase
      .from('sequence_enrollments')
      .update({
        current_step: nextStepNumber,
        next_send_at: nextSendAt,
        completed_at: nextSendAt ? null : now,
      })
      .eq('id', enrollment.id);

    await supabase.from('activity_log').insert({
      lead_id: lead.id,
      type: step.channel === 'email' ? 'email' : 'sms',
      description: `Sequence "${(enrollment.sequences as any)?.name}" — step ${step.step_number} sent`,
      metadata: { sequence_id: enrollment.sequence_id, step: step.step_number, error: sendError },
    });

    processed++;
  }

  console.log(`sequence-runner: processed=${processed}, skipped=${skipped}`);
  return new Response(
    JSON.stringify({ processed, skipped }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});

// ── Send sequence email via Resend ───────────────────────────
async function sendSequenceEmail(
  lead: any,
  subject: string,
  bodyHtml: string,
  sequenceId: string,
  step: number
) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return { error: 'RESEND_API_KEY not set' };

  const fromEmail = Deno.env.get('RFS_FROM_EMAIL') || 'erics@realtyflow.xyz';

  const html = wrapEmailHtml(bodyHtml, lead.fname);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Erics @ RealtyFlow <${fromEmail}>`,
        to: lead.email,
        reply_to: fromEmail,
        subject,
        html,
        tags: [
          { name: 'sequence_id', value: sequenceId },
          { name: 'step', value: String(step) },
        ],
      }),
    });
    return await res.json();
  } catch (err) {
    return { error: String(err) };
  }
}

// ── Send sequence SMS via Twilio ─────────────────────────────
async function sendSequenceSMS(lead: any, body: string) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

  if (!accountSid || !authToken || !fromNumber) {
    return { error: 'Twilio not configured' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: lead.phone, From: fromNumber, Body: body }),
    });
    return await res.json();
  } catch (err) {
    return { error: String(err) };
  }
}

// ── Minimal email wrapper ────────────────────────────────────
function wrapEmailHtml(innerHtml: string, fname: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border:1px solid rgba(201,168,76,0.15);">
      <tr><td style="padding:32px 48px 24px;border-bottom:1px solid rgba(201,168,76,0.12);">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#C9A84C;letter-spacing:0.08em;">
          RealtyFlow <span style="font-weight:300;">Systems</span>
        </div>
      </td></tr>
      <tr><td style="padding:36px 48px 40px;font-size:15px;color:#CCCCCC;line-height:1.8;">
        ${innerHtml}
      </td></tr>
      <tr><td style="padding:20px 48px;border-top:1px solid rgba(201,168,76,0.08);">
        <p style="font-size:11px;color:#555555;margin:0;line-height:1.6;">
          RealtyFlow Systems · 820 Massachusetts Ave, Cambridge, MA 02139<br>
          <a href="https://realtyflow.xyz/privacy" style="color:#C9A84C;text-decoration:none;">Privacy</a> ·
          Reply to this email to unsubscribe.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
