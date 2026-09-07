-- 심박수 기록관리 테이블 (heart_rate_records)
-- 월별 집계 데이터 저장
-- student_id, year, month 단위로 최고/평균/최저 심박수 저장
-- 같은 월에 데이터가 추가되면 평균값으로 계산

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'heart_rate_records'
  ) then
    execute 'drop table if exists public.heart_rate_records cascade';
  end if;
exception when others then
  null;
end $$;

create table public.heart_rate_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  avg_bpm numeric,
  max_bpm numeric,
  min_bpm numeric,
  record_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.heart_rate_records is '학생 심박수 기록(월별 집계) 테이블';
comment on column public.heart_rate_records.student_id is '학생 식별자 (uuid)';
comment on column public.heart_rate_records.year is '년도 (int2)';
comment on column public.heart_rate_records.month is '월 (1-12)';
comment on column public.heart_rate_records.avg_bpm is '평균 심박수(bpm)';
comment on column public.heart_rate_records.max_bpm is '최고 심박수(bpm)';
comment on column public.heart_rate_records.min_bpm is '최저 심박수(bpm)';
comment on column public.heart_rate_records.record_count is '해당 월 기록 건수';
comment on column public.heart_rate_records.created_at is '생성일시';
comment on column public.heart_rate_records.updated_at is '수정일시';

-- 유니크 및 조회 인덱스
create unique index if not exists ux_hrr_student_year_month
  on public.heart_rate_records(student_id, year, month);

create index if not exists idx_hrr_student_year
  on public.heart_rate_records(student_id, year);

-- PostgREST(Supabase API) 스키마 캐시 리로드
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;
