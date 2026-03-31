-- ============================================
-- Midway — Supabase Schema (idempotent / safe to re-run)
-- Run this in the Supabase SQL editor.
-- Will NOT drop or destroy any existing data.
-- ============================================

-- 1. User profiles (extends Supabase auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  avatar_url text,
  home_location_address text,
  home_location_lat double precision,
  home_location_lng double precision,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Saved locations (home, work, frequent places)
create table if not exists public.saved_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  label text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  is_favorite boolean default false,
  created_at timestamptz default now()
);

-- 3. Search history (every "Find the Sweet Spot" click, anonymous + signed-in)
create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  anon_id text,
  user_id uuid references public.profiles(id) on delete set null,
  mode text,
  vibe text,
  ai_prompt text,
  locations jsonb,
  meeting_time timestamptz,
  created_at timestamptz default now()
);

-- 4. Venue interactions (views, directions, favorites, selections)
create table if not exists public.venue_interactions (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  anon_id text,
  user_id uuid references public.profiles(id) on delete set null,
  venue_name text not null,
  venue_place_id text,
  venue_address text,
  venue_lat double precision,
  venue_lng double precision,
  venue_rating real,
  venue_rank integer,
  interaction_type text not null,
  created_at timestamptz default now()
);

-- 5. Activity logs
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  event_type text not null,
  event_data jsonb,
  created_at timestamptz default now()
);

-- 6. Analytics events (anonymous + signed-in)
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  anon_id text,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  event_data jsonb,
  device_info jsonb,
  user_location jsonb,
  page_url text,
  created_at timestamptz default now()
);

-- 7. API call log (Google Maps + AI providers)
create table if not exists public.api_calls (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  anon_id text,
  user_id uuid references public.profiles(id) on delete set null,
  provider text not null,
  api_type text not null,
  success boolean default true,
  error_message text,
  latency_ms integer,
  created_at timestamptz default now()
);

-- 8. Client logs (console.log/warn/error)
create table if not exists public.client_logs (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  anon_id text,
  user_id uuid references public.profiles(id) on delete set null,
  log_level text not null,
  message text,
  stack text,
  context jsonb,
  page_url text,
  created_at timestamptz default now()
);

-- 9. Session metrics (active time + time-to-first-action)
create table if not exists public.session_metrics (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  anon_id text,
  user_id uuid references public.profiles(id) on delete set null,
  active_duration_sec integer default 0,
  time_to_first_action_sec integer,
  started_at timestamptz default now(),
  last_heartbeat_at timestamptz default now()
);

-- 10. Groups (invite link sessions, auto-expire after 12 hours)
create table if not exists public.groups (
  code text primary key,
  created_by text,
  created_at timestamptz default now()
);

-- ============================================
-- Row Level Security (enable is idempotent)
-- ============================================
alter table public.profiles enable row level security;
alter table public.saved_locations enable row level security;
alter table public.search_history enable row level security;
alter table public.venue_interactions enable row level security;
alter table public.activity_logs enable row level security;
alter table public.analytics_events enable row level security;
alter table public.api_calls enable row level security;
alter table public.client_logs enable row level security;
alter table public.session_metrics enable row level security;
alter table public.groups enable row level security;

-- ============================================
-- Policies (skip if already exists)
-- ============================================
do $$ begin
  -- Profiles
  if not exists (select 1 from pg_policies where policyname = 'Users read own profile' and tablename = 'profiles') then
    create policy "Users read own profile" on public.profiles for select using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users update own profile' and tablename = 'profiles') then
    create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users insert own profile' and tablename = 'profiles') then
    create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = id);
  end if;

  -- Saved locations
  if not exists (select 1 from pg_policies where policyname = 'Users manage own saved locations' and tablename = 'saved_locations') then
    create policy "Users manage own saved locations" on public.saved_locations for all using (auth.uid() = user_id);
  end if;

  -- Search history
  if not exists (select 1 from pg_policies where policyname = 'Users manage own search history' and tablename = 'search_history') then
    create policy "Users manage own search history" on public.search_history for all using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Anyone can insert search history' and tablename = 'search_history') then
    create policy "Anyone can insert search history" on public.search_history for insert with check (true);
  end if;

  -- Venue interactions
  if not exists (select 1 from pg_policies where policyname = 'Users manage own venue interactions' and tablename = 'venue_interactions') then
    create policy "Users manage own venue interactions" on public.venue_interactions for all using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Anyone can insert venue interactions' and tablename = 'venue_interactions') then
    create policy "Anyone can insert venue interactions" on public.venue_interactions for insert with check (true);
  end if;

  -- Activity logs
  if not exists (select 1 from pg_policies where policyname = 'Users manage own activity logs' and tablename = 'activity_logs') then
    create policy "Users manage own activity logs" on public.activity_logs for all using (auth.uid() = user_id);
  end if;

  -- Analytics events
  if not exists (select 1 from pg_policies where policyname = 'Anyone can insert analytics events' and tablename = 'analytics_events') then
    create policy "Anyone can insert analytics events" on public.analytics_events for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users read own analytics' and tablename = 'analytics_events') then
    create policy "Users read own analytics" on public.analytics_events for select using (
      auth.uid() = user_id
      or session_id = current_setting('request.headers', true)::json->>'x-session-id'
    );
  end if;

  -- API calls
  if not exists (select 1 from pg_policies where policyname = 'Anyone can insert api calls' and tablename = 'api_calls') then
    create policy "Anyone can insert api calls" on public.api_calls for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users read own api calls' and tablename = 'api_calls') then
    create policy "Users read own api calls" on public.api_calls for select using (
      auth.uid() = user_id
      or session_id = current_setting('request.headers', true)::json->>'x-session-id'
    );
  end if;

  -- Client logs
  if not exists (select 1 from pg_policies where policyname = 'Anyone can insert client logs' and tablename = 'client_logs') then
    create policy "Anyone can insert client logs" on public.client_logs for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users read own client logs' and tablename = 'client_logs') then
    create policy "Users read own client logs" on public.client_logs for select using (
      auth.uid() = user_id
      or session_id = current_setting('request.headers', true)::json->>'x-session-id'
    );
  end if;

  -- Session metrics
  if not exists (select 1 from pg_policies where policyname = 'Anyone can insert session metrics' and tablename = 'session_metrics') then
    create policy "Anyone can insert session metrics" on public.session_metrics for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Anyone can update session metrics' and tablename = 'session_metrics') then
    create policy "Anyone can update session metrics" on public.session_metrics for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Anyone can select session metrics' and tablename = 'session_metrics') then
    create policy "Anyone can select session metrics" on public.session_metrics for select using (true);
  end if;

  -- Groups
  if not exists (select 1 from pg_policies where policyname = 'Anyone can insert groups' and tablename = 'groups') then
    create policy "Anyone can insert groups" on public.groups for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Anyone can select groups' and tablename = 'groups') then
    create policy "Anyone can select groups" on public.groups for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Anyone can delete expired groups' and tablename = 'groups') then
    create policy "Anyone can delete expired groups" on public.groups for delete using (created_at < now() - interval '12 hours');
  end if;
