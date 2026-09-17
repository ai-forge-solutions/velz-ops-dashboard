-- MIG-234: Minimal persisted brand groups for the Velz Ops Dashboard.
-- The dashboard reads groups through a view and writes only through narrow RPCs.

create table if not exists public.brand_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brand_groups
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.brand_groups
  alter column id set default gen_random_uuid(),
  alter column name set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'brand_groups_name_unique'
      and conrelid = 'public.brand_groups'::regclass
  ) then
    alter table public.brand_groups
      add constraint brand_groups_name_unique unique (name);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'brand_groups_name_not_blank'
      and conrelid = 'public.brand_groups'::regclass
  ) then
    alter table public.brand_groups
      add constraint brand_groups_name_not_blank check (length(trim(name)) > 0);
  end if;
end
$$;

create table if not exists public.brand_group_members (
  group_id uuid not null references public.brand_groups(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, brand_id)
);

alter table public.brand_group_members
  add column if not exists group_id uuid,
  add column if not exists brand_id uuid,
  add column if not exists created_at timestamptz not null default now();

alter table public.brand_group_members
  alter column group_id set not null,
  alter column brand_id set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'brand_group_members_group_id_fkey'
      and conrelid = 'public.brand_group_members'::regclass
  ) then
    alter table public.brand_group_members
      add constraint brand_group_members_group_id_fkey
      foreign key (group_id) references public.brand_groups(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'brand_group_members_brand_id_fkey'
      and conrelid = 'public.brand_group_members'::regclass
  ) then
    alter table public.brand_group_members
      add constraint brand_group_members_brand_id_fkey
      foreign key (brand_id) references public.brands(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'brand_group_members_pkey'
      and conrelid = 'public.brand_group_members'::regclass
  ) then
    alter table public.brand_group_members
      add constraint brand_group_members_pkey primary key (group_id, brand_id);
  end if;
end
$$;

create index if not exists brand_group_members_brand_id_idx
  on public.brand_group_members (brand_id);

create or replace view public.v_brand_groups as
select
  g.id,
  g.name,
  g.description,
  g.created_at,
  g.updated_at,
  count(m.brand_id)::int as brand_count,
  coalesce(
    array_agg(m.brand_id order by b.name) filter (where m.brand_id is not null),
    '{}'::uuid[]
  ) as brand_ids
from public.brand_groups g
left join public.brand_group_members m on m.group_id = g.id
left join public.brands b on b.id = m.brand_id
group by g.id, g.name, g.description, g.created_at, g.updated_at;

create or replace function public.save_brand_group(
  p_group_id uuid,
  p_name text,
  p_description text,
  p_brand_ids uuid[]
)
returns public.v_brand_groups
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_result public.v_brand_groups;
begin
  if length(v_name) = 0 then
    raise exception 'brand group name cannot be blank' using errcode = '22023';
  end if;

  if p_group_id is null then
    insert into public.brand_groups (name, description)
    values (v_name, nullif(p_description, ''))
    returning id into v_group_id;
  else
    update public.brand_groups
    set
      name = v_name,
      description = nullif(p_description, ''),
      updated_at = now()
    where id = p_group_id
    returning id into v_group_id;

    if v_group_id is null then
      raise exception 'brand group % not found', p_group_id using errcode = 'P0002';
    end if;
  end if;

  delete from public.brand_group_members
  where group_id = v_group_id;

  insert into public.brand_group_members (group_id, brand_id)
  select distinct v_group_id, b.id
  from unnest(coalesce(p_brand_ids, '{}'::uuid[])) as requested(brand_id)
  join public.brands b on b.id = requested.brand_id
  where requested.brand_id is not null;

  select *
  into v_result
  from public.v_brand_groups
  where id = v_group_id;

  return v_result;
end;
$$;

create or replace function public.delete_brand_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.brand_groups
  where id = p_group_id;
end;
$$;

revoke all on public.brand_groups from anon, authenticated;
revoke all on public.brand_group_members from anon, authenticated;
revoke all on public.v_brand_groups from anon, authenticated;

grant select on public.v_brand_groups to anon, authenticated;
grant execute on function public.save_brand_group(uuid, text, text, uuid[]) to anon, authenticated;
grant execute on function public.delete_brand_group(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
