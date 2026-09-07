-- Heart Fit 수업 단위 측정 세션 저장소.
-- 기존 heart_rate_records는 화면 호환용 월 집계로 유지하고 finalize RPC에서만 투영한다.

create table public.heart_rate_sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on update cascade on delete restrict,
  operator_account_id uuid references public.operator_accounts(id) on delete set null,
  client_request_id uuid not null,
  academic_year smallint not null check (academic_year between 2000 and 2100),
  grade smallint not null check (grade between 1 and 6),
  class_no smallint not null check (class_no between 1 and 20),
  school_type smallint not null check (school_type in (1, 2, 3)),
  age_years smallint not null check (age_years between 1 and 120),
  age_source text not null default 'school_type_grade_proxy'
    check (age_source = 'school_type_grade_proxy'),
  age_policy_version text not null default 'school_grade_age_v1'
    check (age_policy_version = 'school_grade_age_v1'),
  zone_policy_version text not null default 'aha_youth_relative_v1'
    check (zone_policy_version = 'aha_youth_relative_v1'),
  quality_policy_version text not null default 'cl830_stable_5s_5samples_v1'
    check (quality_policy_version = 'cl830_stable_5s_5samples_v1'),
  stabilization_seconds smallint not null default 5 check (stabilization_seconds = 5),
  stabilization_min_samples smallint not null default 5 check (stabilization_min_samples = 5),
  stabilization_max_gap_ms integer not null default 2000 check (stabilization_max_gap_ms = 2000),
  valid_bpm_min smallint not null default 40 check (valid_bpm_min = 40),
  valid_bpm_max smallint not null default 220 check (valid_bpm_max = 220),
  bucket_seconds smallint not null default 60 check (bucket_seconds = 60),
  gateway_run_id text,
  transport_received_event_count bigint not null default 0 check (transport_received_event_count >= 0),
  transport_sequence_gap_count bigint not null default 0 check (transport_sequence_gap_count >= 0),
  transport_rejected_sequence_count bigint not null default 0 check (transport_rejected_sequence_count >= 0),
  transport_last_event_at timestamptz,
  status text not null default 'recording'
    check (status in ('recording', 'awaiting_decision', 'completed')),
  started_at timestamptz not null default clock_timestamp(),
  measurement_started_at timestamptz,
  stable_started_at timestamptz,
  stopped_at timestamptz,
  finalized_at timestamptz,
  monthly_projected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint heart_rate_sessions_school_client_request_key unique (school_id, client_request_id),
  constraint heart_rate_sessions_gateway_run_check check (
    gateway_run_id is null or gateway_run_id ~ '^[A-Za-z0-9_-]{1,128}$'
  ),
  constraint heart_rate_sessions_measurement_timing_check check (
    (gateway_run_id is null and measurement_started_at is null and stable_started_at is null)
    or (
      gateway_run_id is not null
      and measurement_started_at is not null
      and stable_started_at = measurement_started_at + interval '5 seconds'
    )
  ),
  constraint heart_rate_sessions_lifecycle_check check (
    (status = 'recording' and stopped_at is null and finalized_at is null and monthly_projected_at is null)
    or (status = 'awaiting_decision' and stopped_at is not null and finalized_at is null and monthly_projected_at is null)
    or (status = 'completed' and stopped_at is not null and finalized_at is not null and monthly_projected_at is not null)
  )
);

create index heart_rate_sessions_school_started_idx
  on public.heart_rate_sessions (school_id, started_at desc);

create table public.heart_rate_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.heart_rate_sessions(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  student_no smallint not null check (student_no between 1 and 30),
  student_name text not null,
  age_years smallint not null check (age_years between 1 and 120),
  age_source text not null check (age_source = 'school_type_grade_proxy'),
  age_policy_version text not null check (age_policy_version = 'school_grade_age_v1'),
  predicted_max_bpm numeric(5,1) not null check (predicted_max_bpm between 120 and 220),
  created_at timestamptz not null default now(),
  constraint heart_rate_session_participants_session_id_id_key unique (session_id, id),
  constraint heart_rate_session_participants_session_student_key unique (session_id, student_id),
  constraint heart_rate_session_participants_session_number_key unique (session_id, student_no)
);

