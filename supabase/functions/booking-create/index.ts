/**
 * booking-create — Supabase Edge Function
 * Replaces the Make.com webhook in booking.html.
 *
 * Flow:
 *   1. Validate + sanitize inbound booking form data
 *   2. Upsert lead in `leads` table
 *   3. Create row in `bookings` table
 *   4. Log to `activity_log`
 *   5. Send confirmation email via Resend
 *   6. Send confirmation SMS via Twilio
 *   7. Auto-enroll lead in "Post-Booking Nurture" sequence
 *
 * Deploy:
 *   supabase functions deploy booking-create
 *
 * Required env vars (set in Supabase Dashboard > Settings > Edge Functions):
 *   RESEND_API_KEY
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER   (+1XXXXXXXXXX)
 *   RFS_FROM_EMAIL       (erics@realtyflow.xyz)
 *   RFS_REPLY_TO         (erics@realtyflow.xyz)
 *   SUPABASE_URL         (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://realtyflow.xyz',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const { name, email, phone, source, timestamp } = body;

    // ── Validate ─────────────────────────────────────────────
    if (!name || !email) {
      return jsonError('Name and email are required', 400);
    }
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(email)) {
      return jsonError('Invalid email address', 400);
    }

    // ── Parse name ───────────────────────────────────────────
    const parts = name.trim().split(/\s+/);
    const fname = parts[0];
    const lname = parts.slice(1).join(' ') || '';

    // ── Supabase client (service role bypasses RLS) ──────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ── Upsert lead (same email = same lead) ─────────────────
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .upsert(
        {
          fname,
          lname,
          email: email.toLowerCase().trim(),
          phone: phone || null,
          source: source || 'Booking Page',
          stage: 2,
          stage_name: 'Audit Booked',
        },
        { onConflict: 'email', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (leadErr || !lead) {
      console.error('Lead upsert error:', leadErr);
      return jsonError('Failed to create lead', 500);
    }

    // ── Create booking ───────────────────────────────────────
    const slotTime = timestamp ? new Date(timestamp) : new Date();
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .insert({
        lead_id: lead.id,
        slot_time: slotTime.toISOString(),
        status: 'confirmed',
        confirmation_sent: false,
      })
      .select()
      .single();

    if (bookingErr) {
      console.error('Booking insert error:', bookingErr);
    }

    // ── Activity log ─────────────────────────────────────────
    await supabase.from('activity_log').insert({
      lead_id: lead.id,
      type: 'booking',
      description: `Revenue Audit booked from ${source || 'Booking Page'}`,
      metadata: { booking_id: booking?.id, slot_time: slotTime.toISOString() },
    });

    // ── Confirmation email via Resend ────────────────────────
    const emailResult = await sendConfirmationEmail(lead, booking);

    // ── Confirmation SMS via Twilio ──────────────────────────
    if (lead.phone) {
      const smsResult = await sendConfirmationSMS(lead);
      await supabase.from('sms_messages').insert({
        lead_id: lead.id,
        twilio_sid: smsResult?.sid || null,
        body: buildSMSBody(lead.fname),
        status: smsResult?.status || 'failed',
        type: 'confirmation',
        sent_at: new Date().toISOString(),
        error: smsResult?.error || null,
      });
    }

    // ── Log email ────────────────────────────────────────────
    await supabase.from('emails').insert({
      lead_id: lead.id,
      resend_id: emailResult?.id || null,
      subject: 'Your RFS Revenue Audit is confirmed ✓',
      type: 'confirmation',
      sent_at: new Date().toISOString(),
      error: emailResult?.error || null,
    });

    // Update booking confirmation flag
    if (booking) {
      await supabase
        .from('bookings')
        .update({ confirmation_sent: true })
        .eq('id', booking.id);
    }

    // ── Enroll in Post-Booking Nurture sequence ───────────────
    const { data: seq } = await supabase
      .from('sequences')
      .select('id')
      .eq('trigger_stage', 2)
      .eq('active', true)
      .single();

    if (seq) {
      await supabase.from('sequence_enrollments').insert({
        lead_id: lead.id,
        sequence_id: seq.id,
        current_step: 0,
        next_send_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h
      });
    }

    return new Response(
      JSON.stringify({ success: true, lead_id: lead.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Unhandled error:', err);
    return jsonError('Internal server error', 500);
  }
});

// ── Email via Resend ─────────────────────────────────────────
async function sendConfirmationEmail(lead: any, booking: any) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return { error: 'RESEND_API_KEY not set' };

  const fromEmail = Deno.env.get('RFS_FROM_EMAIL') || 'erics@realtyflow.xyz';
  const replyTo  = Deno.env.get('RFS_REPLY_TO')  || 'erics@realtyflow.xyz';

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Revenue Audit Confirmed</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111111;border:1px solid rgba(201,168,76,0.15);">
      <!-- Header -->
      <tr>
        <td style="padding:40px 48px 32px;border-bottom:1px solid rgba(201,168,76,0.12);">
          <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#C9A84C;letter-spacing:0.08em;">
            RealtyFlow <span style="font-weight:300;">Systems</span>
          </div>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="padding:40px 48px;">
          <p style="font-size:13px;color:#C9A84C;letter-spacing:0.25em;text-transform:uppercase;margin:0 0 16px;font-family:monospace;">
            Revenue Audit · Confirmed
          </p>
          <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:300;color:#FFFFFF;margin:0 0 24px;line-height:1.2;">
            You're locked in, ${lead.fname}.
          </h1>
          <p style="font-size:15px;color:#CCCCCC;line-height:1.75;margin:0 0 32px;">
            Your Revenue Audit is confirmed. I'll be calling you at your scheduled time —
            this is a no-fluff, 30-minute call built to find exactly where your pipeline
            is leaking money and show you what it takes to fix it.
          </p>

          <table cellpadding="0" cellspacing="0" width="100%" style="background:rgba(201,168,76,0.05);border:1px solid rgba(201,168,76,0.15);margin-bottom:32px;">
            <tr>
              <td style="padding:24px 28px;">
                <p style="font-family:monospace;font-size:10px;color:#C9A84C;letter-spacing:0.2em;text-transform:uppercase;margin:0 0 16px;">
                  How to prepare
                </p>
                <ul style="font-size:14px;color:#CCCCCC;line-height:2;margin:0;padding-left:20px;">
                  <li>Your average monthly lead volume</li>
                  <li>Your current speed-to-respond (be honest)</li>
                  <li>Last 3 months of closed transactions</li>
                  <li>Your biggest friction point right now</li>
                </ul>
              </td>
            </tr>
          </table>

          <p style="font-size:14px;color:#AAAAAA;line-height:1.7;margin:0 0 8px;">
            If anything comes up and you need to reschedule, just reply to this email
            and we'll find another time.
          </p>
          <p style="font-size:14px;color:#AAAAAA;line-height:1.7;margin:0 0 40px;">
            See you on the call.
          </p>
          <p style="font-size:15px;color:#FFFFFF;margin:0;">— Erics</p>
          <p style="font-size:13px;color:#666666;margin:4px 0 0;">RealtyFlow Systems · Boston, MA</p>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="padding:24px 48px;border-top:1px solid rgba(201,168,76,0.08);">
          <p style="font-size:11px;color:#555555;margin:0;line-height:1.6;">
            RealtyFlow Systems · 820 Massachusetts Ave, Cambridge, MA 02139<br>
            You're receiving this because you booked a Revenue Audit at realtyflow.xyz.<br>
            <a href="mailto:erics@realtyflow.xyz" style="color:#C9A84C;text-decoration:none;">Contact us</a> ·
            <a href="https://realtyflow.xyz/privacy" style="color:#C9A84C;text-decoration:none;">Privacy Policy</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

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
        reply_to: replyTo,
        subject: 'Your RFS Revenue Audit is confirmed ✓',
        html,
      }),
    });

    const data = await res.json();
    return data;
  } catch (err) {
    console.error('Resend error:', err);
    return { error: String(err) };
  }
}

// ── SMS via Twilio ───────────────────────────────────────────
function buildSMSBody(fname: string): string {
  return `Hey ${fname} — your RealtyFlow Revenue Audit is confirmed. I'll be calling you at your scheduled time. Reply STOP to opt out. — Erics`;
}

async function sendConfirmationSMS(lead: any) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

  if (!accountSid || !authToken || !fromNumber) {
    console.warn('Twilio env vars not set — skipping SMS');
    return { error: 'Twilio not configured' };
  }
  if (!lead.phone) return { error: 'No phone number' };

  const body = buildSMSBody(lead.fname);
  const url  = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: lead.phone, From: fromNumber, Body: body }),
    });

    const data = await res.json();
    return data;
  } catch (err) {
    console.error('Twilio error:', err);
    return { error: String(err) };
  }
}

// ── Helpers ──────────────────────────────────────────────────
function jsonError(message: string, status: number) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
