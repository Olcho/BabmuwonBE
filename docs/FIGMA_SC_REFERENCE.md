# 2026-11-15 최신 Figma SC 참조 기준

## 읽어야 할 디자인
파일: https://www.figma.com/design/0tthHpF328T6snckPLzm9B/MAUD-4%ED%8C%80

**중요: 좌측 상단의 오래된 「화면 설계서 v0.1 (초안)」 (프레임 `9:56`)은 전체 제외한다. 화면 하단에 별도 배치된 새 SC-01 ~ SC-08 프레임만 최신 UI 기준으로 참고한다.**

- [SC-01 홈](https://www.figma.com/design/0tthHpF328T6snckPLzm9B/MAUD-4%ED%8C%80?node-id=26-525)
- [SC-02 학교 설정](https://www.figma.com/design/0tthHpF328T6snckPLzm9B/MAUD-4%ED%8C%80?node-id=26-705)
- [SC-03 학생 알레르기](https://www.figma.com/design/0tthHpF328T6snckPLzm9B/MAUD-4%ED%8C%80?node-id=26-788)
- [SC-04 식단 불러오기 확정](https://www.figma.com/design/0tthHpF328T6snckPLzm9B/MAUD-4%ED%8C%80?node-id=26-953)
- [SC-05 대체식 관리](https://www.figma.com/design/0tthHpF328T6snckPLzm9B/MAUD-4%ED%8C%80?node-id=26-1144)
- [SC-06 문서 만들기](https://www.figma.com/design/0tthHpF328T6snckPLzm9B/MAUD-4%ED%8C%80?node-id=26-1294)
- [SC-07 학부모 발송](https://www.figma.com/design/0tthHpF328T6snckPLzm9B/MAUD-4%ED%8C%80?node-id=26-1409)
- [SC-08 설정 외부 호출 기록](https://www.figma.com/design/0tthHpF328T6snckPLzm9B/MAUD-4%ED%8C%80?node-id=26-1550)

## 백엔드 관련 새 SC 화면 관찰 결과
- **SC-06:** S2 가정통신문 미리보기에서 Liner 출처 문구(승인됨) 및 Router 초안(미승인)을 별도로 표시하며, 승인 전 내보내기/발송을 막는 안내가 있다. 실제 데이터의 학생 식별 정보는 여전히 로컬 처리한다.
- **SC-07:** 채널톡 카카오 알림톡, 수신자 엑셀/직접 추가, 검수된 템플릿 미리보기, 문서 링크, 발송 기록, 수동 발송 파일. **SMS/LMS 화면은 폐기**.
- **SC-08:** 키 표시 UI, 외부 호출 기록, 차단 사유, 백업 및 복원 화면을 보여준다. **그러나 키를 이 기기에 저장하거나 학생명을 치환해 보낸다고 적은 문구는 아래 v0.3과 충돌한다. 이를 그대로 구현하지 않는다.**
- **SC-04:** 미리보기와 형식 오류가 보인다. 단, v0.3의 `unknown`/ `none_confirmed` 상태 처리 규칙은 시안에 충분히 표현되지 않아도 반드시 구현해야 한다.
- **SC-05:** 대체식 후보와 Liner 근거 확인. AI는 근거 검색 전용이며 알레르기 안전 판정에는 사용하지 않는다.

## 최신 기능명세서 v0.3과 상충하는 부분 (Codex 및 FE 협업 시 필수 확인)
1. **SC-08 API 키 표시 vs v0.3 8장:** 새 SC-08 화면에 'Liner API 키', '채널톡 키', '키는 이 기기에만 저장'이 있으나 v0.3에는 **브라우저 API 키 입력 없음**, Relay `.env`에서만 관리. BE 구현 기준은 v0.3. 프론트엔드에는 Relay 연결 상태/호출 로그 위주로 구현하도록 전달한다.
2. **SC-08 치환 설명 vs v0.3 R-19~R-21:** '실명/학교명/학년반을 [학생1]/[학교]/[학년반]으로 바꿔 보낸다'는 문구는 **학생 개인 데이터를 외부 AI에 보내지 않는 구조**와 충돌. 단순 치환으로 전송 허용하지 말고 정형 필드만 허용한다. 학생 토큰도 외부 AI 전송 금지.
3. **SC-07 수정 가능 항목 vs v0.3 F5-1/F5-2:** 화면에는 학교명, 월, 링크 변경 가능이라고 표시되지만 v0.3의 알림톡 템플릿은 **학교명 고정, month 변수만 사용, 웹 버튼 URL 고정**을 전제로 한다. 검수된 템플릿에서 실제로 허용된 변수와 버튼 링크만 사용할 것. UI상 편집 가능 안내는 팀과 확인해야 한다.
4. **SC-07 성공/실패 수치 vs v0.3 R-28:** 화면에 성공 3, 실패 0이 보이지만 채널톡 이벤트 생성 성공이 실제 알림톡 도착을 증명하지 않는다. 백엔드는 `requestStatus`와 `deliveryStatus` 구분, 미확인은 `unknown`으로 유지한다.
5. **SC-01/08 하단 '모든 데이터는 이 기기에만 저장' 표기:** 채널톡에는 발송용 보호자 전화번호가 실제 전송된다. '학생별 알레르기 정보는 로컬 유지'와 '알림톡 수신자 정보는 채널톡에 전송'을 구별해야 한다.

## 우선순위 및 개발 원칙
- **프로덕트 업무 규칙 및 데이터 처리:** 기능명세서 **v0.3 최종본** 우선.
- **UI 레이아웃과 사용자 작업 흐름:** 이 문서에 열거한 **새 SC 프레임** 기준.
- 양쪽이 충돌하면 임의로 UI 동작을 맞추지 말고 개발 리스크를 표시하고, 실제 백엔드는 v0.3 안전 규칙을 준수한다.
- GitHub FE `Olcho/BabmuwonFE`의 코드와 Figma 원본은 이 작업에서 수정하지 않는다.
- 실제 API 사용, 알림톡 도착 검증, 수신자 정보 처리의 적법성은 별도 확인이 필요하다.

## BE와 연동되는 화면
- SC-05 → `POST /ai/substitute-evidence`
- SC-06 → `POST /ai/s2-news`, `POST /ai/nutrition`, `POST /ai/s5-body`
- SC-07 → `POST /send/alimtalk` 및 상태 조회 (별도 인터페이스 문서 필요)
- SC-08 → Relay 상태 조회/감사 기록 화면 (API 키 값을 프론트엔드에 반환 금지)
