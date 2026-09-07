-- school_devices 메모 컬럼 추가
-- 이미 있으면 무시
alter table public.school_devices
  add column if not exists memo text;

do $$ begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then null;
end $$;