create table public.heart_rate_minute_points (
  session_id uuid not null,
  participant_id uuid not null,
  minute_index integer not null check (minute_index between 1 and 1440),
  revision integer not null check (revision between 1 and 1000000000),
  bucket_started_at timestamptz not null,
  bucket_ended_at timestamptz not null,
  duration_ms integer not null check (duration_ms between 1 and 60000),
  bpm_sum bigint not null,
  sample_count integer not null check (sample_count between 1 and 10000),
  avg_bpm numeric(5,1) generated always as (round(bpm_sum::numeric / sample_count::numeric, 1)) stored,
  min_bpm smallint not null check (min_bpm between 40 and 220),
  max_bpm smallint not null check (max_bpm between 40 and 220),
  is_partial boolean not null default true,
  rssi_sample_count integer not null default 0 check (rssi_sample_count >= 0),
  average_rssi_dbm numeric(5,1),
  min_rssi_dbm smallint,
  max_rssi_dbm smallint,
  battery_percent smallint check (battery_percent between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, participant_id, minute_index),
  foreign key (session_id, participant_id)
    references public.heart_rate_session_participants(session_id, id) on delete cascade,
  constraint heart_rate_minute_points_window_check check (
    bucket_ended_at = bucket_started_at + duration_ms * interval '1 millisecond'
    and (is_partial or duration_ms = 60000)
  ),
  constraint heart_rate_minute_points_bpm_order_check check (
    min_bpm <= max_bpm
    and bpm_sum >= min_bpm::bigint * sample_count::bigint
    and bpm_sum <= max_bpm::bigint * sample_count::bigint
  ),
  constraint heart_rate_minute_points_rssi_check check (
    (
      rssi_sample_count = 0
      and average_rssi_dbm is null
      and min_rssi_dbm is null
      and max_rssi_dbm is null
    )
    or (
      rssi_sample_count > 0
      and rssi_sample_count <= sample_count
      and min_rssi_dbm between -127 and 20
      and max_rssi_dbm between -127 and 20
      and min_rssi_dbm <= average_rssi_dbm
      and average_rssi_dbm <= max_rssi_dbm
    )
  )
);

create index heart_rate_minute_points_participant_idx
  on public.heart_rate_minute_points (participant_id, minute_index);

create table public.heart_rate_session_results (
  session_id uuid not null,
  participant_id uuid not null,
  bpm_sum bigint not null,
  sample_count integer not null check (sample_count > 0),
  avg_bpm numeric(5,1) not null check (avg_bpm between 40 and 220),
  min_bpm smallint not null check (min_bpm between 40 and 220),
  max_bpm smallint not null check (max_bpm between 40 and 220),
  completed_minute_count integer not null default 0 check (completed_minute_count >= 0),
  partial_minute_count integer not null default 0 check (partial_minute_count >= 0),
  created_at timestamptz not null default now(),
  primary key (session_id, participant_id),
  foreign key (session_id, participant_id)
    references public.heart_rate_session_participants(session_id, id) on delete cascade,
  constraint heart_rate_session_results_bpm_order_check check (min_bpm <= avg_bpm and avg_bpm <= max_bpm)
);

alter table public.heart_rate_sessions enable row level security;
alter table public.heart_rate_session_participants enable row level security;
alter table public.heart_rate_minute_points enable row level security;
alter table public.heart_rate_session_results enable row level security;

revoke all on table public.heart_rate_sessions from anon, authenticated;
revoke all on table public.heart_rate_session_participants from anon, authenticated;
revoke all on table public.heart_rate_minute_points from anon, authenticated;
revoke all on table public.heart_rate_session_results from anon, authenticated;

grant all on table public.heart_rate_sessions to service_role;
grant all on table public.heart_rate_session_participants to service_role;
grant all on table public.heart_rate_minute_points to service_role;
grant all on table public.heart_rate_session_results to service_role;

create function public.heart_rate_grade_proxy_age(p_school_type integer, p_grade integer)
returns smallint
language plpgsql
immutable
strict
set search_path = pg_catalog, public
as $$
begin
  if p_school_type = 1 and p_grade between 1 and 6 then
    return (p_grade + 6)::smallint;
  elsif p_school_type = 2 and p_grade between 1 and 3 then
    return (p_grade + 12)::smallint;
  elsif p_school_type = 3 and p_grade between 1 and 3 then
    return (p_grade + 15)::smallint;
  end if;

  raise exception using
    errcode = '22023',
    message = 'heart_rate_invalid_school_grade';
end;
$$;