end $$;

-- ============================================
-- Auto-create profile on signup (function is CREATE OR REPLACE, trigger is drop+create)
-- ============================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', '')
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger: only create if it doesn't already exist (no DROP needed)
do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'on_auth_user_created'
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end $$;

-- 11. Shared sessions (share links with auto-expiry after 12 hours)
create table if not exists public.shared_sessions (
  code text primary key,
  snapshot jsonb not null,
  created_at timestamptz default now()
);

alter table public.shared_sessions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Anyone can insert shared sessions' and tablename = 'shared_sessions') then
    create policy "Anyone can insert shared sessions" on public.shared_sessions for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Anyone can select shared sessions' and tablename = 'shared_sessions') then
    create policy "Anyone can select shared sessions" on public.shared_sessions for select using (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Anyone can delete expired shared sessions' and tablename = 'shared_sessions') then
    create policy "Anyone can delete expired shared sessions" on public.shared_sessions for delete using (created_at < now() - interval '12 hours');
  end if;
end $$;

-- ============================================
-- Indexes (IF NOT EXISTS — all safe)
-- ============================================
create index if not exists idx_saved_locations_user on public.saved_locations(user_id);
create index if not exists idx_search_history_user on public.search_history(user_id, created_at desc);
create index if not exists idx_search_history_anon on public.search_history(anon_id, created_at desc);
create index if not exists idx_venue_interactions_user on public.venue_interactions(user_id, created_at desc);
create index if not exists idx_activity_logs_user on public.activity_logs(user_id, created_at desc);

create index if not exists idx_analytics_session on public.analytics_events(session_id, created_at desc);
create index if not exists idx_analytics_anon on public.analytics_events(anon_id, created_at desc);
create index if not exists idx_analytics_user on public.analytics_events(user_id, created_at desc);
create index if not exists idx_analytics_type on public.analytics_events(event_type, created_at desc);

create index if not exists idx_api_calls_provider on public.api_calls(provider, created_at desc);
create index if not exists idx_api_calls_anon on public.api_calls(anon_id, created_at desc);
create index if not exists idx_api_calls_user on public.api_calls(user_id, created_at desc);
create index if not exists idx_api_calls_session on public.api_calls(session_id, created_at desc);

create index if not exists idx_client_logs_level on public.client_logs(log_level, created_at desc);
create index if not exists idx_client_logs_session on public.client_logs(session_id, created_at desc);
create index if not exists idx_client_logs_anon on public.client_logs(anon_id, created_at desc);

create index if not exists idx_session_metrics_session on public.session_metrics(session_id);
create index if not exists idx_groups_created_at on public.groups(created_at);
create index if not exists idx_shared_sessions_created_at on public.shared_sessions(created_at);
create index if not exists idx_session_metrics_anon on public.session_metrics(anon_id);
create index if not exists idx_session_metrics_user on public.session_metrics(user_id);

-- ============================================
-- 12. Subscriptions (Razorpay payment tracking)
-- ============================================
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  plan text not null check (plan in ('monthly', 'yearly')),
  status text not null default 'active' check (status in ('active', 'cancelled', 'expired')),
  razorpay_payment_id text,
  razorpay_subscription_id text,
  amount integer not null,
  currency text not null default 'INR',
  started_at timestamptz default now(),
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

alter table public.subscriptions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Users read own subscriptions' and tablename = 'subscriptions') then
    create policy "Users read own subscriptions" on public.subscriptions for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users insert own subscriptions' and tablename = 'subscriptions') then
    create policy "Users insert own subscriptions" on public.subscriptions for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users update own subscriptions' and tablename = 'subscriptions') then
    create policy "Users update own subscriptions" on public.subscriptions for update using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists idx_subscriptions_user on public.subscriptions(user_id, status);
create index if not exists idx_subscriptions_expires on public.subscriptions(expires_at);
