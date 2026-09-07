-- exercise_records.student_id FK를 ON DELETE CASCADE로 변경
-- 참고: 기존 FK 이름은 Supabase가 자동으로 생성했을 수 있으므로, 먼저 FK 제약을 조회 후 드롭/재생성

do $$
declare
  fk_name text;
begin
  select tc.constraint_name into fk_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'exercise_records'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'student_id'
  limit 1;

  if fk_name is not null then
    execute format('alter table public.exercise_records drop constraint %I', fk_name);
  end if;

  execute 'alter table public.exercise_records
            add constraint exercise_records_student_id_fkey
            foreign key (student_id)
            references public.students(id)
            on delete cascade';
exception when others then
  -- 로컬/CI 환경에서 제약이 없거나 이미 원하는 상태일 수 있으므로 무해화
  null;
end $$;

-- PostgREST(Supabase API) 스키마 캐시 리로드
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;


