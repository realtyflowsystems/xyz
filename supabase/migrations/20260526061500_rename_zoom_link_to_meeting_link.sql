-- Rename bookings.zoom_link → bookings.meeting_link
-- Reason: Cal.com event-type swapped from Zoom to Google Meet on 2026-05-26.
-- Column renamed to a platform-agnostic name so future video-platform swaps
-- don't require another schema migration.
-- Idempotent: guarded by an IF EXISTS check so re-applying is a no-op.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'zoom_link'
  ) then
    alter table public.bookings rename column zoom_link to meeting_link;
  end if;
end
$$;
