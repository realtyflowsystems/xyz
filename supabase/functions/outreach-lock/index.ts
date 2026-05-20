// outreach-lock — RealtyFlow Systems
// Logs an outreach attempt and optionally locks agent + entire team.
// Zapier-compatible: accepts both native and { data: { ... } } envelope.
//
// POST { agent_id, team_id?, contact_method, notes?, locked? }
// Returns { success, log_id, agents_locked }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_METHODS = ['sms', 'email', 'dm', 'call', 'other'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('', { status: 405 });

  try {
    const raw  = await req.json();
    // Unwrap Zapier envelope if present
    const body = raw?.data ?? raw;

    const { agent_id, team_id, contact_method, notes, locked = false } = body;

    if (!contact_method || !VALID_METHODS.includes(contact_method)) {
      return err(`contact_method must be one of: ${VALID_METHODS.join(', ')}`, 400);
    }
    if (!agent_id && !team_id) {
      return err('agent_id or team_id is required', 400);
    }

    const now = new Date().toISOString();

    // ── Insert outreach log entry ──────────────────────────────────────────────
    const { data: log, error: logErr } = await supabase
      .from('outreach_log')
      .insert({
        agent_id:       agent_id || null,
        team_id:        team_id  || null,
        contact_method,
        contacted_at:   now,
        status:         'sent',
        locked:         !!locked,
        notes:          notes?.trim() || null,
      })
      .select()
      .single();

    if (logErr) return err('Failed to log outreach: ' + logErr.message, 500);

    let agentsLocked = 0;

    if (locked) {
      // Lock the specific agent
      if (agent_id) {
        await supabase.from('agents').update({ status: 'locked' }).eq('id', agent_id);
        agentsLocked++;
      }

      // Lock every agent on the team
      if (team_id) {
        const { data: teamAgents } = await supabase
          .from('agents')
          .select('id')
          .eq('team_id', team_id)
          .neq('status', 'locked');

        if (teamAgents?.length) {
          await supabase
            .from('agents')
            .update({ status: 'locked' })
            .eq('team_id', team_id);
          agentsLocked += teamAgents.length;
        }
      }
    } else if (agent_id) {
      // Advance status to 'sent' if still pending
      await supabase
        .from('agents')
        .update({ status: 'sent' })
        .eq('id', agent_id)
        .eq('status', 'pending');
    }

    return ok({ success: true, log_id: log.id, agents_locked: agentsLocked, locked });

  } catch (e) {
    console.error(e);
    return err('Internal error', 500);
  }
});

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
