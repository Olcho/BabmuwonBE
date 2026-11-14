# MAWD 로컬 Relay 백엔드

학교 급식 영양사 업무 자동화 기능명세서 **v0.3 최종본** 기준 구현입니다. Node.js 내장 HTTP + TypeScript를 사용하며 런타임 npm 의존성은 없습니다. 학생·개별 알레르기 데이터는 프론트엔드 IndexedDB에서만 처리합니다.

기본 실행은 **Liner Mock + 채널톡 Mock**입니다. 실제 API 키 없이 5개 API를 실행하고 테스트할 수 있습니다. Mock 및 채널톡 이벤트 성공은 알림톡 도착 성공이 아닙니다. **실계정 API 호출·캠페인 트리거·실수신은 아직 검증하지 않았습니다.**

## 실행

Node.js 22 이상과 npm을 설치한 뒤 이 저장소에서 실행합니다.

```sh
npm ci --ignore-scripts
npm run build
npm test
npm start
```

기본 주소는 `http://127.0.0.1:3000`입니다. `.env`는 선택 사항이며 필요한 경우 `.env.example`을 복사합니다. 외부 주소 바인딩 및 원격 Origin은 설정 단계에서 거부합니다.

첫 실행 시 `data/relay-auth-token`에 **로컬 Relay 인증 토큰**을 생성합니다. 운영자가 이 파일을 로컬에서 읽어 프론트엔드의 Relay 연결 설정에 입력합니다. 이 토큰은 외부 API 키가 아닙니다. 프론트엔드는 토큰을 메모리에 보관하고 백업·로그·URL에 넣지 않습니다. 직접 지정하려면 `.env`의 `RELAY_AUTH_TOKEN`에 32~128자리 영숫자/밑줄/하이픈 값을 넣습니다. 토큰 값은 서버가 출력하지 않습니다.

PowerShell 호출 예:

```powershell
$relayToken = (Get-Content -Raw data/relay-auth-token).Trim()
$relayHeaders = @{ Authorization = "Bearer $relayToken" }
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/ai/nutrition -Method Post -Headers $relayHeaders -ContentType 'application/json' -Body '{"topicId":"balanced_meals"}'
```

curl 예(로컬 인증 토큰만 환경변수에 지정):

```sh
curl http://127.0.0.1:3000/ai/nutrition \
  -H "Authorization: Bearer $RELAY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"topicId":"balanced_meals"}'
```

## 구현 범위

| API | 역할 |
| --- | --- |
| POST /ai/s2-news | 월·공개 메뉴 최대 3개로 Router 초안 |
| POST /ai/nutrition | 고정 주제로 Search Agent 검색·출처 |
| POST /ai/substitute-evidence | 알레르기 항목 1개·공개 식품명의 일반 근거 검색 |
| POST /ai/s5-body | 소수 값이 억제된 집계로 Router 보고 초안 |
| POST /send/alimtalk | 현재 승인 S2 배치의 사용자 upsert·이벤트 생성 |
| POST /local/s2-state | 로컬 프론트엔드의 S2 승인·식단 버전 상태 반영 |
| POST /send/alimtalk/retry | 안전하게 재시도 가능한 실패 건만, 최대 3회 |
| POST /send/alimtalk/manual | 안전한 대상만 txt/csv 파일 생성 및 수동 인계 기록 |
| GET /send/batches/:batchKey | 수신자별 요청 상태·시도 이력·도착 미확인 조회 |
| GET /health, /catalog, /audit | 연결 상태·메뉴 예시/템플릿·본문 없는 감사 기록 |

요청·응답 JSON, 오류 코드, 프론트엔드 책임은 [FRONTEND_API.md](docs/FRONTEND_API.md)에 있습니다.

## 보안 및 상태 처리

- 모든 업무 API에 Bearer 인증을 적용합니다. CORS는 인증의 대체물이 아닙니다. `/health`만 무인증으로 제한된 연결 정보를 반환합니다.
- 요청 JSON은 16 KiB 제한과 정해진 필드·자료형·범위를 검사합니다. 학생 객체와 임의의 프롬프트 필드는 거부합니다.
- 메뉴명과 식품명은 공백만 있는 값을 제외한 200자 이하 문자열이며 입력 그대로 사용합니다. FE는 학생 데이터를 별도로 관리하고 실제 메뉴명만 보냅니다. 메뉴 문자열에 섞인 개인정보가 전달될 수 있는 한계는 [구현 근거](docs/IMPLEMENTATION_NOTES.md)에 설명합니다.
- S5의 0·1·2는 모두 `"3명 미만"`으로 전달합니다. 학년×알레르기 교차표·학생별 행은 받지 않습니다. 집계 억제만으로 재식별 위험이 완전히 사라지는 것은 아닙니다.
- AI 결과는 항상 `reviewRequired:true`입니다. 텍스트·출처가 있어도 자동 승인하지 않습니다. 오류 시 FE가 로컬 템플릿/직접 입력으로 전환합니다.
- Liner는 550ms 간격으로 호출을 시작하고 동일 질의 캐시·동시 질의 병합을 적용합니다. 대기 시간을 포함한 제한은 Router 30초, Search Agent 60초입니다. 스트림 `data-error`, 잘린 응답·잘못된 응답·401·429·오프라인을 처리합니다. 오류 결과는 캐시하지 않습니다.
- 한 S2 버전당 배치 하나입니다. 배치/재시도 예약을 외부 호출 전에 디스크에 기록합니다. 동시 프로세스 잠금, 임시 파일+fsync+rename, 재시작 복구를 적용했습니다.
- 이벤트 호출 직전 기록 이후 결과가 불명확하면 `stage:uncertain`, `retryable:false`를 유지합니다. 자동 재시도·수동 파일 자동 재발송 모두 막습니다.
- 수신자 UUID·전화번호 HMAC·시도 이력만 상태 파일에 저장합니다. **전화번호 원문과 학생 데이터는 저장하지 않습니다.** HMAC은 외부 전송용 익명화가 아니며 로컬 재시도 일치 검사에만 사용합니다.
- 오류 응답은 코드만, 감사 기록은 시각·정규화된 경로·결과 코드·시간만 포함합니다. 임의 URL/본문/전화번호/API 키는 기록하지 않습니다.
- 수동 파일 CSV에는 사용자가 요청한 전화번호가 포함됩니다. 응답으로 한 번 반환하고 서버에는 저장하지 않습니다. 파일 생성은 실제 발송 성공이 아닙니다.

