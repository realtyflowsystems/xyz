// checkout-info — RealtyFlow Systems
// GET ?session_id=cs_xxx
// Returns { found, fname, tier, description, amount_cents } from payments + leads.
// JWT off — called from public thank-you page immediately after Stripe redirect.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return new Response('', { status: 405 });

  const sessionId = new URL(req.url).searchParams.get('session_id');
  if (!sessionId) {
    return new Response(JSON.stringify({ found: false }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const { data: payment } = await supabase
    .from('payments')
    .select('tier, description, amount_cents, lead_id')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();

  if (!payment) {
    return new Response(JSON.stringify({ found: false }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let fname = '';
  if (payment.lead_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('fname')
      .eq('id', payment.lead_id)
      .maybeSingle();
    fname = lead?.fname ?? '';
  }

  return new Response(
    JSON.stringify({
      found:        true,
      fname,
      tier:         payment.tier ?? null,
      description:  payment.description ?? null,
      amount_cents: payment.amount_cents ?? 0,
    }),
    { headers: { ...cors, 'Content-Type': 'application/json' } }
  );
});
