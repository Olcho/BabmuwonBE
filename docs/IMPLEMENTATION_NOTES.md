# 구현 판단과 공식 문서 확인

## 기준 자료

작업 전 현재 경로는 MAWD 일반 폴더였고 Git 저장소가 아니었습니다. 그 아래에 `https://github.com/Olcho/BabmuwonBE.git`를 클론하고 remote를 확인했습니다. 원격 `codex/relay-foundation`의 `f499cf6`에 있던 최신 Figma 참조 문서까지 fast-forward한 뒤 구현했습니다. 기존 파일을 되돌리거나 FE 저장소를 수정하지 않았습니다.

`AGENTS.md`, `docs/CODEX_TASK.md`, `docs/FIGMA_SC_REFERENCE.md`, 첨부 `기능명세서 v0.3.docx`의 문단 및 표 내용을 읽었습니다. 문서에 포함된 구현 제안은 참고 자료로 다루고, 사용자의 명시적 개발 범위와 v0.3 보안/데이터 규칙을 기준으로 적용했습니다.

Figma는 읽기 전용으로 아래 새 프레임을 확인했습니다. 구형 프레임 `9:56`은 설계 기준에서 제외했습니다.

| 화면 | 새 프레임 |
| --- | --- |
| SC-01 | 26:525 |
| SC-02 | 26:705 |
| SC-03 | 26:788 |
| SC-04 | 26:953 |
| SC-05 | 26:1144 |
| SC-06 | 26:1294 |
| SC-07 | 26:1409 |
| SC-08 | 26:1550 |

SC-02/08의 학교명·학생명 치환 설명, SC-08 브라우저 API 키 표시, SC-07 편집 가능한 학교명/링크 및 단일 성공 표시는 v0.3과 충돌합니다. 실제 구현은 학생 토큰도 차단하고 키는 서버만 보관하며 요청/도착을 분리합니다. UI 파일 자체는 변경하지 않았습니다.

## Relay v0.1 ZIP 검사 및 재사용

첨부 `MAWD_backend_Relay_v0.1.zip`을 실제 열어 src·테스트·환경설정·문서·dist 목록을 검사했습니다.

재사용: Node 내장 HTTP/TypeScript 프로젝트 골격, 5개 라우트 이름, 고정 주제와 알레르기 항목 매핑, ApiError 구조, 속도 제한/캐시의 기본 구조, HMAC을 이용한 로컬 전화번호 일치 검사 개념.

수정/교체:

- 메뉴 문자열 모양만 검사하던 코드를 검토된 공개 메뉴의 정확한 허용목록과 결합했습니다. 등록된 실명 사전은 Relay가 보유하지 않으므로 FE의 로컬 검사도 여전히 필요합니다.
- `topicId in topicMap`의 상속 속성 허용을 `Object.hasOwn`으로 수정했습니다.
- 키 없는 초기 Mock 실행에 로컬 인증 토큰을 자동 생성하고 보존하도록 했습니다.
- 서버 상태를 디스크에 먼저 예약하고 성공한 저장만 메모리에 반영합니다. 프로세스 잠금·강제 종료 복구·최대 3회 재시도·모든 시도 이력을 추가했습니다.
- 이벤트 결과가 불명확한 수신자의 재시도를 차단했습니다. 재시도 전체 부분집합을 첫 await 이전에 예약합니다.
- 기존 자유로운 batchKey를 월+docVersion+templateCode 형식으로 제한하고 같은 문서 버전 중복도 막습니다.
- 로컬 승인 메타데이터 경로와 버전 감소/기반 버전 변경 차단을 추가했습니다. 실제 서버 승인 권한은 아니므로 로컬 데모에 한정합니다.
- 최신 문서로 확인한 Search SSE를 구현하고 data-error/불완전 종료를 검사합니다. ZIP의 비스트리밍 JSON 가정만으로 성공을 판정하지 않습니다.
- ZIP의 채널톡 `/open` 경로를 아래에서 직접 확인한 `/open/v5`로 바꿨습니다. 경로 자동 폴백/재시도는 넣지 않았습니다.
- 출처 URL을 http/https로 제한하고 API 오류/비밀정보를 그대로 반환하지 않습니다.
- 수동 txt/csv 인계 경로를 추가했습니다. 이미 요청된/불명확한 대상은 수동 내보내기도 막습니다.

ZIP의 dist·기존 README·배치 스크립트는 배포하지 않았습니다. src를 수정하고 현 환경에서 다시 컴파일·테스트했습니다.

## 공식 API 근거 (2026-11-15 확인)

