-- RealtyFlow Systems — RLS Policies
-- Migration: 20260514000001_rls_policies
-- Fixes: tables had RLS enabled but zero policies (locked out everyone including anon booking form)

-- LEADS: allow anon to insert (public booking form on realtyflow.xyz/booking)
create policy "anon_insert_leads"
  on leads for insert to anon
  with check (true);

-- All other tables: service_role key (used in Edge Functions) bypasses RLS automatically.
-- No read policies for anon/authenticated needed yet — command center uses service_role via Edge Functions.
