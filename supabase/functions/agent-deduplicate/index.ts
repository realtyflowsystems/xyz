// agent-deduplicate — RealtyFlow Systems
// Ingests an agent profile, finds or creates their team, returns deduplication info.
// Used before any outreach to check if agent/team is already locked.
//
// POST { name, email?, phone?, team_name?, zillow_url?, instagram? }
// Returns { agent_id, is_new, team_id, team_name, primary_contact_id, is_locked }
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
  if (req.method !== 'POST') return new Response('', { status: 405 });

  try {
    const body = await req.json();
    const { name, email, phone, team_name, zillow_url, instagram } = body;

    if (!name?.trim()) return err('name is required', 400);

    const cleanEmail = email?.trim().toLowerCase() || null;
    const cleanPhone = phone?.trim() || null;

    // ── Look up existing agent ─────────────────────────────────────────────────
    let agent: Agent | null = null;

    if (cleanEmail) {
      const { data } = await supabase.from('agents').select('*').eq('email', cleanEmail).maybeSingle();
      agent = data;
    }

    if (!agent && cleanPhone) {
      const { data } = await supabase.from('agents').select('*').eq('phone', cleanPhone).maybeSingle();
      agent = data;
    }

    // ── Resolve or create team ─────────────────────────────────────────────────
    let team: Team | null = null;

    if (agent?.team_id) {
      const { data } = await supabase.from('teams').select('*').eq('id', agent.team_id).maybeSingle();
      team = data;
    } else if (team_name?.trim()) {
      // Try to find existing team by name (case-insensitive)
      const { data: existing } = await supabase
        .from('teams')
        .select('*')
        .ilike('team_name', team_name.trim())
        .maybeSingle();

      if (existing) {
        team = existing;
      } else {
        const { data: created } = await supabase
          .from('teams')
          .insert({ team_name: team_name.trim() })
          .select()
          .single();
        team = created;
      }
    }

    // ── Create agent if not found ──────────────────────────────────────────────
    let isNew = false;
    if (!agent) {
      const { data, error } = await supabase
        .from('agents')
        .insert({
          name:       name.trim(),
          email:      cleanEmail,
          phone:      cleanPhone,
          team_id:    team?.id ?? null,
          zillow_url: zillow_url?.trim() || null,
          instagram:  instagram?.trim() || null,
        })
        .select()
        .single();

      if (error) return err('Failed to create agent: ' + error.message, 500);
      agent = data;
      isNew = true;

      // If this is the first agent on a new team, set as primary
      if (team && !team.primary_agent_id) {
        await supabase.from('teams').update({ primary_agent_id: agent!.id }).eq('id', team.id);
        team.primary_agent_id = agent!.id;
      }
    } else {
      // Update any new fields
      const updates: Record<string, unknown> = {};
      if (zillow_url && !agent.zillow_url)  updates.zillow_url = zillow_url.trim();
      if (instagram  && !agent.instagram)   updates.instagram  = instagram.trim();
      if (team?.id   && !agent.team_id)     updates.team_id    = team.id;
      if (Object.keys(updates).length) {
        await supabase.from('agents').update(updates).eq('id', agent.id);
        Object.assign(agent, updates);
      }
    }

    // ── Check lock status ──────────────────────────────────────────────────────
    const isLocked = agent.status === 'locked';

    // Check if any agent on the same team is locked (whole-team lock)
    let teamLocked = false;
    if (team?.id && !isLocked) {
      const { data: lockedCheck } = await supabase
        .from('outreach_log')
        .select('id')
        .eq('team_id', team.id)
        .eq('locked', true)
        .limit(1);
      teamLocked = (lockedCheck?.length ?? 0) > 0;
    }

    return ok({
      agent_id:          agent.id,
      agent_name:        agent.name,
      agent_status:      agent.status,
      is_new:            isNew,
      is_locked:         isLocked || teamLocked,
      team_id:           team?.id ?? null,
      team_name:         team?.team_name ?? null,
      primary_contact_id: team?.primary_agent_id ?? null,
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

interface Agent {
  id: string; name: string; email: string | null; phone: string | null;
  team_id: string | null; status: string;
  zillow_url: string | null; instagram: string | null;
}
interface Team {
  id: string; team_name: string; primary_agent_id: string | null;
}
