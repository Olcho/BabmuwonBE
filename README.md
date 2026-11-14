# BabmuwonBE | MAWD 급식 업무 자동화 백엔드

## 현재 상태
Codex 개발 착수를 위한 초기 저장소입니다. 이 저장소에는 아직 동작하는 서버 코드가 커밋되지 않았습니다. **실제 Liner 및 채널톡 연동, 카카오 알림톡 발송도 검증되지 않았습니다.**

- 기준: 학교 급식 영양사 업무 자동화 기능명세서 v0.3 (2026-11-14)
- 백엔드 범위: Node.js + TypeScript 로컬 Relay (외부 API 중계 서버)
- 프론트엔드: https://github.com/Olcho/BabmuwonFE (별도 팀원 담당)
- 학생 및 개별 알레르기 정보: 프론트엔드 IndexedDB에서 처리
- Relay 역할: Liner 및 채널톡 API 연동, 구조화 요청 검증, 외부 전송 통제, 발송 배치 상태 및 중복 차단

## Codex 시작
1. [AGENTS.md](AGENTS.md) 및 [개발 작업 지시서](docs/CODEX_TASK.md)를 먼저 읽습니다.
2. 별도 작업 브랜치를 생성하고, 요구사항 검증 및 테스트 가능한 최소 Relay부터 구현합니다.
3. 이미 별도로 제작된 `MAWD_backend_Relay_v0.1.zip` 출발 소스가 전달된다면 **검토 후 활용**합니다. 해당 ZIP은 아직 GitHub에 업로드되지 않았습니다.
4. `main` 직접 푸시는 피하고 Draft PR을 생성합니다.
5. `LINER_API_KEY`, `CHANNEL_ACCESS_SECRET` 등 비밀정보를 커밋하지 않습니다.

## API 범위 (v0.3)
- `POST /ai/s2-news`
- `POST /ai/nutrition`
- `POST /ai/substitute-evidence`
- `POST /ai/s5-body`
- `POST /send/alimtalk`

이 서버를 인터넷에 그대로 공개하면 안 됩니다. 로컬 기반 초기 구현과 Render 등 공개 배포는 보안, 인증, 영속성 요구가 다릅니다.
