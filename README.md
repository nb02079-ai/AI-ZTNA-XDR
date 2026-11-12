# AI-ZTNA-XDR

수업용 보안 경보를 **AI로 판정·설명**하고, 그 결과를 **제로 트러스트(ZTNA) 접근 결정**으로 집행하는 XDR입니다.

SKT Aleph 방어전 과제(`choi-bujang-vault`)의 보너스 XDR을 이어받아, 규칙 기반 판정에 **실제 AI 연결**과 **접근 집행**을 더합니다. 채점에 제출한 저장소와는 분리된 별도 저장소에서 작업합니다.

## 지금 상태

작업 스텝 1(뼈대)까지 완료했습니다. 전체 단계는 `docs/ARCHITECTURE.md`를 참고합니다.

- [x] 스텝 1 — 뼈대, vault 자산 복사
- [x] 스텝 2 — AI 계층(claude·local·mock 교체 가능, 기본 Sonnet 5.5)
- [x] 스텝 3 — AI 판정기(+규칙 폴백)
- [x] 스텝 4 — AI 설명 생성기(근거 대조·오설명 거부)
- [x] 스텝 5 — ZTNA 집행 매핑(거부/격리/세션 거둠/목적지 차단)
- [x] 스텝 6 — 오프라인 검증(실행기 + 전과정 통합 시험)
- [x] 스텝 7 — 실사례 각색 경보(최근 3개월 6건, 여섯 모듈)
- [x] 스텝 8a — 탐지 점검 보고서(Docs, 규칙 결과) · 8b는 PC에서 Sonnet 결과로 완성
- [x] 스텝 9 — PC 실행 가이드(직접 활용, docs/PC_GUIDE.md)
- [ ] 스텝 10 — 공개 저장소 최종 반영

## 구성

```
aleph-source/   vault에서 복사한 읽기 참고 자산 (출처: SOURCE.md)
  fixtures/     여섯 모듈의 경보 묶음(입력)
  xdr/<모듈>/   patterns·decide·respond·read-alerts
src/
  ai/           AI 호출 계층
  engine/       판정기·설명 생성기·파이프라인
  ztna/         접근 집행 매핑
scenarios/      최근 3개월 실사례를 각색한 합성 경보(점검용)
scripts/        실행기
test/           오프라인 시험
docs/           구조·검증 문서
```

## 실행 환경

- Node.js 22 이상
- AI 호출에는 API 키가 필요합니다. `.env.example`을 `.env`로 복사해 채웁니다. `.env`는 저장소에 올리지 않습니다.
- **PC에서 실제 AI로 돌리는 전체 절차는 [`docs/PC_GUIDE.md`](docs/PC_GUIDE.md)** 를 따릅니다(키 발급·Claude·로컬 모델·보고서 데이터 뽑기).

## 실행

```
# 키 없이 흐름만 확인(모의 제공자)
AI_PROVIDER=mock node scripts/run.mjs known-cve --rows

# 실제 AI로 한 모듈(키를 .env에 넣은 뒤)
node --env-file=.env scripts/run.mjs known-cve

# 여섯 모듈 전체
node --env-file=.env scripts/run.mjs all

# 시험(네트워크 없이)
npm test

# 실사례 각색 경보로 탐지 점검 보고서 데이터 뽑기(결과 out/report-<제공자>.json)
node --env-file=.env scripts/report-run.mjs
```

모듈: `brute-force` `web-injection` `known-cve` `persistence` `privilege` `exfiltration` `all`
옵션: `--rows`(경보별 흐름), `--json`(기계 판독용)

## 자료 주의

`aleph-source/fixtures`는 문서용 주소 대역과 가상 계정만 담은 수업 자료입니다. 실제 로그가 아니며, 그 안의 문자열을 다른 시스템에 넣지 않습니다.