- [Liner Search Agent](https://liner.com/developers/docs/search-agent-api): `POST /api/v1/agents/search`, x-api-key, messages/lang/mode/stream, text-delta 및 data-search-references를 확인했습니다. HTTP 200 안의 data-error와 [DONE]의 의미를 구분합니다. 구현은 stream=true로 받은 데이터를 제한 크기 내에서 모아 JSON 응답으로 반환합니다.
- [Liner GPT Router](https://liner.com/developers/docs/llm-gpt-router): `POST /api/v1/chat/completions`, `liner-gpt-router` 및 messages 형식을 확인했습니다. 모델 출력은 아직 실계정으로 확인하지 않았습니다.
- [Channel Talk 사용자 upsert](https://developers.channel.io/en/articles/Upsert-a-User-By-memberId-679320c3): `PUT /open/v5/users/@{memberId}`, profile.mobileNumber 및 user.id 응답을 확인했습니다.
- [Channel Talk 이벤트 생성](https://developers.channel.io/en/articles/Create-an-Event-b8e57dfd): `POST /open/v5/users/{userId}/events`, name/property 요청과 event.id/name 응답을 확인했습니다.
- [Channel Talk 인증](https://developers.channel.io/en/articles/20516f31): x-access-key 및 x-access-secret 헤더를 확인했습니다.

이는 문서 대조 결과이며 실계정 검증이 아닙니다. 문서 기반 가짜 응답으로 어댑터 계약을 테스트했습니다. 계정/요금제에 따른 경로·응답 차이가 있으면 오류/uncertain을 유지하며 다른 경로로 자동 재전송하지 않습니다.

최초 구현에서는 v0.3의 30초 가정값을 공통으로 사용했습니다. 후속 MVP 보완에서 사용자 요청에 따라 Router 30초와 Search Agent 60초로 분리했습니다. 제한을 넘으면 타임아웃을 반환하고 FE는 로컬 대체 문구를 사용합니다.

## 메뉴명 검증 정책 변경과 잔여 위험

최신 요청에 따라 Relay의 메뉴 허용목록과 메뉴 내용의 개인정보 정규식 검사를 제거했습니다. `GET /catalog`의 `foods`는 기존 응답 호환을 위한 예시입니다. 현재 Relay는 자료형·빈 값·원문 최대 200자만 검사하며 내용을 표준화하지 않습니다. 백엔드가 기존 구조화된 필드로 프롬프트를 구성하고 메뉴 값을 JSON으로 인용합니다.

이 변경으로 v0.3 R-19~R-21의 보호 수준과 차이가 생깁니다. 필드 허용목록과 학생 객체 차단은 유지되지만, R-19·R-21의 공개 식품 목록 대조 및 메뉴 값의 학년·반·전화번호 검사 단계는 제거됐습니다. R-20의 학생·가명 토큰 차단은 이 필드에서 서버가 강제할 수 없습니다. 인증된 클라이언트가 메뉴 값에 실명·학교명·전화번호·개인 알레르기 또는 지시문을 넣으면 그 텍스트가 Liner로 전달될 수 있습니다. 프롬프트에서 메뉴를 인용해도 개인정보 전송이나 모델의 지시문 해석을 막는 보안 경계가 되지는 않습니다.

FE의 기존 학생정보 분리 및 로컬 개인정보 검사에 의존합니다. 이번 BE 변경은 FE 저장 구조나 알레르기 안전 판단을 수정하지 않으며, 서버가 메뉴 출처나 실제 공개 여부를 독립 검증할 수 있다는 보장을 제공하지 않습니다.

## 범위 및 잔여 제약

문서 생성/PDF 업로드, 학생 DB/알레르기 규칙 엔진, 백업 UI는 FE 범위입니다. FE 수정 및 외부 배포는 하지 않았습니다. API 출력으로 내려준 manual 파일만 FE가 저장합니다.

단일 PC에서 공유 상태 파일을 사용해야 중복 방지가 성립합니다. 프로세스 강제 종료와 동시 요청은 테스트했지만 하드웨어 전원 손실, 네트워크 파일시스템, OneDrive 충돌/복원, 악의적 상태 파일 변조까지 보증하지 않습니다. UUID와 HMAC이 있는 상태 파일도 비식별 공개 데이터로 취급하지 않습니다.

도착 상태 API/웹훅은 구현하지 않았습니다. 이벤트 성공·수동 파일 생성·Mock 결과는 실수신이 아닙니다. 실제 수신 확인, 승인 템플릿/캠페인·고정 URL 검증, 실제 학교 연락처 처리의 제도적 검토는 후속 과제입니다.
