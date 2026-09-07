do $$
declare
  v_group_no text := '9001';
  v_school_name text := '테스트초등학교';
  v_school_type int := 1; -- 1:초/2:중/3:고
  v_recognition_key text := 'TEST-9001';
  v_school_id uuid;
  v_year smallint := extract(year from current_date)::int; -- 운동 기록 대상 연도
  v_grade smallint := 1;  -- 학년
  v_class_no smallint := 1; -- 반
begin
  -- 1) 학교 확보(없으면 생성)
  select id into v_school_id from public.schools where group_no = v_group_no limit 1;
  if v_school_id is null then
    insert into public.schools (group_no, name, school_type, recognition_key)
    values (v_group_no, v_school_name, v_school_type, v_recognition_key)
    returning id into v_school_id;
  end if;

  -- 2) 학생 20명 생성(이미 있으면 건너뜀)
  insert into public.students (
    school_id, year, grade, class_no, student_no,
    name, gender, birth_date, email, height_cm, weight_kg, notes
  )
  select
    v_school_id,
    extract(year from current_date)::int,
    v_grade,
    v_class_no,
    gs as student_no,
    lpad(gs::text, 2, '0') || '번 학생' as name,
    (case when random() < 0.5 then 'M' else 'F' end) as gender,
    (date '2013-03-01' + (random()*365*3)::int) as birth_date,
    null::text as email,
    round((140 + random()*30)::numeric, 1) as height_cm,
    round((35 + random()*20)::numeric, 1) as weight_kg,
    null::text as notes
  from generate_series(1, 20) as gs
  where not exists (
    select 1 from public.students s
    where s.school_id = v_school_id
      and s.year = extract(year from current_date)::int
      and s.grade = v_grade
      and s.class_no = v_class_no
      and s.student_no = gs
  );

  -- 3) 대상 학생 목록(20명 한정)
  with studs as (
    select s.id as student_id, s.weight_kg::numeric as weight_kg
    from public.students s
    where s.school_id = v_school_id and s.grade = v_grade and s.class_no = v_class_no
    order by s.student_no
    limit 20
  ),
  types as (
    -- exercise_type 매핑: 1=strength, 2=endurance, 3=flexibility 에 대응
    select 'strength'::text as exercise_type, 1.0 as base
    union all select 'endurance', 1.2
    union all select 'flexibility', 0.6
  ),
  month_vals as (
    -- 월별 운동시간(분) 시드값 생성
    select
      st.student_id,
      t.exercise_type,
      array[
        nullif(round((10 + (random()*20) * t.base)::numeric,0), 0),
        nullif(round((15 + (random()*25) * t.base)::numeric,0), 0),
        round((20 + (random()*30) * t.base)::numeric,0),
        round((25 + (random()*30) * t.base)::numeric,0),
        round((30 + (random()*35) * t.base)::numeric,0),
        round((30 + (random()*35) * t.base)::numeric,0),
        round((20 + (random()*30) * t.base)::numeric,0),
        round((20 + (random()*30) * t.base)::numeric,0),
        round((15 + (random()*25) * t.base)::numeric,0),
        round((15 + (random()*25) * t.base)::numeric,0),
        nullif(round((10 + (random()*20) * t.base)::numeric,0), 0),
        nullif(round((10 + (random()*20) * t.base)::numeric,0), 0)
      ] as mins
    from studs st
    cross join types t
  ),
  bpm_vals as (
    select
      m.student_id,
      m.exercise_type,
      array[
        110 + (random()*10)::int,
        112 + (random()*10)::int,
        115 + (random()*10)::int,
        118 + (random()*10)::int,
        120 + (random()*10)::int,
        122 + (random()*10)::int,
        118 + (random()*10)::int,
        118 + (random()*10)::int,
        116 + (random()*10)::int,
        114 + (random()*10)::int,
        112 + (random()*10)::int,
        110 + (random()*10)::int
      ]::numeric[] as avg_bpm,
      array[
        140 + (random()*15)::int,
        142 + (random()*15)::int,
        145 + (random()*15)::int,
        148 + (random()*15)::int,
        150 + (random()*15)::int,
        152 + (random()*15)::int,
        148 + (random()*15)::int,
        148 + (random()*15)::int,
        146 + (random()*15)::int,
        144 + (random()*15)::int,
        142 + (random()*15)::int,
        140 + (random()*15)::int
      ]::numeric[] as max_bpm
    from month_vals m
  ),
  acc_vals as (
    select
      m.student_id,
      m.exercise_type,
      array[
        85 + (random()*10)::int,
        86 + (random()*10)::int,
        87 + (random()*10)::int,
        88 + (random()*10)::int,
        89 + (random()*10)::int,
        90 + (random()*10)::int,
        89 + (random()*10)::int,
        89 + (random()*10)::int,
        88 + (random()*10)::int,
        87 + (random()*10)::int,
        86 + (random()*10)::int,
        85 + (random()*10)::int
      ]::numeric[] as accuracy
    from month_vals m
  ),
  kcals as (
    select
      m.student_id,
      m.exercise_type,
      array[
        round((coalesce(m.mins[1],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[2],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[3],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[4],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[5],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[6],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[7],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[8],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[9],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[10],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[11],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1),
        round((coalesce(m.mins[12],0) * (case when m.exercise_type='strength' then 6.0 when m.exercise_type='endurance' then 8.0 else 2.5 end) * 3.5 * 50) / 200, 1)
      ]::numeric[] as kcals
    from month_vals m
  )
  insert into public.exercise_records (
    student_id, exercise_type, year, month,
    avg_duration_seconds, avg_accuracy, avg_bpm, avg_max_bpm, avg_calories, record_count
  )
  select
    m.student_id,
    m.exercise_type,
    v_year,
    gs as month,
    case when m.mins[gs] is null then null else (m.mins[gs]::numeric * 60) end as avg_duration_seconds,
    a.accuracy[gs] as avg_accuracy,
    b.avg_bpm[gs] as avg_bpm,
    b.max_bpm[gs] as avg_max_bpm,
    k.kcals[gs] as avg_calories,
    (1 + (random()*3)::int) as record_count
  from month_vals m
  join bpm_vals b on b.student_id = m.student_id and b.exercise_type = m.exercise_type
  join acc_vals a on a.student_id = m.student_id and a.exercise_type = m.exercise_type
  join kcals k on k.student_id = m.student_id and k.exercise_type = m.exercise_type
  cross join generate_series(1,12) as gs
  where not exists (
    select 1
    from public.exercise_records er
    where er.student_id = m.student_id and er.year = v_year and er.month = gs and er.exercise_type = m.exercise_type
  );
end $$;


