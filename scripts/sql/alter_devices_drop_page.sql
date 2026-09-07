-- devices.page(운영툴 메뉴 표시) 컬럼 제거
-- 이미 없으면 무시
alter table public.devices
  drop column if exists page;

do $$ begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then null;
end $$;











