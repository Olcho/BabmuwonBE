# 프론트엔드 연동 계약

대상: 기능명세서 v0.3, 새로운 SC-01~SC-08. 기준 서버는 `http://127.0.0.1:3000`입니다. **학생·알레르기 안전 판단 및 원본 데이터 저장은 FE의 로컬 책임**입니다.

## 공통 연결

- `GET /health` 외 모든 업무 경로: `Authorization: Bearer <로컬 Relay 토큰>`.
- POST: `Content-Type: application/json`, 본문 최대 16 KiB. 알 수 없는 필드는 400.
- 기본 Origin: `http://localhost:5173`, `http://127.0.0.1:5173`. CORS와 인증을 모두 통과해야 합니다. 무Origin CLI도 인증이 필요합니다.
- Liner/채널톡 키 입력·조회 API는 없습니다. 로컬 토큰은 메모리에만 두고 백업하지 않습니다.
- 응답은 JSON, `Cache-Control: no-store`. 오류는 `{"error":"CODE"}`만 반환합니다.
- API 응답의 텍스트는 `textContent` 등 안전한 텍스트 렌더링으로 표시하고 HTML로 실행하지 않습니다.
- Mock 결과도 검토/승인 절차를 거칩니다. `simulated:true`를 눈에 띄게 표시합니다.

`GET /health` (200):

```json
{"status":"ok","service":"mawd-relay","linerMode":"mock","channelMode":"mock","localOnly":true}
```

`GET /catalog` (200, 인증 필요): `foods:string[]`, `topics:{topicId:설명}`, `templateCode:string`, `templateText:string`. `#{월}`만 치환하여 미리보기합니다. 학교명은 템플릿 고정값, 버튼 URL은 채널톡 캠페인 고정값입니다. 이 응답이 템플릿 검수나 실제 캠페인 일치를 보증하지는 않습니다.

## AI 요청

| 경로 | 요청 JSON |
| --- | --- |
| /ai/s2-news | `{"month":"2026-12","menus":["닭갈비","미역국","귤"]}` |
| /ai/nutrition | `{"topicId":"balanced_meals"}` |
| /ai/substitute-evidence | `{"allergenNo":1,"foodName":"두부조림"}` |

`month`는 YYYY-MM, 연도 2000~2099. 메뉴는 1~3개, 식품은 서버 공개 목록과 정확히 일치해야 합니다. 별도의 prompt·학교명·학생명·가명·학생별 번호·알레르기 배열을 넣지 않습니다. 근거 API는 **일반 식품 근거용**이며 학생의 대체식 안전성을 판정하지 않습니다.

nutrition 주제: `balanced_meals`, `seasonal_foods`, `food_allergy_basics`, `winter_nutrition`, `food_waste`.

`POST /ai/s5-body`:

```json
{
  "counts": {
    "byAllergen": [{"allergenNo":1,"students":"3명 미만"},{"allergenNo":2,"students":5}],
    "byGrade": [{"grade":1,"students":"3명 미만"},{"grade":2,"students":5}],
    "provided": 12,
    "excluded": "3명 미만"
  }
}
```

- `byAllergen`: 0~19개, 번호 1~19 중복 금지.
- `byGrade`: 선택, 0~6개, 학년 1~6 중복 금지. 학년별 별도 집계만 허용하며 알레르기와 교차한 표는 금지합니다.
- 모든 집계 값은 정수 3~100000 또는 정확한 문자열 `"3명 미만"`. **0·1·2를 FE에서 억제**합니다. Relay는 원래 소수 값을 받으면 400으로 막습니다.
- 정확한 집계표는 로컬 문서에만 넣습니다. 합계/비율/추가 열로 억제한 숫자를 복원할 수 있는 내용이나 학생 행은 보내지 않습니다. 이 계약은 통계적 익명성을 보증하지 않습니다.

AI 성공 응답 (200):

```json
{
  "text": "[모의 초안] ...",
  "citations": [],
  "simulated": true,
  "cached": false,
  "reviewRequired": true,
  "sourceMissing": true,
  "source": "mock"
}
```

