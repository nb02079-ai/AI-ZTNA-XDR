# PC 실행 가이드

이 문서는 AI-ZTNA-XDR을 **내 PC에서 실제 AI에 연결해 직접 돌리는** 절차입니다. 기준 환경은 Windows + PowerShell입니다(라이젠 5600X · RTX 3060 Ti 8GB에서 확인). macOS·Linux도 명령만 bash로 바꾸면 같습니다.

## 1. 준비물

- **Node.js 22 이상** — [nodejs.org](https://nodejs.org/)에서 LTS 설치. 확인:
  ```powershell
  node --version
  ```
  `v22.x` 이상이면 됩니다.
- **git** — 저장소를 받을 때만 필요(아래 1-1). 이미 폴더가 있으면 건너뜁니다.

### 1-1. 저장소 받기

```powershell
git clone https://github.com/nb02079-ai/AI-ZTNA-XDR
cd AI-ZTNA-XDR
```

의존성 설치가 따로 필요 없습니다. 런타임 외부 패키지 없이 Node 내장 기능(`fetch`)만 씁니다.

## 2. 먼저 키 없이 동작 확인(mock)

키를 넣기 전에, 파이프라인이 도는지부터 봅니다. 외부 호출·키가 필요 없습니다. **환경변수를 세션에 남기지 않도록 한 줄에서 설정→실행→해제합니다.**

```powershell
$env:AI_PROVIDER="mock"; node scripts/run.mjs known-cve --rows; Remove-Item Env:\AI_PROVIDER
```

> **주의:** `$env:AI_PROVIDER = "mock"`을 따로 설정해 두면 그 PowerShell 창에 계속 남습니다. Node의 `--env-file`은 **이미 있는 환경변수를 덮어쓰지 않으므로**, 뒤에서 `.env`로 `claude`를 지정해도 세션에 남은 `mock`이 이깁니다(실행 결과에 "제공자: mock"으로 나타남). 위처럼 끝에 `Remove-Item Env:\AI_PROVIDER`로 지우거나, 새 PowerShell 창에서 다음 단계를 진행하세요.

모듈 경보가 판정 → 집행까지 흐르는 요약이 나오면 정상입니다. 시험도 돌려볼 수 있습니다(네트워크 없이):

```powershell
npm test
```

## 3. 실제 Claude(Sonnet 5.5)로 돌리기

### 3-1. API 키 발급

1. [platform.claude.com](https://platform.claude.com/)에 로그인합니다.
2. 콘솔의 API 키 관리에서 새 키를 만듭니다(`sk-ant-...` 형태).
3. 키는 한 번만 보이므로 안전한 곳에 복사해 둡니다. **저장소에 올리지 않습니다.**

> 실제 호출에는 비용이 듭니다. 이 점검은 경보 약 150건 안팎이라 한 번 돌리는 데 보통 1달러 미만입니다.

### 3-2. .env 만들기

예시 파일을 복사해 값을 채웁니다.

```powershell
Copy-Item .env.example .env
notepad .env
```

`.env`에서 이 두 줄만 확인하면 됩니다(나머지는 기본값으로 충분):

```
AI_PROVIDER=claude
CLAUDE_MODEL=claude-sonnet-5-5
ANTHROPIC_API_KEY=sk-ant-...   # 발급한 키를 여기에
```

`.env`는 `.gitignore`에 들어 있어 커밋되지 않습니다.

### 3-3. 실행

한 모듈:

```powershell
node --env-file=.env scripts/run.mjs known-cve --rows
```

여섯 모듈 전체:

```powershell
node --env-file=.env scripts/run.mjs all
```

각 경보가 실제 Sonnet 판정(`ai`)으로 처리되고, 판정·설명·접근 결정이 함께 나옵니다. AI 호출이 실패하면 자동으로 규칙 판정(`rule`)으로 떨어지므로 멈추지 않습니다.

### 3-4. 연결이 안 되면 — 먼저 점검

판정출처가 전부 `rule`이고 설명이 `ai_unavailable`로 나오면, AI 호출이 실패해 규칙 폴백으로 떨어진 것입니다. 파이프라인은 실패를 조용히 삼키므로, **원인은 점검기로 확인**합니다.

```powershell
node --env-file=.env scripts/check-ai.mjs
```

- 성공하면 `✓ 성공`과 응답이 나옵니다. 그대로 실제 실행을 진행하면 됩니다.
- 실패하면 `✗ 실패`와 함께 **정확한 원인**(키 미설정 · 401 인증 · 403 권한/크레딧 · 404 모델명 · 네트워크 · 시간 초과)과 조치를 알려 줍니다. 그 안내대로 고친 뒤 다시 실행하세요.

## 4. 탐지 점검 보고서 데이터 뽑기

각색 경보(`scenarios/`)를 실제 Sonnet으로 돌려, 보고서에 채울 결과 JSON을 만듭니다.

```powershell
node --env-file=.env scripts/report-run.mjs
```

- 콘솔에 모듈별 `기대 → 실제 판정 [hit/miss/clean/fp]`와 집계가 나옵니다.
- 결과는 `out/report-claude.json`에 저장됩니다.
- 이 값을 Claude Docs 「AI-ZTNA-XDR 실사례 탐지 점검 보고서」의 **"실제 AI(Sonnet)" 열**과 **"규칙 vs 실제 AI 대조"** 절에 옮겨 적으면 보고서가 완성됩니다.

보고서에 채울 핵심 숫자:

- 판정 일치: `hit`(잡음) · `miss`(놓침) · `clean`(정상통과) · `false_positive`(오탐) 집계
- known-cve 대조: rc-kc-01·rc-kc-02가 규칙과 같은 판정인지, 설명(`explanation`)이 다른지

## 5. (선택) 로컬 모델로 돌리기 — 외부 전송 없이

민감 환경에서 바깥으로 아무것도 내보내지 않고 돌리고 싶을 때 씁니다. RTX 3060 Ti 8GB면 7~8B급 모델이 현실적입니다.

### 5-1. Ollama 준비

1. [ollama.com](https://ollama.com/)에서 Windows용 Ollama를 설치합니다.
2. 모델을 받습니다(한 번만):
   ```powershell
   ollama pull qwen2.5:7b
   ```
3. Ollama가 백그라운드에서 `http://127.0.0.1:11434`로 돌고 있는지 확인합니다.

### 5-2. .env에서 제공자만 바꾸기

```
AI_PROVIDER=local
LOCAL_AI_MODEL=qwen2.5:7b
LOCAL_AI_URL=http://127.0.0.1:11434
```

키 줄은 비워 둬도 됩니다. 실행 명령은 Claude와 같습니다:

```powershell
node --env-file=.env scripts/run.mjs all
```

로컬 모델은 판단·설명 깊이가 Sonnet보다 떨어질 수 있지만, **네트워크로 아무것도 나가지 않는다**는 장점이 있습니다. 보고서에 "로컬 모델" 열을 따로 두어 Sonnet과 대조하면 좋은 비교가 됩니다.

## 6. 문제 해결

| 증상 | 원인·조치 |
|---|---|
| `temperature is deprecated` (400) | Sonnet 5.5는 temperature를 거부합니다. 코드가 자동으로 빼고 재시도하므로 최신 코드(`git pull`)면 넘어갑니다. 그래도 나면 `.env`의 `AI_TEMPERATURE` 줄을 비우세요. |
| **제공자가 `mock`으로 고정됨** | 세션에 남은 `$env:AI_PROVIDER`가 `.env`를 이깁니다. `Remove-Item Env:\AI_PROVIDER` 후 다시 실행하거나 새 창을 엽니다. |
| **판정이 전부 `rule`/`ai_unavailable`** | AI 호출 실패가 폴백된 것입니다. `node --env-file=.env scripts/check-ai.mjs`로 정확한 원인을 봅니다. |
| `AI_PROVIDER` 오류 | `claude` / `local` / `mock` 중 하나여야 합니다. |
| `ANTHROPIC_API_KEY가 설정되지 않았습니다` | `.env`에 키를 넣고 `--env-file=.env`로 실행했는지 확인합니다. |
| 401 인증 오류 | 키가 틀렸거나 비활성입니다. 콘솔에서 새 키를 발급합니다. |
| 403 권한 없음 | 크레딧 잔액이나 조직 권한을 확인합니다. |
| 404 모델 없음 | `CLAUDE_MODEL`이 맞는지 확인합니다(`claude-sonnet-5-5`). |
| 429 요청 과다 | 요청이 너무 잦습니다. 잠시 뒤 다시 돌립니다. |
| `요청 시간 초과` | 네트워크가 느리거나 막혔습니다. `.env`의 `AI_TIMEOUT_MS`를 늘립니다(예: 60000). |
| 로컬 모델 `네트워크 요청 실패` | Ollama가 켜져 있는지, `LOCAL_AI_URL`이 맞는지 확인합니다. |
| `--env-file` 인식 안 됨 | Node 20.6 미만입니다. 22 이상으로 올립니다. |

## 7. 안전 메모

- `.env`(키 포함)는 절대 커밋하지 않습니다. `.gitignore`가 막아 두었습니다.
- `scenarios/`의 각색 경보는 문서용 주소만 담은 합성 자료입니다. 실제 침해 지표가 아닙니다.
- 집행(차단·격리·거둠)은 **거부 규칙을 메모리에 만들 뿐**, 실제 방화벽·계정 시스템을 건드리지 않습니다. 실제 집행과 연동하려면 `src/ztna/`에 연동 계층을 따로 붙여야 합니다.
