# Graph Lab Fixtures

Pure synthetic data only. No sensor, API, network, database, timer, or new dependency.
Run from the worktree root: `node --test tests/chart-lab/fixtures.test.cjs`.

## Interface

- `Scenario`: `normal | missing | zero | spike | flat | range | disconnect`.
- `SCENARIOS`: ordered `{ value: Scenario, label: string }[]`, Korean labels.
- `LAB_YEAR = 2025`; `LAB_START = 1757041200000` (`2025-09-05T03:00:00.000Z`).
- `makeMonthlyRows(scenario): ExerciseRow[]`: 30 synthetic students, calendar-indexed 12-month arrays; categories always sum to minutes. Names are `검증 학생 NN`.
- `expectedMonthly(scenario)`: 12 full summary objects in March-February order, including `month`, `index`, `calendarMonth`, `future`, and eight metrics. Independent closed-form arithmetic; does not call the generator or production summary. Compare using `monthlySummary(rows, LAB_YEAR, new Date(2026, 2, 1))`; its fixed oracle marks every month past.
- `sampleAt(scenario, studentNo, sec): number | null`: integer elapsed seconds and student numbers 1..30. `null` skips receipt; sensor `0` is received no-contact, not a measured zero.
- `makeLabSession(scenario, seconds = 120): Session`: seconds is a nonnegative integer count, producing `0..seconds-1`; zero returns an empty session (`lastSec = -1`). Exactly 30 participants, all age 13, unique synthetic device IDs, fixed UUID `20250905-0000-4000-8000-00000000000N` where N is 1..7 in scenario order.
- `advanceLab(session, scenario, throughSec): void`: inclusive integer endpoint, starts at `lastSec + 1`, preserves object/buffer references and ID. Use the session's original scenario. Replaying an elapsed endpoint does nothing. Production `createSession`, `ingestSample`, and `advanceSession` own all session state.

## Scenario Inputs

| Scenario | Monthly | Sensor |
| --- | --- | --- |
| normal | Academic load 1..12, three equal student groups | `110 + (sec + 3 * studentNo) % 41` |
| missing | May and September entirely absent; July absent for every third student | Seconds 20..29 of every minute absent, then recovery |
| zero | All 12 months and all metrics explicitly zero, recorded | Every second receives no-contact zero; no measurements |
| spike | Student 30 in July adds 1,000 minutes split 600/300/100 | 45 at second 15, 220 at second 45 each minute, otherwise 130 |
| flat | 40 minutes, category split 10/20/10, both bpm 130 | Always 130 |
| range | Alternating low/high load, bpm 45/220 and maxima 60/240 | Five-second steps: 30,45,60,104,131,132,158,159,185,186,200,220,240 |
| disconnect | March-August present; September-February absent | Normal through second 59; no receipts from second 60 |

A 60-minute fixture uses 3,600 seconds (0..3599). Every participant retains exactly
3,000 chronological slots (600..3599), including missing slots, while aggregates
and first raw extrema cover the entire session. Tests independently accumulate
measurements, sums, extrema/timestamps, age-13 zone seconds, receipts, and results.

## Session Log 2026-09

### 2026-09-05

- Request/plan: own only fixtures, pure tests, and this note; inspect only production data/session contracts and the existing TypeScript require helper. Keep app and browser work with their owners.
- Implementation: seven deterministic scenarios, consistent monthly categories, a closed-form monthly oracle, 30 synthetic participants, production-driven session construction/advancement, fixed scenario IDs, and no external I/O.
- Review: tests cover academic order, null versus monthly zero versus sensor no-contact, incremental replay/identity, timeout/recovery, default 120 seconds, all seven 60-minute sessions, complete raw aggregates, and the gap-aware 3,000-slot ring. Strict UTF-8 decoding and literal Korean-name checks are included.
- Review correction: standalone strict typing exposed the production constructor's UUID-shaped ID parameter; replaced the initial readable IDs with deterministic valid UUIDs without changing production code.
- Result: fixture tests passed 20/20; combined pure regression passed 50/50 with `node --test tests/chart-lab/fixtures.test.cjs src/lib/heart-rate/tests/session.test.cjs src/components/exercises/exercise-data.test.mjs`. Standalone strict TypeScript checking (`--noEmit --strict --skipLibCheck --target ES2020 --module commonjs --types node --lib ES2020,DOM`) and ESLint passed for owned code. UTF-8 decoding and Korean-name checks passed. Only these three fixture-owned files were edited; app/browser testing remains with its owners.
