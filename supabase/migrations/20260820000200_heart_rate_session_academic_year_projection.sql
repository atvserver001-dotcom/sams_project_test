-- Preserve the existing school-year view when projecting finalized sessions
-- into the legacy monthly heart-rate table (March through February).

create or replace function public.finalize_heart_rate_session(p_school_id uuid, p_session_id uuid)
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

  v_calendar_month := extract(month from v_session.stopped_at at time zone 'Asia/Seoul')::smallint;
  v_calendar_year := (
    v_session.academic_year + case when v_calendar_month <= 2 then 1 else 0 end
  )::smallint;

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
