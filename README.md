# 오늘도 출근 (코드명 company-life)

모바일 우선 선택지형 직장 로그라이크. 기준 명세: [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md) (v1.4), 진행 현황: [`docs/IMPLEMENTATION_BACKLOG.md`](docs/IMPLEMENTATION_BACKLOG.md).

## 구조

```text
apps/web            React + Vite 모바일 웹 (서버 공개 뷰만 표시)
apps/api            Fastify API (게임 상태·확률의 권위, 소유권/idempotency/revision 검사)
packages/shared     Zod 스키마·타입 (GameRunState, 이벤트 conditions/effects[], 콘텐츠, API DTO)
packages/game-engine 순수 게임 규칙 (시드 RNG, 상태 머신, 카드/채용/NPC/이벤트 판정, 공개 뷰 투영)
packages/content    선언형 콘텐츠 JSON + 로더/참조 검증기
```

## 명령

```bash
npm install
npm run dev:api          # http://127.0.0.1:3001 (로컬 파일 저장소 .data/runs)
npm run dev:web          # http://localhost:5173 (/api → 3001 프록시)
npm run typecheck && npm run lint && npm test && npm run build
npm run validate:content # 콘텐츠 스키마·참조 검증
```

## 데이터 모델 초안 (§23.1)

- **정본 상태**: `GameRunState` 하나 (`packages/shared/src/state-schema.ts`). 모든 쓰기는 `stateRevision`+1과 함께 원자적으로 저장.
- **영구 특성**: `skills` / `negativeTraits` = `{ [traitId]: 1 | 2 }`, 키 부재 = 미보유. 시작은 항상 `{}`, XP 없음. 변경은 `SKILL_SET_LEVEL`(special 이벤트 onSuccess, 0→1·1→2) / `NEGATIVE_TRAIT_SET_LEVEL`(special, 0→1·1→2·2→1·1→0)만 가능. 이력은 `skillHistory`/`traitHistory`.
- **선천적 배경**: `backgroundTraits[]` (레벨 없음).
- **NPC**: `npcs[]`(성향·능력·관계·기억) + `npcAssignments[]`(회사·팀·역할·유효 기간).
- **플래그**: `{key, scope: RUN|COMPANY|NPC|TEMPORARY, ownerId, expiresTurn, ...}`.
- **RNG**: `seed` + 판정용 주 스트림 `rngState`(uint32). 카드·지원 카드·NPC 생성은 시드 파생 스트림.
- **저장소**: `RunStore` 인터페이스 — 현재 `FileRunStore`(개발용 JSON 파일 스텁)/`MemoryRunStore`(테스트). PostgreSQL은 미구현.

※ 모든 연봉·확률·수치는 게임 밸런스용 가상 값입니다.
