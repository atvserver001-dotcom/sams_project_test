-- devices 테이블에 운영툴 메뉴 표시 여부(page) 컬럼 추가
-- page = true 이면 학교 운영툴 메뉴에 노출, false 이면 비노출
ALTER TABLE public.devices
ADD COLUMN IF NOT EXISTS page boolean NOT NULL DEFAULT false;


