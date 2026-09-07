-- 멱등 이벤트 기록 테이블: 동일 이벤트 중복 처리 방지
create table if not exists public.exercise_ingest_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  recognition_key text not null,
  year smallint not null,
  grade smallint not null,
  class_no smallint not null,
  student_no smallint not null,
  exercise_type text not null,
  month smallint not null,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_ingest_idem_scope
on public.exercise_ingest_events (
  idempotency_key, recognition_key, year, grade, class_no, student_no, exercise_type, month
);

-- PostgREST 스키마 리로드
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;


