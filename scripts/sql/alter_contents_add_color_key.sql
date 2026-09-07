-- 컨텐츠 색상(HEX) 선택 기능을 위한 컬럼 추가
-- 이미 컬럼이 있으면 무시
alter table public.contents
  add column if not exists color_hex text not null default '#DBEAFE';

do $$ begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then null;
end $$;


