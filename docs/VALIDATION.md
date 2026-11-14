# 검증 기록

검증일: 2026-11-15 (Asia/Seoul). 저장소: Olcho/BabmuwonBE. 브랜치: codex/relay-foundation.

## 로컬 실행 결과

환경: Windows, Node.js 22.16.0, npm 10.9.2, TypeScript 5.9.3. npm이 기본 PATH에 없어 저장소의 Git 제외 경로 `.tools/`에 공식 Node 배포본을 준비했습니다. 팀원은 일반 Node.js 22+ 설치 환경에서 README 명령을 그대로 실행할 수 있습니다.

| 명령 | 결과 |
| --- | --- |
| npm install --ignore-scripts | 개발 의존성 3개 설치, 당시 audit 0 vulnerabilities |
| npm run check | TypeScript noEmit 통과 |
| npm run build | TypeScript 컴파일 통과 |
| npm test | **65 tests, 65 pass, 0 fail, 0 skipped** |
| npm run smoke | 실제 server 진입점 시작 및 HTTP Mock 검사 통과 |
| git diff --check | 공백 오류 없음 |

스모크는 별도 임시 상태 저장소와 임의 포트를 사용합니다. health·AI 4종·로컬 승인·Mock 알림톡 요청·동일 배치 409를 확인하고 프로세스를 종료합니다. **외부 API 호출 수는 0**입니다.

처음 일반 샌드박스에서 실행한 HTTP 테스트는 localhost 연결 자체가 `EACCES`로 차단됐습니다. 로컬 루프백 연결을 허용한 실행 환경에서 다시 실행해 통과했습니다. 어댑터 테스트는 주입한 가짜 fetch/ChannelProvider만 사용하며 실제 공급자 URL에 통신하지 않습니다.

## 자동 테스트가 확인한 내용

- 5개 필수 API의 Mock 응답, simulated/reviewRequired/sourceMissing 및 출처 없음.
- 직접 HTTP 개인정보 우회 **30종** 모두 400 및 업스트림 호출 0회. 이름·학교명·가명·학년반·전화번호·학생 배열·자유 prompt·소수 집계 등을 포함합니다.
- 인증 누락/오류, Origin/Host, JSON 타입/크기/구문, 상속 속성 topicId, 잘못된 월/숫자/중복 수신자.
- 승인 전/식단 변경 후 발송 차단, 버전 감소 방지, 새 버전 정정 및 correctionNeeded.
- 동일 배치 동시 발송, 동시 재시도, 재시작 후 중복 409, 동일 버전 다른 템플릿 중복 차단.
- upsert 실패의 부분 재시도와 최대 3회, 시도 이력, 불명확 이벤트 재시도 차단.
- 별도 자식 프로세스 강제 종료 후 reserved/upsert/event 각각의 복구. 이벤트 전 실패만 재시도 가능.
- 상태 프로세스 독점 잠금, 손상 JSON/잘못된 버전/비객체 구조 시작 차단, 저장 실패 시 외부 호출 0회.
- 전화번호 원문/로컬 토큰 미저장, 공개 상태에 HMAC 없음, 감사 로그에 민감 본문 없음.
- Liner 요청 경로/헤더/모델/필드, UTF-8 청크 경계·SSE CRLF·댓글·출처, HTTP 200 data-error, 스트림 잘림, 오류 JSON·401·429·500·오프라인·타임아웃·초대형 응답.
- AI 캐시/동시 질의 병합, 초당 2회 미만 호출 시작, 오류 미캐시, 비밀정보 echo 차단.
- Channel Talk 최소 payload·/open/v5 경로·auth·event 응답 검사, 명시적 live opt-in 없이 실제 호출 차단.
- 수동 txt/csv 생성과 기록, 재시작 후 manual 유지, requested/uncertain 대상 자동·수동 재발송 차단.

개인정보 테스트는 이 요청 계약의 차단을 확인합니다. 모든 실학교 이름·재식별 위험에 대한 완전한 보호를 증명하는 테스트가 아닙니다.

## 외부 검증 현황

| 항목 | 확인 수준 |
| --- | --- |
| Liner Search/Router HTTP 계약 | 공식 문서 대조 + 모의 응답 테스트 |
| Channel upsert/event HTTP 계약 | 공식 문서 대조 + 모의 응답 테스트 |
| 실계정 Liner 응답/한국어 품질/요금 | **미검증** |
| 실계정 Channel 권한/경로/응답 | **미검증** |
| 이벤트→승인 알림톡 캠페인 및 변수 | **미검증** |
| 실제 카카오 수신 및 월별 재발송 | **미검증** |
| 결과 조회/웹훅 | 지원/계약 미검증, 구현하지 않음 |
| 고정 URL의 최신 S2·외부 배포 | 업로드/배포하지 않음 |

GitHub Actions에는 Node 22/24의 check/test/smoke 작업을 추가했습니다. 원격 실행 결과는 PR Checks에서 별도로 확인합니다. 로컬 통과를 원격 CI 통과나 실API 통과로 표현하지 않습니다.
