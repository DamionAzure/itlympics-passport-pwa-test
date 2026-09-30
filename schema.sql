-- =====================================================================
-- ITLympics Passport — database setup (FINAL, one file, safe to re-run)
-- Paste all of this into Supabase > SQL Editor > New query > Run.
--
-- Before running, in Supabase > Authentication > Providers > Email:
--   * turn OFF "Confirm email"   (login uses synthetic addresses, no mail)
--   * keep minimum password length at 6 or lower (PINs are 6+ digits)
--
-- The synthetic-address domain below MUST match AUTH_DOMAIN in shared.js.
--
-- After running: create your own account on the Login page, then run the
-- one-line bootstrap at the very bottom to make yourself the first admin.
-- =====================================================================

create extension if not exists pgcrypto;   -- hmac() for booth codes

-- ---------------------------------------------------------------------
-- 1. TABLES (create-if-missing, so this also works on your existing DB)
-- ---------------------------------------------------------------------
create table if not exists students (            -- legacy pre-login registrations
  student_id text primary key,
  name text
);
create table if not exists stamps (
  student_id text not null,
  booth_id text not null,
  received_at timestamptz not null default now(),
  verified boolean not null default true,        -- false = scanned offline, awaiting spot-check
  primary key (student_id, booth_id)
);
alter table stamps add column if not exists verified boolean not null default true;

create table if not exists flagged_scans (
  id bigint generated always as identity primary key,
  student_id text, booth_id text, booth_name text, reason text, raw text,
  received_at timestamptz not null default now()
);
create table if not exists checkins (
  student_id text primary key,
  checked_in_at timestamptz not null default now()
);
create table if not exists votes (
  student_id text not null,
  category_id text not null,
  candidate_id text,
  voted_at timestamptz not null default now(),
  primary key (student_id, category_id)
);
create table if not exists skills_registrations (
  student_id text primary key,
  name text,
  section text,
  registered_at timestamptz not null default now()
);
create table if not exists sections (name text primary key);
create table if not exists booth_secrets (
  booth_id text primary key,
  secret text not null
);
create table if not exists event_settings (
  key text primary key,
  value text
);
create table if not exists profiles (            -- one row per login, made by the signup trigger
  user_id uuid primary key references auth.users(id) on delete cascade,
  student_id text unique not null,
  name text,
  role text not null default 'user' check (role in ('user','staff','admin'))
);
alter table profiles drop constraint if exists profiles_student_id_format;
alter table profiles add constraint profiles_student_id_format
  check (student_id ~ '^\d{2}-\d{3,5}$') not valid;   -- not valid: don't fail on any old row, enforce on new ones