live의 `source`는 `router` 또는 `search`, 출처는 `[{"title":"...","url":"https://..."}]`. 출처가 없어도 문장이 반환될 수 있으므로 `sourceMissing`을 표시합니다. Mock은 출처를 만들어내지 않습니다. 동일 입력은 캐시되고 진행 중인 동일 질의는 공유됩니다.

FE는 출처 확인 / 치료·효능 단정 없음 / 숫자·메뉴명 확인의 3개 검토 체크를 거쳐야 문장 승인할 수 있습니다. Relay가 `approved:true`를 반환하는 AI API는 없습니다. 오류·Relay 꺼짐에서는 해당 칸을 **로컬 기본 문구 또는 직접 입력**으로 전환하고 기존 문장을 자동 승인하지 않습니다. S4 확인 문구는 로컬 고정 템플릿이며 AI 요청을 하지 않습니다.

## S2 승인과 버전 동기화

`POST /local/s2-state`는 추가된 로컬 운영 경로입니다. 승인 시, 식단 변경/확정 해제 시, 재승인 시 반드시 호출하고 성공 응답을 기다립니다.

```json
{
  "month":"2026-12",
  "planVersion":1,
  "planConfirmed":true,
  "docVersion":1,
  "basedOnPlanVersion":1,
  "approved":true
}
```

200: 위 필드와 `"approvalSource":"local-client-attestation"`를 반환합니다. 버전은 1~999999999 정수이며 감소할 수 없습니다.

식단이 버전 2로 바뀌면 이전 S2 기준은 유지한 채 `planVersion:2, basedOnPlanVersion:1, approved:false`를 전송합니다. 확정 해제 중에는 `planConfirmed:false`. 재생성·재승인 시 `docVersion:2, basedOnPlanVersion:2, approved:true, planConfirmed:true`로 갱신합니다. 같은 docVersion의 기반 버전을 바꾸면 409입니다.

**이는 FE가 보고한 메타데이터에 대한 검사입니다.** Relay가 IndexedDB나 실제 PDF를 독립 검증하지 않습니다. 클릭 시 FE도 최신 승인본인지 재검사하고, 동기화 실패/네트워크 끊김에는 발송 버튼을 잠가야 합니다. 변조 가능한 클라이언트 플래그를 서버 승인 권한으로 해석하지 마세요.

## 발송

영양사의 명시적 버튼 클릭 + 수신 대상 수 확인 후 `POST /send/alimtalk`:

```json
{
  "batchKey":"2026-12:doc-v1:demo-lunch-notice",
  "month":"2026-12",
  "recipients":[
    {"memberId":"10000000-0000-4000-8000-000000000000","phone":"010-0000-0000"}
  ]
}
```

위 번호는 **Mock 전용 합성 예시**이며 실서비스에 보내지 않습니다.

- batchKey: `YYYY-MM:doc-v{양의 정수}:{설정된 templateCode}`. 서버는 구조에서 S2 버전을 추출합니다.
- 한 S2 버전당 배치 하나. 템플릿을 바꿔도 같은 버전으로 새 배치를 만들 수 없습니다.
- recipients 1~10명(해커톤 데모 한도), memberId는 `crypto.randomUUID()`로 만든 UUID v4. 학생 ID/가명/학년반에서 생성하지 않습니다.
- 전화번호는 `01012345678` 형식 또는 `010-1234-5678` 형식. 정규화 후 전화번호·UUID 중복은 400이며 FE가 미리 중복을 제거해야 합니다.
- 학생/Guardian 라벨, 학생 관계, S4 내용, 본문·URL·학교명 추가 필드는 거부합니다.
- 채널톡에는 UUID 경로 + 전화번호 profile로 upsert하고 반환된 userId로 `lunch_notice_requested` 이벤트를 생성합니다. 이벤트 속성은 `{"month":"12"}` 하나입니다.
- 동일 batchKey 재요청은 409. 최초 응답을 잃어도 새로운 key로 우회하지 말고 기존 배치를 조회합니다.

성공적으로 처리한 요청 응답 (202):

