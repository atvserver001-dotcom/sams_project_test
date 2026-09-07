# ATVCMS 개발서버 디자인 통합본

2026-09-06 개발서버에 적용된 학교·관리자 UI와 보존된 기능 코드입니다. 2026-09-07 사용자의 요청에 따라 현재 배포본 기준으로 Git 인계를 준비했습니다. 운영 서버 승인본이 아닙니다.

- 확인 주소: https://sams-project-test.vercel.app
- 배포 ID: `dpl_FaWTNePWAb6NcTZkeSa23xtBeJxJ`
- 기준 및 제한: [개발자 인계](docs/DEVELOPER-HANDOFF.md)
- 소스 증거: [배포 파일 목록과 SHA-256](docs/releases/2026-09-06-deployed-source-manifest.json)

## 실행

Node.js 22와 저장된 잠금 파일을 사용합니다.

```sh
npm ci
npm test
npx tsc --noEmit
npm run school:preview
```

학교 합성 데이터 미리보기는 기본 `http://127.0.0.1:18475`, 관리자 미리보기는 `npm run admin:preview`로 실행합니다. 미리보기 전용 계정은 각각 `preview_teacher` / `preview-only`, `preview_admin` / `preview-only`입니다. 실제 학교 로그인 계정이 아닙니다.

실제 API 연결은 승인된 개발 환경 설정을 별도로 전달받은 후 `npm run dev`로 실행합니다. 비밀 값은 저장소에 넣지 않습니다. `vercel.json`의 배포 사전 검사는 지정 개발 프로젝트와 개발 DB만 허용합니다. 다른 서버에 배포하기 위해 이 검사를 임의로 제거하지 않습니다.

## 확인 범위

이번 Git 인계 복사본에서 기본 Vitest 187개, 메뉴·합성 미리보기·운동기록 Node 테스트 115개 및 TypeScript 검사를 통과했습니다. 실제 기기 측정과 운영 성능 검증은 별도입니다.

과거 그래프 실험용 `tests/chart-lab/fixtures.test.cjs`는 현재 통합본의 심박 등급 방식과 달라 20개 중 10개가 실패합니다. 원래 배포 작업 폴더와 Git 인계 복사본에서 동일하게 재현했습니다. 이번 푸시를 위해 계산 로직이나 테스트 기대값을 바꾸지 않았으며, 전체 테스트가 통과한 운영 릴리스로 해석하면 안 됩니다.

`npm run test:charts`의 시각 기준 이미지와 승인 기록은 별도 검수 자료입니다. 공개 저장소에는 실제 학교 화면 캡처·측정 데이터·로컬 작업 로그를 새로 포함하지 않았습니다. 기준 이미지가 없는 상태의 시각 검사를 통과로 간주하지 않습니다.
