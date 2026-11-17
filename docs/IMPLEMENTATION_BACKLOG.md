# 구현 백로그 (Phase 0 → Phase 1)

기준: `docs/DEVELOPMENT_PLAN.md` v1.4 (§20~§24 우선). 각 항목은 **변경 범위 · 테스트 · 완료 기준**을 가진다.
상태: ✅ 완료(테스트 통과) · 🟡 부분 · ⬜ 미착수

## Phase 0 — 기초/계약

| ID | 작업 | 범위 | 테스트 | 상태 |
|---|---|---|---|---|
| 0.1 | 저장소 점검, npm workspaces 구성 (web/api/shared/game-engine/content) | 루트 설정 | `npm run typecheck` | ✅ |
| 0.2 | typecheck / lint / test / build / format 스크립트, `Math.random`·`eval` 린트 금지 | 루트 | 모든 명령 exit 0 | ✅ |
| 0.3 | 시드 RNG(uint32 직렬화, 목적별 파생 스트림) | `game-engine/rng.ts` | `rng.test.ts` | ✅ |
| 0.4 | 턴 상태 머신(§23.3 전이표) | `game-engine/state-machine.ts` | `run.test.ts` | ✅ |
| 0.5 | `GameRunState`·이벤트 `conditions`/`effects[]`·콘텐츠 Zod 스키마 | `shared/*-schema.ts` | `event-schema.test.ts` (유효/무효) | ✅ |
| 0.6 | 콘텐츠 참조 검증(ID 존재, 극성, 비활성 특성, 후속 루프, 폴백, 전이 경로) | `content/validate.ts` | `content.test.ts`, `npm run validate:content` | ✅ |
| 0.7 | README, `.env.example`, 데이터 모델 초안 | 문서 | — | ✅ |

## Phase 1 — 수직 슬라이스

| ID | 작업 | 범위 | 테스트 | 상태 |
|---|---|---|---|---|
| 1.1 | 이름·성별 검증 → 카드 3장 생성/서버 고정 (`POST /api/runs`) | shared/profile, engine/characters·run, api | profile/run/app 테스트 | ✅ |
| 1.2 | 카드 선택 (`POST /character`, 서버 발급 cardId만, idempotency·revision) | engine/run, api | run/app 테스트 | ✅ |
| 1.3 | 지원 카드 3장(정확한 합격률, 3번째 F~D, 4회 연속 불합격 시 추천) + 채용 판정 | engine/jobs, api | run/app 테스트 | ✅ |
| 1.4 | 입사 시 상사 1·동료 2 시드 생성, 팀 재사용, 저장/재접속 유지 | engine/npcs, api | npcs/app 테스트 | ✅ |
| 1.5 | 이벤트 판정 엔진: 조건·확률(치환형 레벨 보너스)·효과 원자 적용·조건부 효과 | engine/conditions·chance·effects·events | traits 테스트 | ✅ |
| 1.6 | 긍정 3종 획득/강화, 부정 2종 부여/악화/완화/제거 이벤트 데이터 | content/events.json | traits 테스트 | ✅ |
| 1.7 | NPC 이벤트 연동 최소(참여자 바인딩, 성향 가중치, 관계 조건·보정·변화, NPC 플래그) | engine/events·effects, content | traits 테스트 | ✅ |
| 1.8 | 모바일 웹: 시작 → 이름/성별 → 카드 선택 → 지원 → 팀 화면 | apps/web | 수동 스모크(HTTP) | 🟡 브라우저 육안 검증 전 |
| 1.9 | 월간 진행 엔진 + API (`start-month`/`choose`/`next-month`/`current-event`/`result`) | engine/month.ts, api | ending/app 테스트 | ✅ (이벤트 화면은 1.16) |
| 1.10 | 월간 정산: 세후 급여(간략), 생활비, 부채 이자 0.5%, 현금 부족분 → 부채, 자연 회복 | engine, content/rules | 정산 테스트 | ✅ |
| 1.11 | 12월 평가 / 1월 연봉 조정 (체크포인트로 1회 보장) | engine | §20.3 수용 테스트 1·2 | ⬜ |
| 1.12 | 예약 이벤트 처리(dueTurn·priority·maxDelayMonths=3), 플래그 만료 | engine | 예약/만료 테스트 | 🟡 엔진 처리만, 예약 콘텐츠 없음 |
| ~~1.13~~ | ~~실업 월 진행~~ — §26으로 대체 | — | — | 삭제 |
| 1.17 | §26 실직 게임오버·엔딩(자원 0·부채 한계·이벤트 실직·조기 은퇴·정년), 경고, 첫 구직 보장 | engine/ending·jobs·view, content | §26.7 테스트 | ✅ 검수 ② 대기 |
| 1.18 | 자동 플레이 시뮬레이터 (`npm run simulate -w @company-life/game-engine -- 1000`) | engine/simulation | 진행 불능 0건 테스트 | ✅ |
| 1.19 | 밸런스 조정 (구조조정 편중, 이른 실패) | content/rules·events | 시뮬레이션 | ⬜ 검수 결정 후 |
| 1.14 | 상사 교체 규칙(플레이어 ≥ 상사 직급 시 FORMER_BOSS + 별도 스트림 생성) | engine/npcs | NPC 교체 테스트 | ⬜ |
| 1.15 | 이벤트 팩 18개 이상, 직무 특화 3개, 부정 특성 2번째 극복 루트 | content | 콘텐츠 검증 | 🟡 19개 (직무 특화 0) |
| 1.16 | 화면: 이벤트·월말 요약·경고 배너·엔딩 (검수 ③) | web | 사용자 플레이테스트 (`docs/PLAYTEST.md`) | 🟡 구현 완료, 사용자 검수 대기 |
| 1.20 | 플레이테스트 도구 (`npm run playtest`): 상태 조정·사건 강제·정확한 확률/숨김 정보, 조작 run 표시 | api/engine/web | playtest 테스트 | ✅ |

## 결정 대기 (사용자)
- 금칙어 목록(현재 `content/data/policy.json`은 자리표시용), 게스트 토큰 저장 방식(현재 헤더 `x-guest-token` + localStorage; httpOnly 쿠키로 전환할지)
- PostgreSQL 도입 시점과 ORM(Prisma/Drizzle)
- 초기 탐색 단계(JOB_OFFERS)에서 불합격 시 턴을 진행할지 (현재: 턴 진행 없음, 정신력 -5, 새 카드)
