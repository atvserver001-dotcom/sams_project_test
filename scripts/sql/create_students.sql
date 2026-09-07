-- 컬럼: id, school_id, grade, class_no, student_no, name, gender, birth_date, email, height_cm, weight_kg, notes

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  -- 학년도(예: 2025). 3~12월은 해당 연도, 1~2월은 이전 연도
  year smallint not null default (
    case when extract(month from current_date) in (1,2)
      then extract(year from current_date)::int - 1
      else extract(year from current_date)::int
    end
  ),
  grade smallint not null check (grade >= 1 and grade <= 6),
  class_no smallint not null check (class_no >= 1 and class_no <= 20),
  student_no smallint not null check (student_no >= 1 and student_no <= 50),
  name text not null,
  gender text check (gender in ('M','F')),
  birth_date date,
  email text,
  height_cm numeric,
  weight_kg numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.students is '학교 학생 기본 정보';
comment on column public.students.school_id is '학교 PK (uuid)';
comment on column public.students.year is '학년도(3~12월=당해연도, 1~2월=전년도)';
comment on column public.students.grade is '학년(1-12)';
comment on column public.students.class_no is '학반(숫자)';
comment on column public.students.student_no is '학번(반 내 번호)';
comment on column public.students.name is '이름';
comment on column public.students.gender is '성별(M/F)';
comment on column public.students.birth_date is '생년월일(YYYY-MM-DD)';
comment on column public.students.email is '이메일';
comment on column public.students.height_cm is '키(cm)';
comment on column public.students.weight_kg is '몸무게(kg)';
comment on column public.students.notes is '특이사항';

-- 학교/학년도 내 동일 학급-학번 중복 방지
create unique index if not exists idx_students_school_year_grade_classno_studentno
  on public.students(school_id, year, grade, class_no, student_no);

-- 조회 인덱스
create index if not exists idx_students_school on public.students(school_id);
create index if not exists idx_students_year on public.students(year);
create index if not exists idx_students_year_studentno on public.students(year, student_no);
create index if not exists idx_students_name on public.students(name);

-- updated_at 자동 갱신 트리거
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_students_set_updated_at on public.students;
create trigger trg_students_set_updated_at
before update on public.students
for each row execute procedure public.set_updated_at();

-- PostgREST 스키마 리로드
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;


