## 목적

테스트(TEST) 프로젝트의 **테이블 구조(public 스키마)** 를 기준으로,
실서버(PROD)에 적용할 **DDL(SQL) 초안**을 생성합니다.

중요: 이 과정은 **"준비(생성)만"** 수행하며, **PROD에 직접 실행하지 않습니다.**

## 준비물

- Node.js
- `npm i` (이미 `pg` 의존성 포함)

## 환경변수 파일 만들기

예시 파일을 복사해서 `.env.supabase.schema-sync` 를 만드세요:

```bash
cp scripts/env/supabase.schema-sync.env.example .env.supabase.schema-sync
```

`.env.supabase.schema-sync`에 아래 2개를 채웁니다:

- `TEST_DB_URL`
- `PROD_DB_URL`

### DB URL 얻는 위치

각 Supabase 프로젝트 대시보드에서 상단 **Connect** 버튼을 눌러 connection string을 복사하고,
`[YOUR-PASSWORD]` 자리에 DB 비밀번호를 넣어 사용합니다.

문서 참고: `https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore`

> Windows/회사망에서 `db.<project-ref>.supabase.co` (Direct)가 IPv6-only면 접속 실패할 수 있으니,
> Connect에서 **Session pooler** 문자열을 쓰는 걸 권장합니다.

## 실행(DDL 생성)

```bash
npm run supabase:prepare-prod-schema-from-test
```

생성되는 파일(기본):

- `scripts/sql/generated/prepare_prod_from_test_public.sql`
- `scripts/sql/generated/prepare_prod_from_test_public_report.md`

## 생성 SQL의 특징(안전 기본값)

- 기본으로 `BEGIN; ... ROLLBACK;` 형태로 생성됩니다. (즉, **그대로 실행해도 적용되지 않게**)
- 자동 생성 대상:
  - PROD에 없는 컬럼 → `ALTER TABLE ... ADD COLUMN ...`
  - PROD에 없는 인덱스(이름 기준) → `CREATE INDEX ...`
  - PROD에 없는 PK/UNIQUE/FK(이름 기준) → `ALTER TABLE ... ADD CONSTRAINT ...`
- 자동 생성하지 않는 것(리포트에만 표시):
  - PROD에 없는 테이블 전체 `CREATE TABLE` (안전/정확성 위해 수동/pg_dump 기반 권장)
  - 컬럼 타입 변경, 컬럼 삭제, 제약/인덱스 삭제 등 파괴적 변경
  - 복합 FK 등 복잡한 참조 매핑(적용 전 SQL 검토 필요)

## 다음 단계(당신 요청 범위 밖: 실제 적용)

원하면, 생성된 SQL을 검토한 뒤 **안전하게 PROD에 적용하는 절차**(백업, 트랜잭션, 단계적 적용)도 이어서 잡아드릴 수 있어요.







