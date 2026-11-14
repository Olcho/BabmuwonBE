# AGENTS.md — BabmuwonBE Codex 작업 규칙

## 우선순위
1. 본 저장소의 `docs/CODEX_TASK.md`를 읽는다.
2. 프로젝트 기준 문서는 **학교 급식 영양사 업무 자동화 기능명세서 v0.3** (2026-11-14)이다. 그 내용을 임의로 확장하지 않는다.
3. 기존에 사용자가 제공한 Relay v0.1 초안은 참고 코드다. 테스트되지 않은 실제 API 성공을 주장하지 않는다.
4. 기획 변경이 필요하면 README 및 PR에서 변경 근거를 명시한다. 프론트엔드 저장소는 수정하지 않는다.

## 프로젝트 경계
- Node.js + TypeScript 백엔드, 기본 개발 환경은 로컬 `127.0.0.1`.
- 기존 v0.1은 Node.js 내장 HTTP로 구현된 참고 초안이다. Express/Fastify 등 프레임워크를 추가해야 할 이유가 없다면 의존성을 최소화한다.
- 외부 API로 허용된 정형 필드만 전송. 브라우저에서 임의 프롬프트를 전달하는 범용 프록시 금지.
- 학생 실명, 학년-반-번호, 가명, 개별 알레르기, 보호자-학생 연결 정보가 **Liner**에 전달되면 안 된다.
- 학부모 전화번호는 알림톡 전송에만 필요한 개인정보다. Liner API/로그에 절대 기록하지 않는다.
- 시스템이 학생명 DB 전체를 갖고 있지 않으므로 형식 검증만으로 모든 재식별 위험을 차단할 수 있다고 주장하지 않는다.
- API 키 및 비밀정보는 서버 전용 환경변수로만 관리한다. `.env`와 원문 요청/응답 로그는 커밋 금지.
- 실제 Channel Talk 알림톡 전송은 **기본 비활성화**. Mock은 실제 도착으로 표시 금지.
- Channel Talk 이벤트 생성 성공은 알림톡 도착 성공이 아니다. 미확인 상태는 unknown 유지.
- 학생별 알레르기 안전판정은 프론트엔드 결정론적 규칙 엔진이 담당한다.
- 네트워크 장애에서 상태가 불명확한 이벤트 전송은 자동 재시도하지 않는다.

## API 계약
`POST /ai/s2-news`: month, menus[]
`POST /ai/nutrition`: topicId
`POST /ai/substitute-evidence`: allergenNo, foodName
`POST /ai/s5-body`: counts(소수 집계 병합)
`POST /send/alimtalk`: batchKey, month, recipients[{memberId,phone}]
추가 운영용 상태 조회/감사/재시도 경로는 별도 기록 후 구현할 수 있다.

## Git 운영
- main에 직접 작업하지 말고 `codex/relay-foundation` 등 새 브랜치로 작업한다.
- 기능 단위로 commit, 테스트 통과 후 Draft PR 작성.
- 임의의 실제 전화번호나 학생 데이터를 테스트에 넣지 않는다.
- 외부 서비스 계정/키가 없으면 성공을 가장하지 않고 Mock 및 pending 검증으로 분리한다.
- README에 로컬 실행, 환경변수, curl 예시, 테스트 결과, 미검증 조건을 남긴다.
- 완료 보고 시 변경 파일, 실행한 검증, 확인된 사실, 미검증 사항을 구분한다.