create function public.heart_rate_session_payload(p_session_id uuid, p_include_measurements boolean default false)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id,
      'client_request_id', s.client_request_id,
      'academic_year', s.academic_year,
      'grade', s.grade,
      'class_no', s.class_no,
      'school_type', s.school_type,
      'age_years', s.age_years,
      'age_source', s.age_source,
      'age_policy_version', s.age_policy_version,
      'zone_policy_version', s.zone_policy_version,
      'quality_policy_version', s.quality_policy_version,
      'stabilization_seconds', s.stabilization_seconds,
      'stabilization_min_samples', s.stabilization_min_samples,
      'stabilization_max_gap_ms', s.stabilization_max_gap_ms,
      'valid_bpm_min', s.valid_bpm_min,
      'valid_bpm_max', s.valid_bpm_max,
      'bucket_seconds', s.bucket_seconds,
      'gateway_run_id', s.gateway_run_id,
      'transport_received_event_count', s.transport_received_event_count,
      'transport_sequence_gap_count', s.transport_sequence_gap_count,
      'transport_rejected_sequence_count', s.transport_rejected_sequence_count,
      'transport_last_event_at', s.transport_last_event_at,
      'status', s.status,
      'started_at', s.started_at,
      'measurement_started_at', s.measurement_started_at,
      'stable_started_at', s.stable_started_at,
      'stopped_at', s.stopped_at,
      'finalized_at', s.finalized_at
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', p.id,
        'student_id', p.student_id,
        'student_no', p.student_no,
        'name', p.student_name,
        'age_years', p.age_years,
        'age_source', p.age_source,
        'age_policy_version', p.age_policy_version,
        'predicted_max_bpm', p.predicted_max_bpm
      ) order by p.student_no)
      from public.heart_rate_session_participants p
      where p.session_id = s.id
    ), '[]'::jsonb),
    'points', case when p_include_measurements then coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', m.participant_id,
        'minute_index', m.minute_index,
        'revision', m.revision,
        'bucket_started_at', m.bucket_started_at,
        'bucket_ended_at', m.bucket_ended_at,
        'duration_ms', m.duration_ms,
        'bpm_sum', m.bpm_sum,
        'sample_count', m.sample_count,
        'avg_bpm', m.avg_bpm,
        'min_bpm', m.min_bpm,
        'max_bpm', m.max_bpm,
        'is_partial', m.is_partial,
        'rssi_sample_count', m.rssi_sample_count,
        'average_rssi_dbm', m.average_rssi_dbm,
        'min_rssi_dbm', m.min_rssi_dbm,
        'max_rssi_dbm', m.max_rssi_dbm,
        'battery_percent', m.battery_percent
      ) order by m.minute_index, m.participant_id)
      from public.heart_rate_minute_points m
      where m.session_id = s.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'results', case when p_include_measurements then coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', r.participant_id,
        'bpm_sum', r.bpm_sum,
        'sample_count', r.sample_count,
        'avg_bpm', r.avg_bpm,
        'min_bpm', r.min_bpm,
        'max_bpm', r.max_bpm,
        'completed_minute_count', r.completed_minute_count,
        'partial_minute_count', r.partial_minute_count
      ) order by r.participant_id)
      from public.heart_rate_session_results r
      where r.session_id = s.id
    ), '[]'::jsonb) else '[]'::jsonb end
  )
  from public.heart_rate_sessions s
  where s.id = p_session_id;
$$;

