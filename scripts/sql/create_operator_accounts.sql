-- operator_accounts 테이블 (Supabase 스키마 기준)

create table if not exists public.operator_accounts (
  id uuid primary key default gen_random_uuid(),
  username varchar not null unique,
  password varchar not null,
  role text not null,
  school_id uuid references public.schools(id),
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.operator_accounts is '운영자 계정';
comment on column public.operator_accounts.role is '권한 역할 (ENUM 대체용 텍스트; 필요 시 타입 정의)';

-- updated_at 자동 갱신 트리거 (선택)
create or replace function public.set_updated_at_operator_accounts()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_operator_accounts_set_updated_at on public.operator_accounts;
create trigger trg_operator_accounts_set_updated_at
before update on public.operator_accounts
for each row execute procedure public.set_updated_at_operator_accounts();

-- PostgREST 스키마 리로드
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;


