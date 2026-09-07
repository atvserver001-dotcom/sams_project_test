-- devices 테이블에 아이콘 경로 컬럼 추가
alter table if exists public.devices
  add column if not exists icon_path text;










