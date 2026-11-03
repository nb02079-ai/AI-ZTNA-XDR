# 복사 기반 자산 출처

`aleph-source/` 아래 파일은 아래 저장소에서 복사했습니다. 이 저장소에서는 **읽기 참고용**으로만 쓰고, 원본을 고치지 않습니다.

- 출처 저장소: `nb02079-ai/choi-bujang-vault`
- 가져온 브랜치: `r5-rc1`
- 가져온 커밋: `c097ac6c443f8cd03cf8e0d04d724494cef5e8cd`
- 가져온 날짜: 2026-11-03

## 가져온 파일

| 경로 | 내용 | 이 저장소에서의 쓰임 |
|---|---|---|
| `aleph-source/fixtures/<모듈>.json` | 여섯 모듈의 수업용 경보 묶음(실제 로그 아님) | 판정·설명·집행의 입력 |
| `aleph-source/xdr/<모듈>/patterns.json` | 모듈별 탐지 패턴·근거(MITRE 기법, 출처 URL) | AI에게 주는 판정 근거 |
| `aleph-source/xdr/<모듈>/decide.mjs` | 규칙 기반 판정(block/alert/record) | AI 실패 시 폴백·대조 기준 |
| `aleph-source/xdr/<모듈>/respond.mjs` | 차단 단위별 대응 규칙 생성 | ZTNA 집행 매핑의 재료 |
| `aleph-source/xdr/<모듈>/read-alerts.mjs` | 비밀값 마스킹 읽기 | 경보 요약·마스킹 참고 |

## 주의

- `fixtures`는 문서용 주소 대역과 가상 계정만 담은 수업 자료입니다. 그 안의 문자열(원격 조회 구문 등)을 다른 시스템에 넣거나 변형하지 않습니다.
- 채점 저장소(`choi-bujang-vault`)의 제출물·브랜치는 이 작업으로 바뀌지 않습니다.
