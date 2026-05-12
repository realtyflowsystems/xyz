/**
 * rfs-backend.js — RealtyFlow Systems Supabase client
 *
 * Loaded by booking.html and command-center.html.
 * Exposes a thin RFS object over the Supabase JS SDK.
 *
 * Usage (add before your page script):
 *   <script src="/js/rfs-backend.js"></script>
 *
 * The SUPABASE_URL and SUPABASE_ANON_KEY below are PUBLIC (safe to commit).
 * They only allow the operations your RLS policies permit.
 * Never put service_role key here.
 *
 * --- REPLACE THESE VALUES AFTER CREATING YOUR SUPABASE PROJECT ---
 */

const RFS_CONFIG = {
  // Supabase project URL: https://supabase.com/dashboard → Settings → API
  SUPABASE_URL: https://wufmcymarbkrjzaqapuu.supabase.co,

  // Supabase anon key (safe to be public — RLS protects everything)
  SUPABASE_ANON_KEY: sb_publishable_u0H1VuhN27xEDwLYUL4DIA_www1NJaS,

  // Your deployed Edge Function base URL
  // Same as SUPABASE_URL + /functions/v1
  FUNCTIONS_URL: https://supabase.com/dashboard/project/wufmcymarbkrjzaqapuu/functions,
};

// ── Supabase JS client (loaded via CDN in each HTML page) ────
// Each page that uses this file should also include:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>

function initSupabase() {
  if (typeof window !== 'undefined' && window.supabase && !window._rfsClient) {
    window._rfsClient = window.supabase.createClient(
      RFS_CONFIG.SUPABASE_URL,
      RFS_CONFIG.SUPABASE_ANON_KEY
    );
  }
  return window._rfsClient;
}

// ── Public API ───────────────────────────────────────────────
const RFS = {

  /** Submit a booking form — calls the booking-create Edge Function. */
  async submitBooking({ name, email, phone, source }) {
    const res = await fetch(`${RFS_CONFIG.FUNCTIONS_URL}/booking-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        phone,
        source: source || 'Booking Page',
        timestamp: new Date().toISOString(),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Booking failed');
    }
    return data;
  },

  /** Fetch all leads — used by command-center.html. */
  async getLeads() {
    const db = initSupabase();
    if (!db) return [];
    const { data, error } = await db
      .from('pipeline_view')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error('getLeads:', error); return []; }
    return data || [];
  },

  /** Upsert a lead (create or update by id). */
  async saveLead(lead) {
    const db = initSupabase();
    if (!db) return null;
    const { data, error } = await db
      .from('leads')
      .upsert(lead, { onConflict: 'id' })
      .select()
      .single();
    if (error) { console.error('saveLead:', error); return null; }
    return data;
  },

  /** Update a lead's pipeline stage. */
  async advanceStage(leadId, stage, stageName) {
    const db = initSupabase();
    if (!db) return;
    const { error } = await db
      .from('leads')
      .update({ stage, stage_name: stageName })
      .eq('id', leadId);
    if (error) console.error('advanceStage:', error);
  },

  /** Log a note or activity for a lead. */
  async logActivity(leadId, type, description, metadata = {}) {
    const db = initSupabase();
    if (!db) return;
    await db.from('activity_log').insert({ lead_id: leadId, type, description, metadata });
  },

  /** Save daily activity tracker data. */
  async saveDailyActivity(date, fields) {
    const db = initSupabase();
    if (!db) return;
    await db
      .from('daily_activity')
      .upsert({ date, ...fields }, { onConflict: 'date' });
  },

  /** Get daily activity for a date range. */
  async getDailyActivity(fromDate, toDate) {
    const db = initSupabase();
    if (!db) return [];
    const { data, error } = await db
      .from('daily_activity')
      .select('*')
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('date');
    if (error) { console.error('getDailyActivity:', error); return []; }
    return data || [];
  },

  /** Real-time: subscribe to new leads (e.g. booking form submission). */
  subscribeToLeads(callback) {
    const db = initSupabase();
    if (!db) return null;
    return db
      .channel('leads-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, callback)
      .subscribe();
  },

  /** Fetch pipeline stats for dashboard header. */
  async getPipelineStats() {
    const db = initSupabase();
    if (!db) return { total: 0, booked: 0, closed: 0, revenue: 0 };
    const { data: leads } = await db.from('leads').select('stage, tier');
    const { data: payments } = await db.from('payments').select('amount_cents').eq('status', 'succeeded');

    const tierValues = { 'Core': 2497, 'Revenue Acceleration': 4000, 'Team Infrastructure': 7500 };
    const total    = leads?.length || 0;
    const booked   = leads?.filter(l => l.stage >= 2).length || 0;
    const closed   = leads?.filter(l => l.stage === 5).length || 0;
    const revenue  = (payments || []).reduce((s, p) => s + Math.round(p.amount_cents / 100), 0);

    return { total, booked, closed, revenue };
  },

  /** Convert command-center localStorage lead format → Supabase format. */
  toSupabaseLead(localLead) {
    return {
      id:         localLead.id,           // UUID — keep in sync
      fname:      localLead.fname,
      lname:      localLead.lname,
      email:      localLead.email || null,
      phone:      localLead.phone || null,
      source:     localLead.source || null,
      stage:      localLead.stage || 0,
      stage_name: this.STAGES[localLead.stage] || 'New Lead',
      tier:       localLead.tier || null,
      volume:     localLead.volume || null,
      sides:      localLead.sides || null,
      market:     localLead.market || null,
      notes:      localLead.notes || null,
    };
  },

  /** Merge Supabase leads into localStorage format for command-center. */
  fromSupabaseLead(sLead) {
    const parts = [sLead.fname, sLead.lname].filter(Boolean);
    return {
      id:      sLead.id,
      fname:   sLead.fname,
      lname:   sLead.lname,
      email:   sLead.email,
      phone:   sLead.phone,
      source:  sLead.source || 'Booking Page',
      stage:   sLead.stage || 0,
      tier:    sLead.tier || null,
      volume:  sLead.volume || null,
      sides:   sLead.sides || null,
      market:  sLead.market || null,
      notes:   sLead.notes || null,
      created: sLead.created_at ? new Date(sLead.created_at).getTime() : Date.now(),
    };
  },

  STAGES: [
    'New Lead',
    'Contacted',
    'Audit Booked',
    'Audit Complete',
    'Proposal Sent',
    'Closed — Won',
    'Closed — Lost',
  ],
};

// ── Auto-init when DOM is ready ──────────────────────────────
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (
      RFS_CONFIG.SUPABASE_URL !== 'https://YOUR_PROJECT_REF.supabase.co' &&
      typeof window.supabase !== 'undefined'
    ) {
      initSupabase();
      console.log('[RFS] Supabase client initialized');
    } else if (RFS_CONFIG.SUPABASE_URL === 'https://YOUR_PROJECT_REF.supabase.co') {
      console.warn('[RFS] Supabase not configured — running in localStorage-only mode. See SETUP.md.');
    }
  });
}