create function public.start_heart_rate_session(
  p_school_id uuid,
  p_operator_account_id uuid,
  p_client_request_id uuid,
  p_academic_year integer,
  p_grade integer,
  p_class_no integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_school_type integer;
  v_age_years smallint;
  v_session_id uuid;
  v_existing public.heart_rate_sessions%rowtype;
  v_participant_count integer;
begin
  if not exists (
    select 1
    from public.operator_accounts a
    where a.id = p_operator_account_id
      and a.is_active
      and (a.role::text = 'admin' or (a.role::text = 'school' and a.school_id = p_school_id))
  ) then
    raise exception using errcode = '42501', message = 'heart_rate_operator_forbidden';
  end if;

  select s.school_type into v_school_type
  from public.schools s
  where s.id = p_school_id;

  if v_school_type is null then
    raise exception using errcode = 'P0002', message = 'heart_rate_school_not_found';
  end if;

  v_age_years := public.heart_rate_grade_proxy_age(v_school_type, p_grade);

  if p_academic_year not between 2000 and 2100 or p_class_no not between 1 and 20 then
    raise exception using errcode = '22023', message = 'heart_rate_invalid_class_context';
  end if;

  insert into public.heart_rate_sessions (
    school_id,
    operator_account_id,
    client_request_id,
    academic_year,
    grade,
    class_no,
    school_type,
    age_years
  ) values (
    p_school_id,
    p_operator_account_id,
    p_client_request_id,
    p_academic_year,
    p_grade,
    p_class_no,
    v_school_type,
    v_age_years
  )
  on conflict (school_id, client_request_id) do nothing
  returning id into v_session_id;

  if v_session_id is null then
    select * into v_existing
    from public.heart_rate_sessions s
    where s.school_id = p_school_id and s.client_request_id = p_client_request_id
    for update;

    if v_existing.academic_year <> p_academic_year
      or v_existing.grade <> p_grade
      or v_existing.class_no <> p_class_no
      or v_existing.school_type <> v_school_type then
      raise exception using errcode = '23505', message = 'heart_rate_client_request_conflict';
    end if;
    v_session_id := v_existing.id;
  else
    insert into public.heart_rate_session_participants (
      session_id,
      student_id,
      student_no,
      student_name,
      age_years,
      age_source,
      age_policy_version,
      predicted_max_bpm
    )
    select
      v_session_id,
      st.id,
      st.student_no,
      st.name,
      v_age_years,
      'school_type_grade_proxy',
      'school_grade_age_v1',
      round((208::numeric - 0.7::numeric * v_age_years::numeric), 1)
    from public.students st
    where st.school_id = p_school_id
      and st.year = p_academic_year
      and st.grade = p_grade
      and st.class_no = p_class_no
      and st.student_no between 1 and 30
    order by st.student_no;

    get diagnostics v_participant_count = row_count;
    if v_participant_count = 0 then
      delete from public.heart_rate_sessions where id = v_session_id;
      raise exception using errcode = 'P0002', message = 'heart_rate_participants_not_found';
    end if;
  end if;

  return public.heart_rate_session_payload(v_session_id, false);
end;
$$;

create function public.mark_heart_rate_session_stable(
  p_school_id uuid,
  p_session_id uuid,
  p_gateway_run_id text,
  p_run_started_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.heart_rate_sessions%rowtype;
begin
  if p_gateway_run_id is null or p_gateway_run_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception using errcode = '22023', message = 'heart_rate_invalid_gateway_run_id';
  end if;

  select * into v_session
  from public.heart_rate_sessions s
  where s.id = p_session_id and s.school_id = p_school_id
  for update;

  if v_session.id is null then
    raise exception using errcode = 'P0002', message = 'heart_rate_session_not_found';
  end if;
  if v_session.gateway_run_id is not null then
    if v_session.gateway_run_id = p_gateway_run_id
      and v_session.measurement_started_at = p_run_started_at then
      return public.heart_rate_session_payload(p_session_id, false);
    end if;
    raise exception using errcode = '23505', message = 'heart_rate_gateway_run_conflict';
  end if;
  if v_session.status <> 'recording' then
    raise exception using errcode = '55000', message = 'heart_rate_session_not_recording';
  end if;
  if p_run_started_at is null
    or p_run_started_at < greatest(v_session.started_at - interval '5 seconds', clock_timestamp() - interval '2 minutes')
    or p_run_started_at > clock_timestamp() + interval '10 seconds' then
    raise exception using errcode = '22023', message = 'heart_rate_invalid_run_started_at';
  end if;

  update public.heart_rate_sessions
  set gateway_run_id = p_gateway_run_id,
      measurement_started_at = p_run_started_at,
      stable_started_at = p_run_started_at + interval '5 seconds',
      updated_at = now()
  where id = p_session_id;

  return public.heart_rate_session_payload(p_session_id, false);
end;
$$;

create function public.heart_rate_upsert_absolute_points(p_session_id uuid, p_points jsonb)
returns integer
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_session public.heart_rate_sessions%rowtype;
  v_item jsonb;
  v_participant_id uuid;
  v_minute_index integer;
  v_revision integer;
  v_duration_ms integer;
  v_bpm_sum bigint;
  v_sample_count integer;
  v_min_bpm smallint;
  v_max_bpm smallint;
  v_is_partial boolean;
  v_rssi_sample_count integer;
  v_average_rssi_dbm numeric(5,1);
  v_min_rssi_dbm smallint;
  v_max_rssi_dbm smallint;
  v_battery_percent smallint;
  v_existing public.heart_rate_minute_points%rowtype;
  v_updated_count integer := 0;
begin
  if coalesce(jsonb_typeof(p_points), '') <> 'array' or jsonb_array_length(p_points) > 3600 then
    raise exception using errcode = '22023', message = 'heart_rate_invalid_checkpoint_batch';
  end if;

  select * into v_session
  from public.heart_rate_sessions s
  where s.id = p_session_id;

  if v_session.id is null then
    raise exception using errcode = 'P0002', message = 'heart_rate_session_not_found';
  end if;
  if jsonb_array_length(p_points) > 0 and v_session.stable_started_at is null then
    raise exception using errcode = '55000', message = 'heart_rate_session_not_stable';
  end if;

  for v_item in select value from jsonb_array_elements(p_points)
  loop
    if not (v_item ?& array[
      'participant_id', 'minute_index', 'revision', 'duration_ms', 'bpm_sum', 'sample_count',
      'min_bpm', 'max_bpm', 'is_partial'
    ]) then
      raise exception using errcode = '22023', message = 'heart_rate_checkpoint_field_missing';
    end if;

    v_participant_id := (v_item->>'participant_id')::uuid;
    v_minute_index := (v_item->>'minute_index')::integer;
    v_revision := (v_item->>'revision')::integer;
    v_duration_ms := (v_item->>'duration_ms')::integer;
    v_bpm_sum := (v_item->>'bpm_sum')::bigint;
    v_sample_count := (v_item->>'sample_count')::integer;
    v_min_bpm := (v_item->>'min_bpm')::smallint;
    v_max_bpm := (v_item->>'max_bpm')::smallint;
    v_is_partial := (v_item->>'is_partial')::boolean;
    v_rssi_sample_count := coalesce((v_item->>'rssi_sample_count')::integer, 0);
    v_average_rssi_dbm := (v_item->>'average_rssi_dbm')::numeric(5,1);
    v_min_rssi_dbm := (v_item->>'min_rssi_dbm')::smallint;
    v_max_rssi_dbm := (v_item->>'max_rssi_dbm')::smallint;
    v_battery_percent := (v_item->>'battery_percent')::smallint;

    if v_minute_index not between 1 and 1440
      or v_revision not between 1 and 1000000000
      or v_duration_ms not between 1 and 60000
      or v_sample_count not between 1 and 10000
      or v_min_bpm not between 40 and 220
      or v_max_bpm not between 40 and 220
      or v_bpm_sum not between v_min_bpm::bigint * v_sample_count::bigint and v_max_bpm::bigint * v_sample_count::bigint
      or v_rssi_sample_count < 0
      or v_rssi_sample_count > v_sample_count
      or (
        v_rssi_sample_count = 0
        and (v_average_rssi_dbm is not null or v_min_rssi_dbm is not null or v_max_rssi_dbm is not null)
      )
      or (
        v_rssi_sample_count > 0
        and (
          v_average_rssi_dbm is null
          or v_min_rssi_dbm is null
          or v_max_rssi_dbm is null
          or v_min_rssi_dbm not between -127 and 20
          or v_max_rssi_dbm not between -127 and 20
          or v_average_rssi_dbm not between v_min_rssi_dbm and v_max_rssi_dbm
        )
      )
      or (not v_is_partial and v_duration_ms <> 60000)
      or (v_battery_percent is not null and v_battery_percent not between 0 and 100) then
      raise exception using errcode = '22023', message = 'heart_rate_invalid_checkpoint_point';
    end if;

    if not exists (
      select 1
      from public.heart_rate_session_participants p
      where p.session_id = p_session_id and p.id = v_participant_id
    ) then
      raise exception using errcode = '23503', message = 'heart_rate_participant_not_in_session';
    end if;

    select * into v_existing
    from public.heart_rate_minute_points m
    where m.session_id = p_session_id
      and m.participant_id = v_participant_id
      and m.minute_index = v_minute_index
    for update;

    if v_existing.session_id is not null then
      if v_revision < v_existing.revision then
        continue;
      elsif v_revision = v_existing.revision then
        if v_bpm_sum is distinct from v_existing.bpm_sum
          or v_sample_count is distinct from v_existing.sample_count
          or v_min_bpm is distinct from v_existing.min_bpm
          or v_max_bpm is distinct from v_existing.max_bpm
          or v_duration_ms is distinct from v_existing.duration_ms
          or v_is_partial is distinct from v_existing.is_partial
          or v_rssi_sample_count is distinct from v_existing.rssi_sample_count
          or v_average_rssi_dbm is distinct from v_existing.average_rssi_dbm
          or v_min_rssi_dbm is distinct from v_existing.min_rssi_dbm
          or v_max_rssi_dbm is distinct from v_existing.max_rssi_dbm
          or v_battery_percent is distinct from v_existing.battery_percent then
          raise exception using errcode = '23505', message = 'heart_rate_checkpoint_revision_conflict';
        end if;
        continue;
      elsif not v_existing.is_partial then
        raise exception using errcode = '55000', message = 'heart_rate_checkpoint_already_complete';
      elsif v_sample_count < v_existing.sample_count then
        raise exception using errcode = '22023', message = 'heart_rate_checkpoint_sample_count_regressed';
      end if;

      update public.heart_rate_minute_points
      set revision = v_revision,
          bucket_started_at = v_session.stable_started_at + make_interval(secs => (v_minute_index - 1) * 60),
          bucket_ended_at = v_session.stable_started_at
            + make_interval(secs => (v_minute_index - 1) * 60)
            + v_duration_ms * interval '1 millisecond',
          duration_ms = v_duration_ms,
          bpm_sum = v_bpm_sum,
          sample_count = v_sample_count,
          min_bpm = v_min_bpm,
          max_bpm = v_max_bpm,
          is_partial = v_is_partial,
          rssi_sample_count = v_rssi_sample_count,
          average_rssi_dbm = v_average_rssi_dbm,
          min_rssi_dbm = v_min_rssi_dbm,
          max_rssi_dbm = v_max_rssi_dbm,
          battery_percent = v_battery_percent,
          updated_at = now()
      where session_id = p_session_id
        and participant_id = v_participant_id
        and minute_index = v_minute_index;
    else
      insert into public.heart_rate_minute_points (
        session_id,
        participant_id,
        minute_index,
        revision,
        bucket_started_at,
        bucket_ended_at,
        duration_ms,
        bpm_sum,
        sample_count,
        min_bpm,
        max_bpm,
        is_partial,
        rssi_sample_count,
        average_rssi_dbm,
        min_rssi_dbm,
        max_rssi_dbm,
        battery_percent
      ) values (
        p_session_id,
        v_participant_id,
        v_minute_index,
        v_revision,
        v_session.stable_started_at + make_interval(secs => (v_minute_index - 1) * 60),
        v_session.stable_started_at
          + make_interval(secs => (v_minute_index - 1) * 60)
          + v_duration_ms * interval '1 millisecond',
        v_duration_ms,
        v_bpm_sum,
        v_sample_count,
        v_min_bpm,
        v_max_bpm,
        v_is_partial,
        v_rssi_sample_count,
        v_average_rssi_dbm,
        v_min_rssi_dbm,
        v_max_rssi_dbm,
        v_battery_percent
      );
    end if;

    v_updated_count := v_updated_count + 1;
  end loop;

  return v_updated_count;
end;
$$;

create function public.heart_rate_update_transport_quality(p_session_id uuid, p_transport_quality jsonb)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_session public.heart_rate_sessions%rowtype;
  v_received_event_count bigint;
  v_sequence_gap_count bigint;
  v_rejected_sequence_count bigint;
  v_last_event_at timestamptz;
begin
  if coalesce(jsonb_typeof(p_transport_quality), '') <> 'object'
    or not (p_transport_quality ?& array[
      'received_event_count', 'sequence_gap_count', 'rejected_sequence_count', 'last_event_at'
    ]) then
    raise exception using errcode = '22023', message = 'heart_rate_invalid_transport_quality';
  end if;

  v_received_event_count := (p_transport_quality->>'received_event_count')::bigint;
  v_sequence_gap_count := (p_transport_quality->>'sequence_gap_count')::bigint;
  v_rejected_sequence_count := (p_transport_quality->>'rejected_sequence_count')::bigint;
  v_last_event_at := (p_transport_quality->>'last_event_at')::timestamptz;

  select * into v_session
  from public.heart_rate_sessions s
  where s.id = p_session_id;

  if v_session.id is null then
    raise exception using errcode = 'P0002', message = 'heart_rate_session_not_found';
  end if;
  if v_received_event_count not between 0 and 9007199254740991
    or v_sequence_gap_count not between 0 and 9007199254740991
    or v_rejected_sequence_count not between 0 and 9007199254740991
    or (v_received_event_count = 0 and v_last_event_at is not null)
    or (v_received_event_count > 0 and v_last_event_at is null)
    or (
      v_last_event_at is not null
      and (
        v_session.measurement_started_at is null
        or v_last_event_at < v_session.measurement_started_at - interval '5 seconds'
        or v_last_event_at > clock_timestamp() + interval '10 seconds'
      )
    ) then
    raise exception using errcode = '22023', message = 'heart_rate_invalid_transport_quality';
  end if;

  update public.heart_rate_sessions
  set transport_received_event_count = greatest(transport_received_event_count, v_received_event_count),
      transport_sequence_gap_count = greatest(transport_sequence_gap_count, v_sequence_gap_count),
      transport_rejected_sequence_count = greatest(transport_rejected_sequence_count, v_rejected_sequence_count),
      transport_last_event_at = case
        when transport_last_event_at is null then v_last_event_at
        when v_last_event_at is null then transport_last_event_at
        else greatest(transport_last_event_at, v_last_event_at)
      end,
      updated_at = now()
  where id = p_session_id;
end;
$$;

create function public.checkpoint_heart_rate_session(
  p_school_id uuid,
  p_session_id uuid,
  p_points jsonb,
  p_transport_quality jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.heart_rate_sessions%rowtype;
  v_updated_count integer;
begin
  select * into v_session
  from public.heart_rate_sessions s
  where s.id = p_session_id and s.school_id = p_school_id
  for update;

  if v_session.id is null then
    raise exception using errcode = 'P0002', message = 'heart_rate_session_not_found';
  end if;
  if v_session.status <> 'recording' then
    raise exception using errcode = '55000', message = 'heart_rate_session_not_recording';
  end if;
  if coalesce(jsonb_array_length(p_points), 0) = 0 then
    raise exception using errcode = '22023', message = 'heart_rate_empty_checkpoint';
  end if;
  if jsonb_array_length(p_points) > 60 then
    raise exception using errcode = '22023', message = 'heart_rate_checkpoint_batch_too_large';
  end if;

  v_updated_count := public.heart_rate_upsert_absolute_points(p_session_id, p_points);
  perform public.heart_rate_update_transport_quality(p_session_id, p_transport_quality);
  return jsonb_build_object(
    'session_id', p_session_id,
    'status', 'recording',
    'accepted_point_count', v_updated_count,
    'checked_at', clock_timestamp()
  );
end;
$$;

create function public.stop_heart_rate_session(
  p_school_id uuid,
  p_session_id uuid,
  p_points jsonb,
  p_transport_quality jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.heart_rate_sessions%rowtype;
begin
  select * into v_session
  from public.heart_rate_sessions s
  where s.id = p_session_id and s.school_id = p_school_id
  for update;

  if v_session.id is null then
    raise exception using errcode = 'P0002', message = 'heart_rate_session_not_found';
  end if;
  if v_session.status = 'completed' then
    return public.heart_rate_session_payload(p_session_id, true);
  end if;
  if coalesce(jsonb_typeof(p_points), '') <> 'array' or jsonb_array_length(p_points) > 3600 then
    raise exception using errcode = '22023', message = 'heart_rate_stop_snapshot_too_large';
  end if;

  perform public.heart_rate_upsert_absolute_points(p_session_id, coalesce(p_points, '[]'::jsonb));
  perform public.heart_rate_update_transport_quality(p_session_id, p_transport_quality);

  update public.heart_rate_sessions
  set status = 'awaiting_decision',
      stopped_at = coalesce(stopped_at, clock_timestamp()),
      updated_at = now()
  where id = p_session_id;

  return public.heart_rate_session_payload(p_session_id, true);
end;
$$;

create function public.finalize_heart_rate_session(p_school_id uuid, p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.heart_rate_sessions%rowtype;
  v_calendar_year smallint;
  v_calendar_month smallint;
begin
  select * into v_session
  from public.heart_rate_sessions s
  where s.id = p_session_id and s.school_id = p_school_id
  for update;

  if v_session.id is null then
    raise exception using errcode = 'P0002', message = 'heart_rate_session_not_found';
  end if;
  if v_session.status = 'completed' then
    return public.heart_rate_session_payload(p_session_id, true);
  end if;
  if v_session.status <> 'awaiting_decision' then
    raise exception using errcode = '55000', message = 'heart_rate_session_must_be_stopped';
  end if;

  insert into public.heart_rate_session_results (
    session_id,
    participant_id,
    bpm_sum,
    sample_count,
    avg_bpm,
    min_bpm,
    max_bpm,
    completed_minute_count,
    partial_minute_count
  )
  select
    p_session_id,
    m.participant_id,
    sum(m.bpm_sum)::bigint,
    sum(m.sample_count)::integer,
    round(sum(m.bpm_sum)::numeric / sum(m.sample_count)::numeric, 1),
    min(m.min_bpm)::smallint,
    max(m.max_bpm)::smallint,
    count(*) filter (where not m.is_partial)::integer,
    count(*) filter (where m.is_partial)::integer
  from public.heart_rate_minute_points m
  where m.session_id = p_session_id
  group by m.participant_id;

  v_calendar_year := extract(year from v_session.stopped_at at time zone 'Asia/Seoul')::smallint;
  v_calendar_month := extract(month from v_session.stopped_at at time zone 'Asia/Seoul')::smallint;

  insert into public.heart_rate_records as monthly (
    student_id,
    year,
    month,
    avg_bpm,
    max_bpm,
    min_bpm,
    record_count,
    updated_at
  )
  select
    participant.student_id,
    v_calendar_year,
    v_calendar_month,
    result.avg_bpm,
    result.max_bpm,
    result.min_bpm,
    1,
    now()
  from public.heart_rate_session_results result
  join public.heart_rate_session_participants participant
    on participant.session_id = result.session_id and participant.id = result.participant_id
  join public.students current_student on current_student.id = participant.student_id
  where result.session_id = p_session_id
  on conflict (student_id, year, month) do update
  set avg_bpm = case
        when monthly.record_count <= 0 or monthly.avg_bpm is null then excluded.avg_bpm
        else round((monthly.avg_bpm * monthly.record_count + excluded.avg_bpm) / (monthly.record_count + 1), 1)
      end,
      max_bpm = greatest(coalesce(monthly.max_bpm, excluded.max_bpm), excluded.max_bpm),
      min_bpm = least(coalesce(monthly.min_bpm, excluded.min_bpm), excluded.min_bpm),
      record_count = greatest(monthly.record_count, 0) + 1,
      updated_at = now();

  update public.heart_rate_sessions
  set status = 'completed',
      finalized_at = clock_timestamp(),
      monthly_projected_at = clock_timestamp(),
      updated_at = now()
  where id = p_session_id;

  return public.heart_rate_session_payload(p_session_id, true);
end;
$$;

create function public.discard_heart_rate_session(p_school_id uuid, p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
begin
  select s.status into v_status
  from public.heart_rate_sessions s
  where s.id = p_session_id and s.school_id = p_school_id
  for update;

  if v_status is null then
    return jsonb_build_object('session_id', p_session_id, 'discarded', true, 'already_missing', true);
  end if;
  if v_status = 'completed' then
    raise exception using errcode = '55000', message = 'heart_rate_completed_session_delete_denied';
  end if;

  delete from public.heart_rate_sessions
  where id = p_session_id and school_id = p_school_id;

  return jsonb_build_object('session_id', p_session_id, 'discarded', true, 'already_missing', false);
end;
$$;

create function public.get_heart_rate_session(p_school_id uuid, p_session_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_payload jsonb;
begin
  select public.heart_rate_session_payload(s.id, true) into v_payload
  from public.heart_rate_sessions s
  where s.id = p_session_id and s.school_id = p_school_id;

  if v_payload is null then
    raise exception using errcode = 'P0002', message = 'heart_rate_session_not_found';
  end if;
  return v_payload;
end;
$$;

create function public.prevent_completed_heart_rate_session_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status = 'completed' then
    raise exception using errcode = '55000', message = 'heart_rate_completed_session_delete_denied';
  end if;
  return old;
end;
$$;

create trigger prevent_completed_heart_rate_session_delete
before delete on public.heart_rate_sessions
for each row execute function public.prevent_completed_heart_rate_session_delete();

revoke all on function public.heart_rate_grade_proxy_age(integer, integer) from public, anon, authenticated;
revoke all on function public.heart_rate_session_payload(uuid, boolean) from public, anon, authenticated;
revoke all on function public.heart_rate_upsert_absolute_points(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.heart_rate_update_transport_quality(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.prevent_completed_heart_rate_session_delete() from public, anon, authenticated;

revoke all on function public.start_heart_rate_session(uuid, uuid, uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.mark_heart_rate_session_stable(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.checkpoint_heart_rate_session(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.stop_heart_rate_session(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_heart_rate_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.discard_heart_rate_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_heart_rate_session(uuid, uuid) from public, anon, authenticated;

grant execute on function public.start_heart_rate_session(uuid, uuid, uuid, integer, integer, integer) to service_role;
grant execute on function public.mark_heart_rate_session_stable(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.checkpoint_heart_rate_session(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.stop_heart_rate_session(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.finalize_heart_rate_session(uuid, uuid) to service_role;
grant execute on function public.discard_heart_rate_session(uuid, uuid) to service_role;
grant execute on function public.get_heart_rate_session(uuid, uuid) to service_role;
