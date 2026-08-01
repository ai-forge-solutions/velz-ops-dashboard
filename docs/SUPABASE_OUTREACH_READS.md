# Supabase Outreach dashboard reads

The Ops Dashboard reads Outreach state with the public Supabase anon key. Keep this read-only. Do not expose service-role keys or direct Saleshandy credentials to the browser.

The UI now reads these source-backed objects:

- `v_lead_overview` filtered by `brand_id`
- `email_sequences` filtered by `lead_id`
- `email_sends` filtered by `lead_id`
- `email_events` filtered by `lead_id`
- `lead_magnet_events` filtered by `lead_id`
- `email_suppression_entries` filtered by recipient `email`

If the Netlify preview shows `Read blocked` for Outreach while the Signals matrix loads, apply the minimum read-only grants/RLS policy for the dashboard role or expose an equivalent read-only view/RPC.

Example SQL policy shape, to adapt to the current Supabase schema/RLS setup:

```sql
-- Existing public view used by both backend QA notes and dashboard.
grant select on public.v_lead_overview to anon;

grant select on public.email_sequences to anon;
grant select on public.email_sends to anon;
grant select on public.email_events to anon;
grant select on public.lead_magnet_events to anon;
grant select on public.email_suppression_entries to anon;

alter table public.email_sequences enable row level security;
alter table public.email_sends enable row level security;
alter table public.email_events enable row level security;
alter table public.lead_magnet_events enable row level security;
alter table public.email_suppression_entries enable row level security;

create policy "dashboard anon can read outreach sequences"
  on public.email_sequences for select to anon using (true);
create policy "dashboard anon can read outreach sends"
  on public.email_sends for select to anon using (true);
create policy "dashboard anon can read outreach events"
  on public.email_events for select to anon using (true);
create policy "dashboard anon can read lead magnet events"
  on public.lead_magnet_events for select to anon using (true);
create policy "dashboard anon can read suppression state"
  on public.email_suppression_entries for select to anon using (true);
```

Security note: if the project needs narrower browser exposure, replace direct table grants with a security-barrier dashboard view that returns only operational status, provider IDs, timestamps, event counts, and active suppression state.