-- Voting categories + their candidates. Admin-managed from Testing > Manage
-- vote categories (these used to be hardcoded in shared.js). `active = false`
-- closes a category: it disappears from the Vote page and new votes for it
-- are refused, but its results stay on the Dashboard.
create table if not exists vote_categories (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  title text not null check (length(btrim(title)) between 1 and 120),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists vote_candidates (
  category_id text not null references vote_categories(id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (category_id, id)
);

-- The official student list, bulk-loaded from a CSV on the Dashboard (admin).
-- Separate from `profiles` on purpose: a roster row means "expected to
-- attend", a profile means "actually made a login". Comparing the two is
-- what the Dashboard's Roster coverage card shows.
create table if not exists roster (
  student_id text primary key check (student_id ~ '^\d{2}-\d{3,5}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  section text,
  imported_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. SEED DATA
-- ---------------------------------------------------------------------
insert into sections (name) values
  ('BSIT 1-1'),('BSIT 1-2'),('BSIT 1-3'),('BSIT 2-1'),('BSIT 2-2'),('BSIT 2-3'),('BSIT 3-1'),('BSIT 3-2'),('BSIT 4-1'),('BSIT 4-2'),
  ('BSCS 1-1'),('BSCS 1-2'),('BSCS 2-1'),('BSCS 2-2'),('BSCS 3-1'),('BSCS 3-2'),('BSCS 4-1'),
  ('BSIS 1-1'),('BSIS 1-2'),('BSIS 2-1'),('BSIS 2-2'),('BSIS 3-1'),('BSIS 4-1'),
  ('BSBA 1-1'),('BSBA 1-2'),('BSBA 2-1'),('BSBA 2-2'),('BSBA 3-1'),('BSBA 4-1'),
  ('BSA 1-1'),('BSA 2-1'),('BSA 3-1'),('BSA 4-1'),
  ('BEED 1-1'),('BEED 2-1'),('BEED 3-1'),('BEED 4-1'),
  ('BSED 1-1'),('BSED 2-1'),('BSED 3-1'),('BSED 4-1')
on conflict (name) do nothing;

-- The voting list that used to be hardcoded in shared.js — same ids, so any
-- votes already cast still line up. `do nothing` means edits made in the app
-- survive a re-run of this file.
insert into vote_categories (id, title, sort_order) values
  ('pc-hybrid',   'People''s Choice Award — Hybrid Game',  1),
  ('pc-digital',  'People''s Choice Award — Digital Game', 2),
  ('best-banner', 'Special GAMECON Award — Best Banner',   3),
  ('best-booth',  'Special GAMECON Award — Best Booth',    4)
on conflict (id) do nothing;
insert into vote_candidates (category_id, id, name, sort_order) values
  ('pc-hybrid','h1','Entry 1',1),    ('pc-hybrid','h2','Entry 2',2),    ('pc-hybrid','h3','Entry 3',3),    ('pc-hybrid','h4','Entry 4',4),
  ('pc-digital','d1','Entry 1',1),   ('pc-digital','d2','Entry 2',2),   ('pc-digital','d3','Entry 3',3),   ('pc-digital','d4','Entry 4',4),
  ('best-banner','bn1','Entry 1',1), ('best-banner','bn2','Entry 2',2), ('best-banner','bn3','Entry 3',3), ('best-banner','bn4','Entry 4',4),
  ('best-booth','b1','Coding Challenge',1), ('best-booth','b2','Valorant',2), ('best-booth','b3','Mobile Legends',3),
  ('best-booth','b4','Trivia Night',4),     ('best-booth','b5','Chess',5),    ('best-booth','b6','Cosplay',6)
on conflict (category_id, id) do nothing;

insert into event_settings (key, value) values
  ('geofence_enabled', 'false'),
  ('geofence_lat', '14.6940301'),
  ('geofence_lng', '120.969399'),
  ('geofence_radius_m', '250')
on conflict (key) do nothing;

-- Booth secrets are generated HERE, inside the database, and are never written
-- in any file or web page. (An earlier version of these instructions printed
-- them in cleartext inside testing.html, which is served publicly — so any
-- secret that is still one of those old values is rotated automatically below.)
insert into booth_secrets (booth_id, secret)
select b, replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')
from unnest(array['b1','b2','b3','b4','b5','b6']) as b
on conflict (booth_id) do nothing;

update booth_secrets
set secret = replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')
where secret in (
  'XZdw5ojh4AL8twlS8xBJy9h9E9Oih5BX','t-_o6Yp6zYTagkzQQSElD6LdZKbThBkq',
  'a27T_X4SX62k8dxEhoPVsmaM5XbJgU37','yH0v8FRc3HybP1zBG0gQ0MmDbPu-XkQX',
  '33ZgokDpmHDvYXCrPPn-j2ceaFtOUNUS','yKvg0AgJ-23oRBnLUJ5pti2h-BvhT_9s'
);

-- The old shared "staff PIN" table. Replaced by real per-person roles, and its
-- value was also visible in the page source, so it goes.
drop table if exists app_config;

-- ---------------------------------------------------------------------
-- 3. WHO AM I? helpers (used by every policy and function below)
--    They always return a real true/false — never NULL. That matters:
--    `if my_role() not in (...)` is NULL (= skipped!) for a logged-out caller.
-- ---------------------------------------------------------------------
create or replace function my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where user_id = auth.uid();
$$;
create or replace function my_student_id()
returns text language sql stable security definer set search_path = public as $$
  select student_id from profiles where user_id = auth.uid();
$$;
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('staff','admin') from profiles where user_id = auth.uid()), false);
$$;
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where user_id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------
-- 4. ACCOUNTS: signup trigger, role changes, "does this ID exist?"
-- ---------------------------------------------------------------------
-- Runs the instant someone signs up. The Student ID is taken from the
-- signup EMAIL (which is what actually makes the login unique), never from
-- client-supplied metadata — so nobody can sign up as one ID while holding
-- another's address. Any signup that isn't a Student-ID address is refused,
-- which also blocks anyone using the public key to mass-create junk accounts.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(new.email, ''));
  v_sid text;
  v_name text;
begin
  if v_email !~ '^[0-9]{2}-[0-9]{3,5}@itlympics\.local$' then      -- keep in sync with AUTH_DOMAIN
    raise exception 'Accounts are created from the Login page only.';
  end if;
  v_sid := split_part(v_email, '@', 1);
  v_name := nullif(left(btrim(coalesce(new.raw_user_meta_data->>'name', '')), 80), '');
  insert into profiles (user_id, student_id, name) values (new.id, v_sid, v_name);   -- role is always 'user'
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Login page, step 1 (callable while logged out). Returns only true/false —
-- no name, no role — so the PIN field can be offered ("enter PIN" vs "create one").
create or replace function account_exists(p_student_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where student_id = p_student_id);
$$;

-- Login page, step 2, new-account branch (callable while logged out) — looks
-- up a name from the roster to prefill the signup form with, so it comes
-- from the org's real list instead of being typed from scratch. Still
-- editable client-side: this is a convenience, not a gate, so a null (not on
-- the roster, or roster not imported yet) just means an empty field, not a
-- refusal. `roster` itself stays staff-read-only; this is the one narrow
-- door into it for everyone else, one student_id at a time.
-- Only answers for IDs that don't have a login yet (the only case the
-- signup form needs), so it can't be used to look up names of people who
-- are already registered.
create or replace function roster_lookup(p_student_id text)
returns text language sql stable security definer set search_path = public as $$
  select r.name from roster r
  where r.student_id = p_student_id
    and not exists (select 1 from profiles p where p.student_id = r.student_id);
