// lead-capture — RealtyFlow Systems
// POST { email, source? } — upserts into sequence_contacts and enrolls in outreach sequence.
// JWT off — called from exit-intent modal on public pages.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let email: string | undefined;
  let source: string | undefined;

  try {
    const body = await req.json();
    email = body.email;
    source = body.source;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Valid email is required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { error: upsertError } = await supabase
    .from('sequence_contacts')
    .upsert(
      {
        email: email.toLowerCase().trim(),
        source: source ?? 'website',
        status: 'active',
        next_email_at: new Date().toISOString(),
      },
      { onConflict: 'email', ignoreDuplicates: false }
    );

  if (upsertError) {
    console.error('Upsert error:', upsertError);
    return new Response(JSON.stringify({ error: upsertError.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