## 로컬 저장소 운영

`data/relay-state.json`과 로컬 토큰을 보존해야 재시작 후 중복 방지·재시도 일치 검사가 유지됩니다. 저장소를 지우거나 과거 백업으로 덮어쓰면 이미 발송한 이벤트를 잊게 됩니다. Mock→live 전환 시 기존 Mock 배치를 live로 재시도할 수 없습니다. 실제 검증은 별도 데모 버전으로 진행하세요.

프로세스 강제 종료 후 살아 있지 않은 PID의 잠금은 자동 회수합니다. PID 재사용·깨진 잠금·잠금 생성 중 강제 종료(`.lock.guard` 잔존)는 안전을 위해 시작을 막습니다. 모든 Relay 프로세스가 종료됐는지 확인하고 상태 파일을 보존한 채 운영자가 잠금을 점검해야 합니다. 상태 파일 오류를 빈 상태로 자동 복구하지 않습니다.

로컬 단일 프로세스/단일 상태 파일용입니다. 여러 상태 파일·다른 PC 사이의 중복을 막지 않습니다. 네트워크/클라우드 동기화 폴더 대신 로컬 디스크의 `DATA_FILE` 사용을 권장합니다. 파일 모드 0600은 Windows에서 완전한 접근 제어/암호화를 보장하지 않으므로 OS 계정·ACL 보호가 필요합니다. 로그/AI 캐시는 메모리에서만 최대 100개, 캐시 유효기간 1시간입니다.

## 실계정 연결 전 필요한 확인

Liner는 `LINER_MODE=live`, `LINER_API_KEY`로 별도 설정합니다. Channel Talk은 `CHANNEL_SEND_MODE=live` 외에 `ALLOW_REAL_ALIMTALK_SEND=YES`, Access Key/Secret, 승인된 `CHANNEL_TEMPLATE_CODE`, 실제 고정 `CHANNEL_TEMPLATE_TEXT`가 모두 필요합니다. 본 작업에서는 실발송 설정을 활성화하지 않았습니다.

학교명은 검수된 템플릿의 고정 문구이고 이벤트 속성은 `month` 하나뿐입니다. 버튼의 고정 S2 URL은 채널톡 콘솔에서 설정합니다. Relay는 웹페이지/PDF를 업로드하거나 SMS 대체 발송하지 않습니다. 템플릿 코드가 이벤트 API로 전달되는 것은 아니므로 캠페인과 코드/문구의 일치는 콘솔에서 확인해야 합니다.

추가 미검증 항목: 계정 권한·요금·검수, 이벤트→알림톡 캠페인 트리거, 월 변수 바인딩, 같은 사용자 월별 재발송, 고정 URL의 최신 승인 S2, 수신 확인/웹훅. `deliveryStatus`는 항상 `unknown`이며 실제 증거를 본 영양사의 확인은 FE 로컬 기록에 따로 저장합니다.

`/local/s2-state`는 인증된 로컬 클라이언트의 주장입니다. Relay가 원본 식단/PDF/승인자를 독립 검증하는 구조가 아닙니다. 악의적인 로컬 사용자 또는 FE의 버전 동기화 누락을 막는 서버 권한 모델로 간주하면 안 됩니다. **인터넷 배포는 하지 않았으며 이 구조로 공개하지 않습니다.**

## 검증 및 기준

- `npm run build`, `npm run check`, `npm test`, 실제 시작/Mock 연동 결과: [검증 기록](docs/VALIDATION.md)
- Liner 프롬프트 비교 실행법과 영양사 검토 항목: [AI 초안 품질 검증](docs/LINER_QUALITY.md)
- ZIP 재사용 판단·Figma 충돌·공식 API 출처: [구현 근거](docs/IMPLEMENTATION_NOTES.md)
- 작업: [GitHub 이슈 #1](https://github.com/Olcho/BabmuwonBE/issues/1), 브랜치 `codex/relay-foundation`
- FE 저장소·Figma 수정, 외부 배포, main 머지는 이 작업에 포함하지 않습니다.
