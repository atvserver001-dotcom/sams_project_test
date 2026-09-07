## 스키마 동기화 준비 리포트
- schema: `public`
- generated_at: `2025-12-26T05:12:44.711Z`
- mode: **준비만(DDL 생성), PROD에 실행하지 않음**

### PROD에 없는 테이블(생성 필요)
- `public.classes`
- `public.content_devices`
- `public.contents`
- `public.grades`
- `public.permission_logs`
- `public.school_contents`
- `public.school_devices`
- `public.user_profiles`

### 컬럼 차이(추가만 자동 생성)
- `public.devices`: +1 columns

### 제약조건 차이(이름 기준, 일부 자동 생성)
### 인덱스 차이(이름 기준, CREATE INDEX 자동 생성)
- missing indexes: 13

### 주의/수동 확인 필요
- PROD에 없는 테이블 8개가 있습니다. 이 스크립트는 안전을 위해 CREATE TABLE을 자동 생성하지 않습니다(수동/pg_dump 기반 추천).
- 제약조건 2200_17539_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17539_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17539_3_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17539_5_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- FK classes_grade_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- 제약조건 2200_17744_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17744_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- FK content_devices_content_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- FK content_devices_device_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- 제약조건 2200_17734_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17734_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17734_6_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17734_7_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17508_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17508_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17508_3_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17508_6_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17508_7_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17499_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17499_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17640_10_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17640_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17640_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17640_3_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17640_4_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17640_5_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17640_6_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17640_7_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17640_8_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17640_9_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17620_11_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17620_12_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17620_13_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17620_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17620_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17620_3_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17620_4_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17620_5_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17527_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17527_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17527_3_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17527_4_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17527_5_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- FK grades_school_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- 제약조건 2200_17601_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17601_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17601_3_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17601_4_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17601_6_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17650_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17650_3_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17650_4_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17650_5_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17650_6_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 permission_logs_action_check (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- FK permission_logs_grantee_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- FK permission_logs_grantor_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- 제약조건 2200_17759_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- FK school_contents_content_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- FK school_contents_school_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- 제약조건 2200_17777_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17777_4_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- FK school_devices_device_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- FK school_devices_school_content_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- 제약조건 2200_17486_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17486_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17486_3_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17486_4_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17486_5_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17486_6_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17553_14_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17553_15_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17553_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17553_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17553_3_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17553_4_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17553_5_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17553_6_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17553_7_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17574_11_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17574_12_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17574_13_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17574_1_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17574_2_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17574_3_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- 제약조건 2200_17574_4_not_null (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- FK user_profiles_class_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.
- FK user_profiles_id_fkey의 참조 테이블 정보를 찾지 못해 자동 생성 불가.
- 제약조건 user_profiles_role_check (CHECK)는 자동 생성 대상에서 제외(수동 확인 필요).
- FK user_profiles_school_id_fkey: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.

### 생성 파일
- `scripts\sql\generated\prepare_prod_from_test_public.sql`
- `scripts\sql\generated\prepare_prod_from_test_public_report.md`