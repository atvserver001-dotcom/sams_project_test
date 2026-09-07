## 목적

Supabase **실서버(PROD)** 의 `public` 스키마에 있는 **함수/프로시저 + 트리거**를
**테스트(TEST)** 프로젝트로 **테이블 구조 변경 없이** 동일하게 적용합니다.

두 프로젝트 계정이 달라도 상관 없고, 각 프로젝트의 **DB URL(비밀번호 포함)** 만 있으면 됩니다.

## 준비물

- Node.js (이미 설치되어 있음)
- 의존성 설치:

```bash
npm i
```

> 동기화 스크립트는 `pg` 패키지를 사용합니다.

## 1) 환경변수 설정

예시 파일을 복사해서 `.env.supabase.sync` 를 만드세요:

```bash
cp scripts/env/supabase.sync.env.example .env.supabase.sync
```

`.env.supabase.sync`에 아래 2개를 채웁니다:

- `PROD_DB_URL`
- `TEST_DB_URL`

### DB URL 얻는 위치

각 Supabase 프로젝트 대시보드에서 상단 **Connect** 버튼을 눌러 connection string을 복사하고,
`[YOUR-PASSWORD]` 자리에 DB 비밀번호를 넣어 사용합니다.

문서 참고: `https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore`

> Windows/회사망 환경에서는 `db.<project-ref>.supabase.co` (Direct)가 **IPv6-only** 인 경우가 있어
> Node에서 `ENOTFOUND`로 실패할 수 있습니다. 이때는 Connect 화면에서 **Session pooler** 문자열을 쓰는 게 가장 안정적입니다.

## 2) (권장) 먼저 DRY RUN으로 SQL 생성만 확인

```bash
DRY_RUN=1 node scripts/supabase-sync-functions-triggers.js
```

생성 파일:

- `scripts/sql/generated/prod_public_functions.sql`
- `scripts/sql/generated/prod_public_triggers.sql`
- `scripts/sql/generated/prod_public_functions_and_triggers.sql`

## 3) 테스트 DB에 적용

```bash
DRY_RUN=0 node scripts/supabase-sync-functions-triggers.js
```

적용 순서:

- functions/procedures 적용
- triggers는 `DROP TRIGGER IF EXISTS` 후 재생성

## 주의사항(실패 원인 TOP)

- **확장(extensions)**: 함수가 `pgcrypto`, `uuid-ossp` 같은 확장에 의존하면 테스트 프로젝트에도 동일 확장이 필요합니다.
- **권한**: `SECURITY DEFINER`/특정 role 소유권에 의존하는 함수는 테스트 프로젝트 role 구성에 따라 에러가 날 수 있습니다.
- **참조 객체**: 함수가 참조하는 테이블/컬럼/타입이 테스트에도 동일해야 합니다.