$$;

-- Admin-only. Refuses to demote the last remaining admin (lock-out protection).
create or replace function set_user_role(p_student_id text, p_role text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return false; end if;
  if p_role not in ('user','staff','admin') then return false; end if;
  if p_role <> 'admin'
     and exists (select 1 from profiles where student_id = p_student_id and role = 'admin')
     and (select count(*) from profiles where role = 'admin') <= 1 then
    return false;
  end if;
  update profiles set role = p_role where student_id = p_student_id;
  return found;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. BOOTH CODES
-- ---------------------------------------------------------------------
drop function if exists get_booth_seed(text, text);          -- old shared-PIN versions
drop function if exists set_event_setting(text, text, text);
drop function if exists validate_booth_code(text, int);

-- Staff/admin only (a Booth Display device) — mints the current rotating code.
create or replace function generate_booth_code(p_booth_id text, p_rotation_seconds int default 30)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_secret text;
  v_window_id bigint;
begin
  if not is_staff() then return null; end if;
  select secret into v_secret from booth_secrets where booth_id = p_booth_id;
  if v_secret is null then return null; end if;
  v_window_id := floor(extract(epoch from now()) / p_rotation_seconds);
  return 'BOOTH:' || p_booth_id || ':' || v_window_id || ':' ||
    substring(encode(hmac((p_booth_id || ':' || v_window_id::text)::bytea, v_secret::bytea, 'sha256'), 'hex') from 1 for 10);
end;
$$;

-- Staff/admin only — lets a Booth Display cache its own seed for offline codes.
create or replace function get_booth_seed(p_booth_id text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text;
begin
  if not is_staff() then return null; end if;
  select secret into v_secret from booth_secrets where booth_id = p_booth_id;
  return v_secret;
end;
$$;

-- Any logged-in account can scan. Checks the code, its time window (+5s grace,
-- flagged "not sure"), and — if the geofence is on — the phone's location.
create or replace function validate_booth_code(p_code text, p_rotation_seconds int default 30, p_lat double precision default null, p_lng double precision default null)
returns table(ok boolean, booth_id text, not_sure boolean, reason text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_parts text[];
  v_booth_id text; v_window_id bigint; v_code text; v_secret text;
  v_now numeric; v_my_window bigint; v_secs_into numeric;
  v_expected text; v_not_sure boolean := false;
  v_grace_seconds constant int := 5;
  v_geofence_on text; v_geo_lat double precision; v_geo_lng double precision; v_geo_radius double precision;
  v_distance_m double precision;
begin
  if auth.uid() is null then
    return query select false, null::text, false, 'Login required'; return;
  end if;
  if p_code is null or left(p_code, 6) <> 'BOOTH:' then
    return query select false, null::text, false, 'Not a booth code'; return;
  end if;
  v_parts := string_to_array(p_code, ':');
  if array_length(v_parts, 1) <> 4 then
    return query select false, null::text, false, 'Malformed code'; return;
  end if;
  v_booth_id := v_parts[2];
  v_window_id := nullif(v_parts[3], '')::bigint;
  v_code := v_parts[4];
  if v_window_id is null then
    return query select false, null::text, false, 'Malformed code'; return;
  end if;

  select value into v_geofence_on from event_settings where key = 'geofence_enabled';
  if v_geofence_on = 'true' then
    select value::double precision into v_geo_lat from event_settings where key = 'geofence_lat';
    select value::double precision into v_geo_lng from event_settings where key = 'geofence_lng';
    select value::double precision into v_geo_radius from event_settings where key = 'geofence_radius_m';
    if p_lat is null or p_lng is null then
      return query select false, v_booth_id, false, 'Location required'; return;
    end if;
    v_distance_m := 2 * 6371000 * asin(sqrt(
      sin(radians(p_lat - v_geo_lat) / 2)^2 +
      cos(radians(v_geo_lat)) * cos(radians(p_lat)) * sin(radians(p_lng - v_geo_lng) / 2)^2
    ));
    if v_distance_m > v_geo_radius then
      return query select false, v_booth_id, false, 'Outside campus geofence'; return;
    end if;
  end if;

  select secret into v_secret from booth_secrets where booth_secrets.booth_id = v_booth_id;
  if v_secret is null then
    return query select false, null::text, false, 'Unknown booth'; return;
  end if;
  v_now := extract(epoch from now());
  v_my_window := floor(v_now / p_rotation_seconds);
  v_secs_into := v_now - v_my_window * p_rotation_seconds;
  if v_window_id = v_my_window then
    v_not_sure := false;
  elsif v_window_id = v_my_window - 1 and v_secs_into < v_grace_seconds then
    v_not_sure := true;
  else
    return query select false, v_booth_id, false, 'Expired code (outside sync window)'; return;
  end if;
  v_expected := substring(encode(hmac((v_booth_id || ':' || v_window_id::text)::bytea, v_secret::bytea, 'sha256'), 'hex') from 1 for 10);
  if v_expected <> v_code then
    return query select false, v_booth_id, false, 'Invalid code (signature mismatch)'; return;
  end if;
  return query select true, v_booth_id, v_not_sure, null::text;
end;
$$;

-- Stamps are attendance, so a plain client upsert with a self-reported
-- `verified` flag was a real hole: open devtools, call
-- supabase.from('stamps').upsert({student_id:'me', booth_id:'b1', verified:true})
-- with ANY booth_id, and it wrote — no code, no location, nothing checked.
-- This is now the ONLY path: it re-runs validate_booth_code (signature, time
-- window, geofence) itself and writes for auth.uid()'s OWN student_id only —
-- there's no student_id parameter to forge. Idempotent: scanning a booth you
-- already have just reports back `already`, it doesn't error.
create or replace function claim_stamp(p_raw_code text, p_rotation_seconds int default 30, p_lat double precision default null, p_lng double precision default null)
returns table(ok boolean, booth_id text, not_sure boolean, reason text, already boolean)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
-- ^ RETURNS TABLE makes `booth_id` an output variable, which would otherwise
-- shadow stamps.booth_id inside "on conflict (student_id, booth_id)" below
-- and make it ambiguous — this tells plpgsql to prefer the table column
-- there, which is what ON CONFLICT's target list needs.
declare v_sid text; r record;
begin
  v_sid := my_student_id();
  if v_sid is null then
    return query select false, null::text, false, 'Not logged in', false; return;
  end if;
  select * into r from validate_booth_code(p_raw_code, p_rotation_seconds, p_lat, p_lng);
  if not r.ok then
    return query select false, r.booth_id, false, r.reason, false; return;
  end if;
  insert into stamps (student_id, booth_id, verified) values (v_sid, r.booth_id, not r.not_sure)
  on conflict (student_id, booth_id) do nothing;
  return query select true, r.booth_id, r.not_sure, null::text, not found;   -- FOUND is set by the INSERT above
end;
$$;

-- Offline fallback: an attendee's phone never holds a booth secret (only a
-- Booth Display device caches one), so there is no signature to check here
-- at all — by the time connectivity returns, the code's time window is long
-- gone, which is the whole point of rotating it. This just confirms the
-- booth ID is real and records an UNVERIFIED claim for auth.uid()'s own
-- student_id (again, no student_id parameter to forge) — the same
-- "needs a staff spot-check" stamp the app already surfaces on the Dashboard
-- and marks with an "Offline" ribbon on the Passport page.
create or replace function claim_stamp_offline(p_booth_id text)
returns table(ok boolean, booth_id text, already boolean, reason text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column   -- see claim_stamp above
declare v_sid text;
begin
  v_sid := my_student_id();
  if v_sid is null then return query select false, null::text, false, 'Not logged in'; return; end if;
  if not exists (select 1 from booth_secrets where booth_secrets.booth_id = p_booth_id) then
    return query select false, p_booth_id, false, 'Unknown booth'; return;
  end if;
  insert into stamps (student_id, booth_id, verified) values (v_sid, p_booth_id, false)
  on conflict (student_id, booth_id) do nothing;
  return query select true, p_booth_id, not found, null::text;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. EVENT SETTINGS (geofence) — admin-only writes, validated
-- ---------------------------------------------------------------------
create or replace function set_event_setting(p_key text, p_value text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return false; end if;
  if p_key = 'geofence_enabled' then
    if p_value not in ('true','false') then return false; end if;
  elsif p_key in ('geofence_lat','geofence_lng','geofence_radius_m') then
    -- a value that isn't a number would break validate_booth_code for everyone
    begin perform p_value::double precision; exception when others then return false; end;
  else
    return false;                                   -- unknown key
  end if;
  insert into event_settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. VOTING: results without exposing who voted for whom
-- ---------------------------------------------------------------------
-- Attendees can only read THEIR OWN vote rows (policy below). Everyone still
-- sees the live totals through this function, which returns counts only.
create or replace function vote_tally()
returns table(category_id text, candidate_id text, votes bigint)
language sql stable security definer set search_path = public as $$
  select v.category_id, v.candidate_id, count(*)::bigint
  from votes v
  where v.candidate_id is not null
  group by v.category_id, v.candidate_id;
$$;

-- A vote must name a real candidate in an OPEN category. Before categories
-- lived in the database, any category_id/candidate_id string was accepted.
-- Raised as 23503 so vote.html can tell "closed/removed" apart from other errors.
create or replace function votes_check_candidate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from vote_candidates c join vote_categories k on k.id = c.category_id
    where c.category_id = new.category_id and c.id = new.candidate_id and k.active
  ) then
    raise exception 'Voting for this category is closed, or that entry was removed.' using errcode = '23503';
  end if;
  return new;
end;
$$;
drop trigger if exists votes_check_candidate on votes;
create trigger votes_check_candidate before insert or update on votes
  for each row execute function votes_check_candidate();

-- A candidate that already has votes can't be deleted — that would silently
-- orphan those votes. This also blocks deleting its whole category (the
-- cascade fires this per candidate). Close the category instead.
create or replace function vote_candidates_block_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from votes v where v.category_id = old.category_id and v.candidate_id = old.id) then
    raise exception '"%" already has votes — close the category instead of deleting.', old.name using errcode = '23503';
  end if;
  return old;
end;
$$;
drop trigger if exists vote_candidates_block_delete on vote_candidates;
create trigger vote_candidates_block_delete before delete on vote_candidates
  for each row execute function vote_candidates_block_delete();

-- ---------------------------------------------------------------------
-- 7b. ROSTER coverage (staff) — counted here rather than in the browser so
--     it isn't cut off by the API's "Max rows" limit (default 1000).
-- ---------------------------------------------------------------------
create or replace function roster_coverage()
returns table(roster_total bigint, with_account bigint, checked_in bigint, skills_registered bigint, accounts_not_on_roster bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  return query select
    (select count(*) from roster),
    (select count(*) from roster r where exists (select 1 from profiles p where p.student_id = r.student_id)),
    (select count(*) from roster r where exists (select 1 from checkins c where c.student_id = r.student_id)),
    (select count(*) from roster r where exists (select 1 from skills_registrations s where s.student_id = r.student_id)),
    (select count(*) from profiles p where not exists (select 1 from roster r where r.student_id = p.student_id));
end;
$$;

-- ---------------------------------------------------------------------
-- 8. ROW-LEVEL SECURITY: own record or staff to write, admin-only deletes
--    (policies are dropped first so this file can be re-run)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('profiles','students','stamps','checkins','votes','skills_registrations','flagged_scans','sections','event_settings','booth_secrets','vote_categories','vote_candidates','roster')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table profiles             enable row level security;
alter table students             enable row level security;
alter table stamps               enable row level security;
alter table checkins             enable row level security;
alter table votes                enable row level security;
alter table skills_registrations enable row level security;
alter table flagged_scans        enable row level security;
alter table sections             enable row level security;
alter table event_settings       enable row level security;
alter table booth_secrets        enable row level security;   -- no policy on purpose: only the functions above can read it
alter table vote_categories      enable row level security;
alter table vote_candidates      enable row level security;
alter table roster               enable row level security;

-- profiles: see yourself; staff see everyone. No write policy — rows come from
-- the signup trigger and roles change only through set_user_role().
create policy "profiles read own"   on profiles for select using (user_id = auth.uid());
create policy "profiles read staff" on profiles for select using (is_staff());

create policy "students read"   on students for select using (is_staff());
create policy "students insert" on students for insert with check (is_staff());
create policy "students update" on students for update using (is_staff());
create policy "students delete" on students for delete using (is_admin());

create policy "stamps read"   on stamps for select using (student_id = my_student_id() or is_staff());
create policy "stamps insert" on stamps for insert with check (is_staff());   -- students: use claim_stamp()/claim_stamp_offline() instead
create policy "stamps update" on stamps for update using (is_staff());
create policy "stamps delete" on stamps for delete using (is_admin());

create policy "checkins read"   on checkins for select using (is_staff());
create policy "checkins insert" on checkins for insert with check (is_staff());
create policy "checkins delete" on checkins for delete using (is_admin());

create policy "votes read"   on votes for select using (student_id = my_student_id() or is_staff());
create policy "votes insert" on votes for insert with check (student_id = my_student_id() or is_staff());
create policy "votes delete" on votes for delete using (is_admin());

create policy "skills read"   on skills_registrations for select using (student_id = my_student_id() or is_staff());
create policy "skills insert" on skills_registrations for insert with check (student_id = my_student_id() or is_staff());
create policy "skills update" on skills_registrations for update using (student_id = my_student_id() or is_staff());
create policy "skills delete" on skills_registrations for delete using (is_admin());

-- flagged_scans: staff see all; an attendee sees only their own flags (their
-- insert reads the new row back, which needs a matching select policy).
create policy "flags read"   on flagged_scans for select using (is_staff() or student_id = my_student_id());
create policy "flags insert" on flagged_scans for insert
  with check (auth.uid() is not null and (student_id is null or student_id = my_student_id() or is_staff()));
create policy "flags delete" on flagged_scans for delete using (is_admin());

create policy "sections read"   on sections for select using (true);
create policy "sections insert" on sections for insert with check (is_staff());
create policy "sections delete" on sections for delete using (is_staff());

create policy "event_settings read" on event_settings for select using (true);   -- no write policy: only set_event_setting

-- Categories/candidates: anyone can read (the Vote page needs them), only admins edit.
create policy "vote_categories read"   on vote_categories for select using (true);
create policy "vote_categories insert" on vote_categories for insert with check (is_admin());
create policy "vote_categories update" on vote_categories for update using (is_admin());
create policy "vote_categories delete" on vote_categories for delete using (is_admin());
create policy "vote_candidates read"   on vote_candidates for select using (true);
create policy "vote_candidates insert" on vote_candidates for insert with check (is_admin());
create policy "vote_candidates update" on vote_candidates for update using (is_admin());
create policy "vote_candidates delete" on vote_candidates for delete using (is_admin());

-- Roster holds names + sections of every student, so it's staff-read only.
create policy "roster read"   on roster for select using (is_staff());
create policy "roster insert" on roster for insert with check (is_admin());
create policy "roster update" on roster for update using (is_admin());
create policy "roster delete" on roster for delete using (is_admin());

-- ---------------------------------------------------------------------
-- 9. FUNCTION PERMISSIONS
--    Postgres lets PUBLIC (and so anon) run new functions by default, and
--    `revoke ... from anon` alone doesn't undo that — so revoke both, then
--    grant back only what each function is meant for.
-- ---------------------------------------------------------------------
revoke all on function generate_booth_code(text, int)                                  from public, anon;
revoke all on function get_booth_seed(text)                                            from public, anon;
revoke all on function validate_booth_code(text, int, double precision, double precision) from public, anon;
revoke all on function set_event_setting(text, text)                                   from public, anon;
revoke all on function set_user_role(text, text)                                       from public, anon;
revoke all on function vote_tally()                                                    from public, anon;
revoke all on function claim_stamp(text, int, double precision, double precision)      from public, anon;
revoke all on function claim_stamp_offline(text)                                       from public, anon;
revoke all on function roster_coverage()                                               from public, anon;
grant execute on function roster_coverage()                                               to authenticated;
grant execute on function generate_booth_code(text, int)                                  to authenticated;
grant execute on function get_booth_seed(text)                                            to authenticated;
grant execute on function validate_booth_code(text, int, double precision, double precision) to authenticated;
grant execute on function set_event_setting(text, text)                                   to authenticated;
grant execute on function set_user_role(text, text)                                       to authenticated;
grant execute on function vote_tally()                                                    to authenticated;
grant execute on function claim_stamp(text, int, double precision, double precision)      to authenticated;
grant execute on function claim_stamp_offline(text)                                       to authenticated;
-- the login page's first step, and the helpers policies call, must work logged out too
grant execute on function account_exists(text) to anon, authenticated;
grant execute on function roster_lookup(text) to anon, authenticated;
grant execute on function my_role(), my_student_id(), is_staff(), is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. REALTIME (Dashboard / Entrance / Testing live updates)
--     Realtime respects the policies above: staff receive everything,
--     attendees only ever receive their own rows.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profiles','stamps','checkins','votes','skills_registrations','flagged_scans','vote_categories','vote_candidates','roster'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- BOOTSTRAP — run separately, once, after you've created your own account on
-- the Login page. Replace with your Student ID. Everyone after you can be
-- promoted from the app (Testing > Manage roles).
--
--   update profiles set role = 'admin' where student_id = 'YY-NNNN';
--
-- To rotate one booth secret later (Booth Displays re-fetch it when online):
--   update booth_secrets
--     set secret = replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')
--     where booth_id = 'b1';
-- ---------------------------------------------------------------------
