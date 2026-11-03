# 구조 설명 (AI-ZTNA-XDR)

## 한 줄 요약

수업용 경보(fixtures)를 **AI가 판정하고 설명**하며, 그 판정을 **제로 트러스트(ZTNA) 접근 결정**으로 집행하는 XDR입니다. AI가 없거나 실패하면 규칙 엔진으로 안전하게 떨어집니다.

## 흐름

```
경보(alert)                         [aleph-source/fixtures]
   │
   ▼
AI 판정기  ──(실패)──▶ 규칙 폴백      [src/engine, 폴백: aleph-source/xdr/*/decide.mjs]
   │  {action, confidence, reason}
   ├────────────────▶ AI 설명 생성기  [src/engine]
   │                   {설명, 근거 ID 대조}
   ▼
ZTNA 집행 매핑                        [src/ztna, 재료: aleph-source/xdr/*/respond.mjs]
   │  판정 → 접근 결정
   ▼
집행 규칙(거부/격리/세션 거둠/목적지 차단)
```

## 폴더

| 경로 | 담는 것 | 채우는 작업 스텝 |
|---|---|---|
| `aleph-source/` | vault에서 복사한 읽기 참고 자산(출처: `SOURCE.md`) | 스텝 1(완료) |
| `src/ai/` | 제공자 교체가 가능한 AI 호출 계층(Claude 기본) | 스텝 2 |
| `src/engine/` | AI 판정기 + 규칙 폴백, AI 설명 생성기 | 스텝 3·4 |
| `src/ztna/` | 판정 → 접근 결정 → 집행 규칙 매핑 | 스텝 5 |
| `scripts/` | 실행기(모듈 하나를 넣어 전체 파이프라인 실행) | 스텝 3~6 |
| `test/` | 모의 제공자 기반 오프라인 시험 | 스텝 6 |
| `docs/` | 구조·검증 문서 | 전 단계 |

## 판정 계약 (vault 호환)

AI 판정기의 반환은 vault 실행기와 같은 형식을 유지합니다.

- `action`: `block` | `alert` | `record`
- `confidence`: 0 이상 1 이하 숫자
- `reason`: 짧은 이유

## ZTNA 집행 단위 (vault respond.mjs 재사용)

| 모듈 성격 | 차단 단위 | 근거 |
|---|---|---|
| brute-force, known-cve, web-injection | 출발 주소 | 공격 출처 격리 |
| persistence | 출발 주소(그 PC 격리) | T1543 |
| privilege | 계정(세션 거둠) | T1078 |
| exfiltration | 목적지 주소 | T1041 |

## 설계 원칙

- **채점 저장소 불변**: `choi-bujang-vault`의 제출물은 건드리지 않습니다.
- **폴백 우선**: AI 호출 실패·형식 오류는 규칙 판정으로 떨어져, 실행기가 멈추지 않습니다.
- **키 분리**: API 키는 `.env`(환경변수)로만 받고 저장소에 올리지 않습니다.
- **네트워크 명시**: AI 호출은 명시적으로 켤 때만 나갑니다. 모의 제공자(`mock`)는 네트워크를 쓰지 않습니다.
