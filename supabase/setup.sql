-- musical-octo-meme Supabase setup
-- Run this in Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  town text not null,
  state text not null,
  unique(name, town, state)
);

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text,
  school_id uuid references public.schools(id),
  grade integer check (grade between 1 and 12)
);

-- Existing projects: add username if missing
alter table public.users add column if not exists username text;

-- Unique display names (case-insensitive, ignores surrounding spaces)
create unique index if not exists users_username_lower_unique
  on public.users (lower(trim(username)))
  where username is not null and length(trim(username)) > 0;

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  meeting_times text not null,
  school_id uuid references public.schools(id) not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Force created_by from auth context so clients cannot spoof it and RLS stays reliable.
create or replace function public.set_club_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_set_club_creator on public.clubs;
create trigger trg_set_club_creator
before insert on public.clubs
for each row
execute function public.set_club_creator();

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  role text not null check (role in ('member', 'admin')),
  unique(user_id, club_id)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  date timestamptz not null,
  location text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  status text not null check (status in ('going', 'not going', 'maybe')),
  unique(user_id, event_id)
);

-- Tracks whether a user has viewed new events in a club.
create table if not exists public.club_event_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  unique(user_id, club_id)
);

alter table public.schools enable row level security;
alter table public.users enable row level security;
alter table public.clubs enable row level security;
alter table public.memberships enable row level security;
alter table public.events enable row level security;
alter table public.attendance enable row level security;
alter table public.club_event_reads enable row level security;

-- Helpers for admin/member checks.
create or replace function public.is_club_admin(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.club_id = p_club_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;

create or replace function public.is_club_member(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.club_id = p_club_id
      and m.user_id = auth.uid()
  );
$$;

grant execute on function public.is_club_admin(uuid) to authenticated, anon;
grant execute on function public.is_club_member(uuid) to authenticated, anon;

-- Schools: authenticated users can read schools.
drop policy if exists "read schools" on public.schools;
create policy "read schools" on public.schools
for select to authenticated
using (true);

-- Restrict school creation to authenticated users.
drop policy if exists "insert schools" on public.schools;
create policy "insert schools" on public.schools
for insert to authenticated
with check (true);

-- Users: a user can only access their own profile.
drop policy if exists "users self select" on public.users;
create policy "users self select" on public.users
for select to authenticated
using (id = auth.uid());

drop policy if exists "users self upsert" on public.users;
create policy "users self upsert" on public.users
for insert to authenticated
with check (id = auth.uid());

drop policy if exists "users self update" on public.users;
create policy "users self update" on public.users
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Let members/admins see basic profile of people in the same club (for roster UI).
drop policy if exists "users club peer read" on public.users;
create policy "users club peer read" on public.users
for select to authenticated
using (
  exists (
    select 1
    from public.memberships m_self
    join public.memberships m_peer on m_self.club_id = m_peer.club_id
    where m_self.user_id = auth.uid()
      and m_peer.user_id = users.id
  )
);

-- Clubs: members can read; admins can insert/update.
drop policy if exists "clubs member read" on public.clubs;
create policy "clubs member read" on public.clubs
for select to authenticated
using (public.is_club_member(id));

drop policy if exists "clubs admin insert" on public.clubs;
create policy "clubs admin insert" on public.clubs
for insert to authenticated
with check (auth.uid() is not null and created_by = auth.uid());

drop policy if exists "clubs admin update" on public.clubs;
create policy "clubs admin update" on public.clubs
for update to authenticated
using (public.is_club_admin(id))
with check (public.is_club_admin(id));

-- Memberships: users can read own memberships; admins can manage roles.
drop policy if exists "membership self read" on public.memberships;
create policy "membership self read" on public.memberships
for select to authenticated
using (user_id = auth.uid() or public.is_club_admin(club_id));

drop policy if exists "membership self insert" on public.memberships;
create policy "membership self insert" on public.memberships
for insert to authenticated
with check (
  user_id = auth.uid()
  or public.is_club_admin(club_id)
);

drop policy if exists "membership admin update" on public.memberships;
create policy "membership admin update" on public.memberships
for update to authenticated
using (public.is_club_admin(club_id))
with check (public.is_club_admin(club_id));

-- Events: members can read; only admins can write.
drop policy if exists "events member read" on public.events;
create policy "events member read" on public.events
for select to authenticated
using (public.is_club_member(club_id));

drop policy if exists "events admin insert" on public.events;
create policy "events admin insert" on public.events
for insert to authenticated
with check (public.is_club_admin(club_id));

drop policy if exists "events admin update" on public.events;
create policy "events admin update" on public.events
for update to authenticated
using (public.is_club_admin(club_id))
with check (public.is_club_admin(club_id));

drop policy if exists "events admin delete" on public.events;
create policy "events admin delete" on public.events
for delete to authenticated
using (public.is_club_admin(club_id));

-- Attendance: users can only control their own attendance.
drop policy if exists "attendance self read" on public.attendance;
create policy "attendance self read" on public.attendance
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "attendance self insert" on public.attendance;
create policy "attendance self insert" on public.attendance
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "attendance self update" on public.attendance;
create policy "attendance self update" on public.attendance
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Event read markers: self-only access.
drop policy if exists "event reads self read" on public.club_event_reads;
create policy "event reads self read" on public.club_event_reads
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "event reads self insert" on public.club_event_reads;
create policy "event reads self insert" on public.club_event_reads
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "event reads self update" on public.club_event_reads;
create policy "event reads self update" on public.club_event_reads
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Security hardening notes:
-- 1) Keep email confirmation enabled in Supabase Auth settings.
-- 2) Add bot protection / CAPTCHA for signup and sign-in endpoints.
-- 3) Restrict Google OAuth to approved domains if needed.
-- 4) Never use service_role in frontend code; only anon key in browser.
