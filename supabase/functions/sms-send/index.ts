/**
 * sms-send — Supabase Edge Function
 * Send a one-off SMS via Twilio and log it.
 * Called by command-center.html on stage-change events.
 *
 * Deploy: supabase functions deploy sms-send
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER
 *   SUPABASE_URL            (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { lead_id, phone, body, type = 'manual' } = await req.json();

  if (!phone || !body) {
    return new Response(JSON.stringify({ error: 'phone and body required' }), {
      status: 400, headers: corsHeaders,
    });
  }

  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER');

  if (!accountSid || !authToken || !fromNumber) {
    return new Response(JSON.stringify({ error: 'Twilio not configured' }), {
      status: 500, headers: corsHeaders,
    });
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  let twilioSid: string | null = null;
  let status = 'failed';
  let error: string | null = null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phone, From: fromNumber, Body: body }),
    });
    const data = await res.json();
    twilioSid = data.sid || null;
    status    = data.status || 'failed';
    error     = data.message || null;
  } catch (err) {
    error = String(err);
  }

  // Log to Supabase if lead_id provided
  if (lead_id) {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    await supabase.from('sms_messages').insert({
      lead_id,
      twilio_sid: twilioSid,
      body,
      status,
      type,
      sent_at: new Date().toISOString(),
      error,
    });
  }

  return new Response(
    JSON.stringify({ success: status !== 'failed', sid: twilioSid, status, error }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
