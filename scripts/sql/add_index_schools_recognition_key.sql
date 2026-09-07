-- schools.recognition_key 유니크 인덱스 (빠른 조회 및 무결성 강화)
create unique index if not exists ux_schools_recognition_key
  on public.schools(recognition_key);

-- PostgREST(Supabase API) 스키마 캐시 리로드
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception when others then
  null;
end $$;


