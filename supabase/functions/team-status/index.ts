// team-status — RealtyFlow Systems
// Returns full team profile: team info, all agents, and recent outreach log.
// JWT required (command-center only).
//
// GET ?team_id=UUID
// GET ?agent_email=EMAIL  (looks up agent's team)
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

  const url         = new URL(req.url);
  let teamId        = url.searchParams.get('team_id');
  const agentEmail  = url.searchParams.get('agent_email');

  try {
    // Resolve team_id from agent email if provided
    if (!teamId && agentEmail) {
      const { data: agent } = await supabase
        .from('agents')
        .select('team_id, status, id, name')
        .eq('email', agentEmail.toLowerCase())
        .maybeSingle();

      if (!agent) {
        return ok({ team: null, agents: [], outreach_log: [], is_locked: false, agent_only: null });
      }

      if (!agent.team_id) {
        // Solo agent — return just that agent's info
        const { data: log } = await supabase
          .from('outreach_log')
          .select('*')
          .eq('agent_id', agent.id)
          .order('contacted_at', { ascending: false })
          .limit(10);

        return ok({
          team: null,
          agents: [agent],
          outreach_log: log ?? [],
          is_locked: agent.status === 'locked',
        });
      }

      teamId = agent.team_id;
    }

    if (!teamId) return err('team_id or agent_email is required', 400);

    // ── Fetch team + agents + outreach log in parallel ─────────────────────────
    const [
      { data: team },
      { data: agents },
      { data: outreachLog },
    ] = await Promise.all([
      supabase.from('teams').select('*').eq('id', teamId).single(),
      supabase.from('agents').select('*').eq('team_id', teamId).order('created_at', { ascending: true }),
      supabase.from('outreach_log').select('*').eq('team_id', teamId)
        .order('contacted_at', { ascending: false }).limit(20),
    ]);

    if (!team) return err('Team not found', 404);

    const isLocked = (agents ?? []).length > 0 &&
      (agents ?? []).every((a: { status: string }) => a.status === 'locked');

    const hasLockLog = (outreachLog ?? []).some((o: { locked: boolean }) => o.locked);

    return ok({
      team,
      agents:       agents ?? [],
      outreach_log: outreachLog ?? [],
      is_locked:    isLocked || hasLockLog,
      agent_count:  agents?.length ?? 0,
    });

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
