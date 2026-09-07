-- 배치 업서트 + 멱등 처리(키 충돌은 입력 단계에서 그룹화)
create or replace function public.upsert_exercise_records_batch(p_items jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int := 0;
begin
  /* p_items 예시
    [
      {
        "idempotency_key":"device-uuid-1",
        "recognition_key":"SCHL-KEY-1234",
        "year":2025, "grade":3, "class_no":2, "student_no":17,
        "exercise_type":"endurance", "month":10,
        "avg_duration_seconds":600, "avg_accuracy":95, "avg_bpm":130, "avg_max_bpm":175, "avg_calories":120
      }
    ]
  */

  with input as (
    select
      (x->>'idempotency_key')::text          as idempotency_key,
      (x->>'recognition_key')::text          as recognition_key,
      (x->>'year')::smallint                 as year,
      (x->>'grade')::smallint                as grade,
      (x->>'class_no')::smallint             as class_no,
      (x->>'student_no')::smallint           as student_no,
      (x->>'exercise_type')::text            as exercise_type,
      (x->>'month')::smallint                as month,
      (x->>'avg_duration_seconds')::numeric  as d,
      (x->>'avg_accuracy')::numeric          as a,
      (x->>'avg_bpm')::numeric               as b,
      (x->>'avg_max_bpm')::numeric           as mb,
      (x->>'avg_calories')::numeric          as c
    from jsonb_array_elements(p_items) as x
  ),
  -- 멱등키 삽입(이미 존재하는 이벤트는 제외)
  idem as (
    insert into public.exercise_ingest_events (
      idempotency_key, recognition_key, year, grade, class_no, student_no, exercise_type, month
    )
    select i.idempotency_key, i.recognition_key, i.year, i.grade, i.class_no, i.student_no, i.exercise_type, i.month
    from input i
    where i.idempotency_key is not null
    on conflict do nothing
    returning idempotency_key, recognition_key, year, grade, class_no, student_no, exercise_type, month
  ),
  filtered as (
    -- 금번 트랜잭션에서 새로 넣어진 멱등키만 진행
    select i.*
    from input i
    join idem d using (idempotency_key, recognition_key, year, grade, class_no, student_no, exercise_type, month)
  ),
  keyed as (
    -- 같은 키(학생/연/월/타입)에 대해 합산 후 1회 업서트
    select
      f.recognition_key, f.year, f.grade, f.class_no, f.student_no, f.exercise_type, f.month,
      count(*) as n,
      sum(coalesce(f.d, 0))  as sum_d,
      sum(coalesce(f.a, 0))  as sum_a,
      sum(coalesce(f.b, 0))  as sum_b,
      sum(coalesce(f.mb, 0)) as sum_mb,
      sum(coalesce(f.c, 0))  as sum_c
    from filtered f
    group by f.recognition_key, f.year, f.grade, f.class_no, f.student_no, f.exercise_type, f.month
  ),
  resolved as (
    select
      st.id as student_id,
      k.year, k.month, k.exercise_type,
      k.n, k.sum_d, k.sum_a, k.sum_b, k.sum_mb, k.sum_c
    from keyed k
    join public.schools s on s.recognition_key = k.recognition_key
    join public.students st
      on st.school_id = s.id
     and st.year = k.year
     and st.grade = k.grade
     and st.class_no = k.class_no
     and st.student_no = k.student_no
  ),
  upserted as (
    insert into public.exercise_records as er (
      student_id, exercise_type, year, month,
      avg_duration_seconds, avg_accuracy, avg_bpm, avg_max_bpm, avg_calories,
      record_count
    )
    select
      r.student_id, r.exercise_type, r.year, r.month,
      case when r.n > 0 then r.sum_d / r.n else null end,
      case when r.n > 0 then r.sum_a / r.n else null end,
      case when r.n > 0 then r.sum_b / r.n else null end,
      case when r.n > 0 then r.sum_mb / r.n else null end,
      case when r.n > 0 then r.sum_c / r.n else null end,
      r.n
    from resolved r
    on conflict (student_id, year, month, exercise_type)
    do update set
      avg_duration_seconds = case
        when excluded.avg_duration_seconds is null then er.avg_duration_seconds
        else ((coalesce(er.avg_duration_seconds,0) * er.record_count) + (excluded.avg_duration_seconds * excluded.record_count))
             / (er.record_count + excluded.record_count)
      end,
      avg_accuracy = case
        when excluded.avg_accuracy is null then er.avg_accuracy
        else ((coalesce(er.avg_accuracy,0) * er.record_count) + (excluded.avg_accuracy * excluded.record_count))
             / (er.record_count + excluded.record_count)
      end,
      avg_bpm = case
        when excluded.avg_bpm is null then er.avg_bpm
        else ((coalesce(er.avg_bpm,0) * er.record_count) + (excluded.avg_bpm * excluded.record_count))
             / (er.record_count + excluded.record_count)
      end,
      avg_max_bpm = case
        when excluded.avg_max_bpm is null then er.avg_max_bpm
        else ((coalesce(er.avg_max_bpm,0) * er.record_count) + (excluded.avg_max_bpm * excluded.record_count))
             / (er.record_count + excluded.record_count)
      end,
      avg_calories = case
        when excluded.avg_calories is null then er.avg_calories
        else ((coalesce(er.avg_calories,0) * er.record_count) + (excluded.avg_calories * excluded.record_count))
             / (er.record_count + excluded.record_count)
      end,
      record_count = er.record_count + excluded.record_count,
      updated_at = now()
    returning 1
  )
  select count(*) into v_rows from upserted;

  return v_rows;
end
$$;

grant execute on function public.upsert_exercise_records_batch(jsonb) to anon, authenticated, service_role;

-- PostgREST 스키마 리로드
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;


