// Telnyx incoming-SMS webhook — fires when Erics texts back to the Telnyx number.
// Routes reply to the most recent open session and notifies the visitor.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'https://esm.sh/resend@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const resend = new Resend(Deno.env.get('RESEND_API_KEY')!);

const ERICS_PHONE = Deno.env.get('ERICS_PHONE')!;
const OFFLINE_MS  = 3 * 60 * 1000; // 3 minutes

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('', { status: 405 });

  let from = '';
  let body = '';
  try {
    const payload = await req.json();
    // Telnyx webhook envelope: data.payload.from.phone_number + data.payload.text
    const p = payload?.data?.payload;
    from = p?.from?.phone_number ?? '';
    body = (p?.text ?? '').trim();
  } catch {
    return new Response('', { status: 400 });
  }

  // Only accept messages from Erics's phone
  if (!isSamePhone(from, ERICS_PHONE) || !body) {
    return new Response('', { status: 200 });
  }

  // Find most recent open session
  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id,session_key,visitor_name,visitor_email,last_seen_at')
    .eq('status', 'open')
    .order('last_message_at', { ascending: false })
    .limit(1).single();

  if (!session) {
    return new Response(JSON.stringify({ message: 'No active chat sessions.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Store agent reply and reset auto_reply_sent so future visitor messages can re-trigger it
  await supabase.from('chat_messages').insert({
    session_id: session.id,
    sender: 'agent',
    body,
  });
  await supabase.from('chat_sessions')
    .update({ last_message_at: new Date().toISOString(), auto_reply_sent: false })
    .eq('id', session.id);

  // Email the visitor if they've left the page and have an email on file
  const lastSeen  = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
  const isOffline = (Date.now() - lastSeen) > OFFLINE_MS;
  const hasEmail  = !!session.visitor_email;
  const firstName = (session.visitor_name ?? 'there').split(' ')[0];

  if (isOffline && hasEmail) {
    await resend.emails.send({
      from: 'Erics at RealtyFlow <erics@realtyflow.xyz>',
      to:   [session.visitor_email!],
      subject: `Re: Your question — RealtyFlow Systems`,
      html: emailHtml(firstName, body),
    });
  }

  return new Response('', { status: 200 });
});

function isSamePhone(a: string, b: string): boolean {
  const clean = (s: string) => s.replace(/\D/g, '').slice(-10);
  return clean(a) === clean(b);
}

function emailHtml(firstName: string, reply: string) {
  const escaped = reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<!DOCTYPE html><html><body style="background:#0A0A0A;font-family:'DM Sans',Arial,sans-serif;padding:40px 20px;margin:0;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
  <tr><td style="padding:32px;background:#111111;border:1px solid rgba(201,168,76,.15);">
    <p style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;color:#C9A84C;margin:0 0 24px;">RealtyFlow Systems</p>
    <p style="color:#E0E0E0;font-size:15px;line-height:1.7;margin:0 0 20px;">Hey ${firstName},</p>
    <p style="color:#E0E0E0;font-size:15px;line-height:1.7;margin:0 0 28px;">${escaped}</p>
    <p style="color:#AAAAAA;font-size:13px;line-height:1.6;margin:0;">— Erics<br/>
    <a href="mailto:erics@realtyflow.xyz" style="color:#C9A84C;">erics@realtyflow.xyz</a> &middot; (617) 702-2742</p>
  </td></tr>
  <tr><td style="padding:16px 0;text-align:center;">
    <p style="color:rgba(255,255,255,.3);font-size:11px;margin:0;">RealtyFlow Systems &middot; 820 Massachusetts Ave, Cambridge MA 02139</p>
  </td></tr>
</table></body></html>`;
}
