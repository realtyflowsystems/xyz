-- Fix: pipeline_view was SECURITY DEFINER (ran as view creator, bypassing RLS).
-- Recreate with security_invoker=on so queries run as the calling user
-- and all RLS policies on leads, bookings, payments, clients are enforced.
CREATE OR REPLACE VIEW public.pipeline_view
WITH (security_invoker = on)
AS
SELECT
  l.id,
  l.fname,
  l.lname,
  l.email,
  l.phone,
  l.source,
  l.stage,
  l.stage_name,
  l.tier,
  l.volume,
  l.sides,
  l.notes,
  l.created_at,
  b.slot_time,
  b.status AS booking_status,
  p.amount_cents,
  p.status AS payment_status,
  c.portal_token,
  c.onboarding_stage AS client_stage
FROM leads l
LEFT JOIN bookings b ON b.lead_id = l.id AND b.status <> 'cancelled'
LEFT JOIN payments p ON p.lead_id = l.id AND p.status = 'succeeded'
LEFT JOIN clients c ON c.lead_id = l.id;
