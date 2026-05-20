import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const ERICS_PHONE  = Deno.env.get('ERICS_PHONE')!;
const TELNYX_KEY   = Deno.env.get('TELNYX_API_KEY')!;
const TELNYX_PHONE = Deno.env.get('TELNYX_PHONE')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // ── GET: poll for new messages ──────────────────────────
    if (req.method === 'GET') {
      const sk = new URL(req.url).searchParams.get('session_key');
      if (!sk) return err('Missing session_key', 400);

      const { data: session } = await supabase
        .from('chat_sessions').select('id')
        .eq('session_key', sk).single();
      if (!session) return err('Session not found', 404);

      // Update last_seen_at so we know the visitor is still on the page
      await supabase.from('chat_sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', session.id);

      const { data: msgs } = await supabase
        .from('chat_messages').select('id,sender,body,created_at')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true });

      return ok({ messages: msgs ?? [] });
    }

    // ── POST: send a message ────────────────────────────────
    const body = await req.json();
    const { session_key, name, email, message } = body;

    if (!message?.trim()) return err('Message is required', 400);

    let sessionId: string;
    let sessionKeyOut: string;
    let visitorName: string;
    let visitorEmail: string | null;
    let isNewSession = false;

    if (session_key) {
      const { data: session } = await supabase
        .from('chat_sessions')
        .select('id,session_key,visitor_name,visitor_email')
        .eq('session_key', session_key).single();
      if (!session) return err('Session not found', 404);
      sessionId     = session.id;
      sessionKeyOut = session.session_key;
      visitorName   = session.visitor_name ?? 'Visitor';
      visitorEmail  = session.visitor_email;
    } else {
      if (!name?.trim()) return err('Name is required for new session', 400);
      const { data: session, error } = await supabase
        .from('chat_sessions')
        .insert({ visitor_name: name.trim(), visitor_email: email?.trim() || null })
        .select('id,session_key,visitor_name,visitor_email').single();
      if (error || !session) return err('Failed to create session', 500);
      sessionId     = session.id;
      sessionKeyOut = session.session_key;
      visitorName   = session.visitor_name!;
      visitorEmail  = session.visitor_email;
      isNewSession  = true;
    }

    const now = new Date().toISOString();

    // Store visitor message
    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      sender: 'visitor',
      body: message.trim(),
    });

    // On first message: store auto-reply so widget never feels dead
    if (isNewSession) {
      const firstName = visitorName.split(' ')[0];
      await supabase.from('chat_messages').insert({
        session_id: sessionId,
        sender: 'agent',
        body: `Hey ${firstName}! Got it — Erics will be with you in just a moment.`,
      });
    }

    await supabase.from('chat_sessions')
      .update({ last_message_at: now, last_seen_at: now })
      .eq('id', sessionId);

    // SMS Erics — include short code for multi-session routing
    const shortKey = sessionKeyOut.replace(/-/g, '').substring(0, 6).toUpperCase();
    const smsBody  = `💬 RFS Chat [${shortKey}]\n${visitorName}: ${message.trim()}\n\nReply to respond.`;
    await sms(smsBody);

    // Return all messages
    const { data: msgs } = await supabase
      .from('chat_messages').select('id,sender,body,created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    return ok({ session_key: sessionKeyOut, messages: msgs ?? [] });

  } catch (e) {
    console.error(e);
    return err('Internal error', 500);
  }
});

async function sms(body: string) {
  await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TELNYX_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: TELNYX_PHONE, to: ERICS_PHONE, text: body }),
  });
}

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
function err(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