```json
{
  "batchKey":"2026-12:doc-v1:demo-lunch-notice",
  "month":"2026-12",
  "simulated":true,
  "status":"requested",
  "createdAt":"2026-11-15T00:00:00.000Z",
  "correctionNeeded":false,
  "recipients":[{
    "memberId":"10000000-0000-4000-8000-000000000000",
    "requestStatus":"requested",
    "deliveryStatus":"unknown",
    "retryCount":0,
    "retryable":false,
    "stage":"requested",
    "updatedAt":"2026-11-15T00:00:00.000Z",
    "attempts":[{"at":"2026-11-15T00:00:00.000Z","stage":"requested","finishedAt":"2026-11-15T00:00:00.000Z"}]
  }],
  "totals":{"count":1,"requested":1,"failed":0,"uncertain":0,"delivered":0}
}
```

202는 배치 처리가 끝났거나 일부 실패했다는 응답이며 **실수신을 의미하지 않습니다.** 모든 수신자가 upsert에 실패해도 HTTP 202 + `status:partial`로 개별 실패 상태를 반환합니다. FE는 HTTP 상태만으로 성공 건수를 표시하면 안 됩니다.

`GET /send/batches/{encodeURIComponent(batchKey)}`는 같은 구조를 반환합니다. 최초 처리 중에도 조회 가능하고 상태는 `requesting`입니다. 배치 상태: `requesting | requested | partial | manual`.

| requestStatus / stage | 의미 | 재시도 |
| --- | --- | --- |
| pending / reserved, upsert | 이벤트 전 처리 중 | 불가 |
| pending / event | 이벤트 요청 중 | 불가 |
| requested / requested | 이벤트 응답 검증됨 또는 Mock 요청 완료 | 불가 |
| request_failed / upsert_failed | 이벤트를 호출하지 못한 명확한 실패 | retryable=true일 때만 |
| request_failed / uncertain | 이벤트 도착 여부 불명확, 중복 위험 | 불가 |
| pending / manual | 수동 파일로 인계됨, 발송 여부 미확인 | 자동 경로 불가 |

`deliveryStatus`는 현재 **항상 unknown**입니다. 도착 확인/실패는 별도 FE 로컬 상태에 `deliveryCheckedBy:manual` 및 확인 증거를 기록합니다. Relay 값을 덮어쓰거나 이벤트를 delivered로 승격하지 않습니다. 결과 조회/웹훅 도착 자동화 API는 제공하지 않습니다.

`errorCode`는 실패한 수신자/시도에만 존재합니다. `CHANNEL_UPSERT_FAILED`, `EVENT_OUTCOME_UNKNOWN`, 재시작 복구 시 `INTERRUPTED_BEFORE_EVENT`가 가능합니다. 전화번호 원문/전화번호 HMAC은 조회에 없습니다.

발송 후 식단 변경을 동기화하면 과거 배치 조회에 `correctionNeeded:true`. 과거 기록은 보존하고 새 S2 docVersion을 승인한 뒤 새 batchKey로 정정합니다.

### 재시도

`POST /send/alimtalk/retry`에 최초와 같은 batchKey·month 및 **실패한 수신자 부분집합**만 보냅니다. UUID와 전화번호는 최초 값과 같아야 합니다. 각 수신자는 최대 3회 추가 시도합니다. 모든 대상 검증과 예약 후 네트워크 호출을 시작하므로 하나라도 부적격이면 전체 재시도를 거부합니다.

upsert 실패만 재시도합니다. 이벤트 전송 실패는 HTTP 오류라도 보수적으로 uncertain으로 보고 재시도하지 않습니다. 네트워크 자동 재시도 로직을 FE에 추가하지 마세요. 토큰 변경 시 기존 전화번호 HMAC 일치 확인이 실패할 수 있으므로 무작정 새 배치를 만들면 안 됩니다.

### 수동 발송 파일

`POST /send/alimtalk/manual`: 발송과 같은 요청 형식. 채널톡 모드가 disabled여도 사용 가능합니다. 최신 승인 확인은 동일합니다. 새 배치 또는 명확한 upsert 실패 수신자만 허용하며 requested/uncertain/이미 manual인 건은 제외합니다.

202 응답:

