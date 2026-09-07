-- 운동기록관리 테이블 (exercise_records)
-- 새로운 요구사항:
-- id, student_id, exercise_type, year, month,
-- avg_duration_seconds, avg_accuracy, avg_bpm, avg_max_bpm, avg_calories, record_count

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'exercise_records'
  ) then
    execute 'drop table if exists public.exercise_records cascade';
  end if;
exception when others then
  null;
end $$;

create table public.exercise_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  exercise_type text not null check (exercise_type in ('endurance','flexibility','strength')),
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  avg_duration_seconds numeric,
  avg_accuracy numeric,
  avg_bpm numeric,
  avg_max_bpm numeric,
  avg_calories numeric,
  record_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.exercise_records is '학생 운동 기록(월별 집계) 테이블';
comment on column public.exercise_records.student_id is '학생 식별자 (uuid)';
comment on column public.exercise_records.exercise_type is '운동 유형(endurance, flexibility, strength)';
comment on column public.exercise_records.year is '년도 (int2)';
comment on column public.exercise_records.month is '월 (1-12)';
comment on column public.exercise_records.avg_duration_seconds is '평균 운동시간(초)';
comment on column public.exercise_records.avg_accuracy is '평균 정확도(%)';
comment on column public.exercise_records.avg_bpm is '평균 심박수(bpm)';
comment on column public.exercise_records.avg_max_bpm is '최대 심박수(bpm, 평균)';
comment on column public.exercise_records.avg_calories is '평균 칼로리(kcal)';
comment on column public.exercise_records.record_count is '해당 월 기록 건수';
comment on column public.exercise_records.created_at is '생성일시';
comment on column public.exercise_records.updated_at is '수정일시';

-- 유니크 및 조회 인덱스
create unique index if not exists ux_exrec_student_year_month_type
  on public.exercise_records(student_id, year, month, exercise_type);

create index if not exists idx_exrec_student_year
  on public.exercise_records(student_id, year);

-- PostgREST(Supabase API) 스키마 캐시 리로드
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;

