-- ==========================================================
-- School Device Pages (커스텀/이미지 페이지) + Blocks
-- 목적: SchoolSettingsPage UI 설정을 DB에 저장/불러오기 (테스트 DB 연동)
-- 생성일: 2026-01-07
-- ==========================================================

-- 전제: public.set_updated_at() 트리거 함수가 존재해야 합니다.
-- full_schema.sql 에 이미 정의되어 있음.

create table if not exists public.school_device_pages (
  id uuid primary key default gen_random_uuid(),
  school_device_id uuid not null references public.school_devices(id) on delete cascade,
  kind text not null check (kind in ('custom','images')),
  name text not null,
  sort_order integer not null default 1,

  -- images 페이지 전용(1장 유지): Storage 경로/표시명
  image_name text,
  image_original_path text,
  image_thumb_path text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_school_device_pages_school_device_id on public.school_device_pages(school_device_id);
create index if not exists idx_school_device_pages_sort on public.school_device_pages(school_device_id, sort_order);

create trigger trg_school_device_pages_set_updated_at
before update on public.school_device_pages
for each row execute procedure public.set_updated_at();

create table if not exists public.school_device_page_blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.school_device_pages(id) on delete cascade,
  type text not null check (type in ('text','image')),
  subtitle text,
  body text,
  sort_order integer not null default 1,

  -- (추후 확장) 커스텀 이미지 블록용: Storage 경로/표시명
  image_name text,
  image_original_path text,
  image_thumb_path text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_school_device_page_blocks_page_id on public.school_device_page_blocks(page_id);
create index if not exists idx_school_device_page_blocks_sort on public.school_device_page_blocks(page_id, sort_order);

create trigger trg_school_device_page_blocks_set_updated_at
before update on public.school_device_page_blocks
for each row execute procedure public.set_updated_at();

-- 캐시 리로드 (Supabase)
do $$ begin perform pg_notify('pgrst', 'reload schema'); exception when others then null; end $$;