```json
{
  "batch":{"batchKey":"...","status":"manual","simulated":true,"recipients":[],"totals":{}},
  "files":{
    "txt":{"filename":"2026-12_alimtalk.txt","content":"templateCode=demo-lunch-notice\nmonth=12\n[데모학교] 12월 급식 안내입니다. ..."},
    "csv":{"filename":"2026-12_recipients.csv","content":"memberId,phone\r\n..."}
  }
}
```

위 `batch`는 축약 예시이며 실제로는 일반 배치 조회와 같은 전체 구조입니다. FE는 각각 UTF-8 txt/csv Blob으로 내려받습니다. CSV 전화번호는 텍스트로 취급하여 앞의 0을 보존합니다. 다운로드 파일은 연락처를 포함하므로 사용 후 관리/삭제 안내가 필요합니다. 서버에는 파일/원문 연락처가 남지 않습니다.

`manual`은 콘솔로 넘길 파일이 준비됐다는 뜻이며 요청 성공/도착 성공이 아닙니다. 검수된 실제 템플릿·고정 URL과 파일의 문구·월을 대조하고 채널톡 콘솔에서 영양사가 별도로 발송합니다. 일부 실패 대상만 수동 전환하면 전체 배치 상태는 partial일 수 있습니다. 파일 내보내기 응답을 잃은 경우 자동 재전송하지 말고 운영자가 인계 상태를 확인합니다.

## 감사 기록과 오류

`GET /audit` (인증 필요)는 최신 100건의 `events:[{at,endpoint,status,statusCode,durationMs}]`를 최신순으로 반환합니다. `status`는 ok, cached 또는 고정 오류 코드입니다. 동적 경로는 `/send/batches/:batchKey`로 정규화합니다. 재시작 시 감사 메모리 기록은 초기화되고 배치 이력은 유지됩니다. SC-08에서 보낸 허용 필드 내용을 표시하려면 FE가 로컬에서 보관하며 Relay에 학생 사전을 보내면 안 됩니다.

| HTTP | 대표 코드 / 처리 |
| --- | --- |
| 400 | INVALID_REQUEST, INVALID_JSON, BLOCKED_BY_PRIVACY_POLICY, TEMPLATE_NOT_CONFIGURED |
| 401 | UNAUTHORIZED: 로컬 Relay 토큰 확인 |
| 403 | ORIGIN_NOT_ALLOWED, HOST_NOT_ALLOWED |
| 404 | NOT_FOUND, BATCH_NOT_FOUND |
| 409 | DUPLICATE_BATCH, BATCH_BUSY, S2_NOT_CURRENT_APPROVED, VERSION_REGRESSION, NEW_DOCUMENT_VERSION_REQUIRED |
| 409 | RETRY_NOT_ALLOWED, MAX_RETRIES_REACHED, RECIPIENT_MISMATCH, BATCH_MODE_MISMATCH, MANUAL_EXPORT_NOT_ALLOWED |
| 413 / 415 | PAYLOAD_TOO_LARGE / JSON_REQUIRED |
| 429 | RELAY_BUSY: 동시에 처리 중인 다른 AI 질의가 32개 이상 |
| 502 | LINER_AUTH_FAILED, LINER_UPSTREAM_ERROR, LINER_STREAM_ERROR, LINER_INVALID_RESPONSE, LINER_INCOMPLETE_STREAM, LINER_INCOMPLETE_RESPONSE, UPSTREAM_INVALID_RESPONSE, UPSTREAM_RESPONSE_TOO_LARGE |
| 503 | LINER_RATE_LIMITED, CHANNEL_SEND_DISABLED, STATE_UNAVAILABLE |
| 504 | LINER_TIMEOUT |
| 500 | INTERNAL_ERROR: 본문/오류 상세를 수집하지 말고 상태 확인 |

기본 외부 호출 제한은 30초입니다. 알림톡은 최대 10명에 대해 upsert/event를 순차 실행하므로 전체 HTTP 요청은 더 오래 걸릴 수 있습니다. FE는 발송 대기를 충분히 두고 응답이 끊기면 배치 조회로 복구하세요. 캐시·대기열·Mock을 제외한 외부 계정 동작은 실계정 확인 전까지 미검증입니다.
