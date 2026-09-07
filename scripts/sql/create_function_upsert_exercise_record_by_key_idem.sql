-- 단건 업서트 + 멱등 처리 함수
create or replace function public.upsert_exercise_record_by_key_idem(
  p_idempotency_key        text,
  p_recognition_key        text,
  p_year                   smallint,
  p_grade                  smallint,
  p_class_no               smallint,
  p_student_no             smallint,
  p_exercise_type          text,
  p_month                  smallint,
  p_avg_duration_seconds   numeric,
  p_avg_accuracy           numeric,
  p_avg_bpm                numeric,
  p_avg_max_bpm            numeric,
  p_avg_calories           numeric
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id  uuid;
  v_student_id uuid;
  v_inserted   int;
begin
  -- 멱등 체크(학생 범위 포함)
  insert into public.exercise_ingest_events (
    idempotency_key, recognition_key, year, grade, class_no, student_no, exercise_type, month
  ) values (
    p_idempotency_key, p_recognition_key, p_year, p_grade, p_class_no, p_student_no, p_exercise_type, p_month
  )
  on conflict do nothing
  returning 1 into v_inserted;

  if v_inserted is null then
    -- 이미 처리됨
    return false;
  end if;

  -- 학교/학생 해석
  select s.id into v_school_id
  from public.schools s
  where s.recognition_key = p_recognition_key
  limit 1;
  if v_school_id is null then
    raise exception 'invalid recognition_key';
  end if;

  select st.id into v_student_id
  from public.students st
  where st.school_id = v_school_id
    and st.year = p_year
    and st.grade = p_grade
    and st.class_no = p_class_no
    and st.student_no = p_student_no
  limit 1;
  if v_student_id is null then
    raise exception 'student not found';
  end if;

  -- 충돌 안전 업서트(가중 평균)
  insert into public.exercise_records(
    student_id, exercise_type, year, month,
    avg_duration_seconds, avg_accuracy, avg_bpm, avg_max_bpm, avg_calories,
    record_count
  ) values (
    v_student_id, p_exercise_type, p_year, p_month,
    p_avg_duration_seconds, p_avg_accuracy, p_avg_bpm, p_avg_max_bpm, p_avg_calories,
    1
  )
  on conflict (student_id, year, month, exercise_type)
  do update set
    avg_duration_seconds = case
      when excluded.avg_duration_seconds is null then exercise_records.avg_duration_seconds
      else ((coalesce(exercise_records.avg_duration_seconds,0) * exercise_records.record_count)
           + excluded.avg_duration_seconds)
           / (exercise_records.record_count + 1)
    end,
    avg_accuracy = case
      when excluded.avg_accuracy is null then exercise_records.avg_accuracy
      else ((coalesce(exercise_records.avg_accuracy,0) * exercise_records.record_count)
           + excluded.avg_accuracy)
           / (exercise_records.record_count + 1)
    end,
    avg_bpm = case
      when excluded.avg_bpm is null then exercise_records.avg_bpm
      else ((coalesce(exercise_records.avg_bpm,0) * exercise_records.record_count)
           + excluded.avg_bpm)
           / (exercise_records.record_count + 1)
    end,
    avg_max_bpm = case
      when excluded.avg_max_bpm is null then exercise_records.avg_max_bpm
      else ((coalesce(exercise_records.avg_max_bpm,0) * exercise_records.record_count)
           + excluded.avg_max_bpm)
           / (exercise_records.record_count + 1)
    end,
    avg_calories = case
      when excluded.avg_calories is null then exercise_records.avg_calories
      else ((coalesce(exercise_records.avg_calories,0) * exercise_records.record_count)
           + excluded.avg_calories)
           / (exercise_records.record_count + 1)
    end,
    record_count = exercise_records.record_count + 1,
    updated_at = now();

  return true;
end
$$;

grant execute on function public.upsert_exercise_record_by_key_idem(
  text, text, smallint, smallint, smallint, smallint, text, smallint, numeric, numeric, numeric, numeric, numeric
) to anon, authenticated, service_role;

-- PostgREST 스키마 리로드
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;


