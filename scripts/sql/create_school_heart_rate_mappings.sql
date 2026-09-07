-- 학교별 심박계 ID 매핑 테이블
-- 1~30번 학생에 대한 심박계 디바이스 ID를 저장

CREATE TABLE IF NOT EXISTS school_heart_rate_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_no INTEGER NOT NULL CHECK (student_no >= 1 AND student_no <= 30),
  device_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, student_no)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_school_heart_rate_mappings_school_id 
  ON school_heart_rate_mappings(school_id);

-- 업데이트 시간 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_school_heart_rate_mappings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_school_heart_rate_mappings_updated_at
  BEFORE UPDATE ON school_heart_rate_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_school_heart_rate_mappings_updated_at();

-- PostgREST(Supabase API) 스키마 캐시 리로드
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
