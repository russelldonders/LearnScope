-- Notifications are assembled from several domain tables plus calculated
-- reminders. Store only the learner's decision to hide a stable notification
-- key; the source records remain unchanged and keep their own workflows.
create table public.notification_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id text not null check (char_length(notification_id) between 1 and 240),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, notification_id)
);

alter table public.notification_dismissals enable row level security;

revoke all on table public.notification_dismissals from anon, authenticated;
grant select, insert, delete on table public.notification_dismissals to authenticated;

create policy "Users can read their notification dismissals"
  on public.notification_dismissals for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can dismiss their notifications"
  on public.notification_dismissals for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can restore their notifications"
  on public.notification_dismissals for delete
  to authenticated
  using ((select auth.uid()) = user_id);
