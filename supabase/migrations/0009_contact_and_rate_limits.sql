-- 0009_contact_and_rate_limits.sql
--
-- Two tables behind the /contact form (design-polish, 2026-10-30).
--
-- contact_messages: anyone may insert, only an organiser may read. Nobody may
-- update or delete through the API. The anon key is public, so PostgREST can be
-- called without the form: the check constraints and the hourly cap in the
-- insert policy hold for that caller as well, and the form's own per-IP limit
-- does not.
--
-- rate_limits: counters for the per-IP limit, keyed by a hash of the IP, so no
-- address is stored. No policy on purpose: it is only reached through
-- rate_limit_hit(), a SECURITY DEFINER function, which also prunes old rows.
--
-- Safe to run twice. Rollback SQL is in Task.md.

create table if not exists public.contact_messages (
    id          uuid primary key default gen_random_uuid(),
    name        text not null check (char_length(name) between 2 and 80),
    email       text not null check (char_length(email) between 3 and 254),
    message     text not null check (char_length(message) between 10 and 2000),
    created_at  timestamptz not null default now()
);

comment on table public.contact_messages is
    'Messages from the /contact form. Anon may insert, organisers may read.';

create index if not exists contact_messages_created_at_idx
    on public.contact_messages (created_at desc);

create table if not exists public.rate_limits (
    key             text primary key check (char_length(key) <= 128),
    hits            integer not null default 1,
    window_started  timestamptz not null default now()
);

comment on table public.rate_limits is
    'Fixed-window counters, reached only through rate_limit_hit(). Keys are hashes.';

alter table public.contact_messages enable row level security;
alter table public.rate_limits enable row level security;

-- Supabase's default privileges grant every table to anon and authenticated.
-- The rows below are the whole of what they get.
revoke all on table public.contact_messages from anon, authenticated;
revoke all on table public.rate_limits from anon, authenticated;
grant insert (name, email, message) on table public.contact_messages to anon, authenticated;
grant select on table public.contact_messages to authenticated;

create or replace function public.contact_messages_under_cap()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select count(*) < 200
    from public.contact_messages
    where created_at > now() - interval '1 hour';
$$;

revoke all on function public.contact_messages_under_cap() from public;
grant execute on function public.contact_messages_under_cap() to anon, authenticated;

drop policy if exists contact_messages_insert on public.contact_messages;
create policy contact_messages_insert on public.contact_messages
    for insert to anon, authenticated
    with check (public.contact_messages_under_cap());

drop policy if exists contact_messages_organiser_read on public.contact_messages;
create policy contact_messages_organiser_read on public.contact_messages
    for select to authenticated
    using (
        exists (
            select 1 from public.profiles p
            where p.auth_user_id = auth.uid() and p.is_organiser
        )
    );

-- One hit against p_key. True while the window's count is within p_max.
create or replace function public.rate_limit_hit(
    p_key text,
    p_max integer,
    p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_hits integer;
begin
    if p_key is null or char_length(p_key) > 128
       or p_max < 1 or p_window_seconds not between 1 and 86400 then
        raise exception 'invalid rate limit arguments' using errcode = '22023';
    end if;

    delete from public.rate_limits where window_started < now() - interval '1 day';

    insert into public.rate_limits as r (key)
    values (p_key)
    on conflict (key) do update
        set hits = case
                when r.window_started < now() - make_interval(secs => p_window_seconds) then 1
                else r.hits + 1
            end,
            window_started = case
                when r.window_started < now() - make_interval(secs => p_window_seconds) then now()
                else r.window_started
            end
    returning r.hits into v_hits;

    return v_hits <= p_max;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public;
grant execute on function public.rate_limit_hit(text, integer, integer) to anon, authenticated;
