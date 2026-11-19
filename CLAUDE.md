# 어투의 서재 — 업데이트 규칙

사용자가 이 앱을 실제 일기장으로 쓰면서 기능을 조금씩 업데이트합니다. **어떤 업데이트에서도 저장된 일기가 사라지면 안 됩니다.**

## 데이터 보존 (절대 규칙)
- localStorage 키 `eotu.v2.data`, `eotu.v2.cloud`, `eotu.v2.auth`, `eotu.v2.backup.*` 이름을 바꾸거나 지우지 말 것.
- 일기/설정 구조를 바꿀 때는 `js/storage.js`의 `DATA_VERSION`을 올리고 `migrate()`에 이전 → 새 구조 변환을 추가. 기존 필드는 삭제하지 말고 `normalizeDiary()`에 기본값을 둘 것.
- `localStorage.clear()`나 데이터 초기화 코드를 넣지 말 것.
- Supabase 테이블 `diary_rows` 구조를 바꾸면 README의 SQL도 함께 갱신.

## 배포 / 업데이트 절차
1. 기능 수정
2. `js/ui.js`의 `APP_VERSION`과 `sw.js`의 `CACHE`를 같은 새 버전으로 올림 (예: 2.1.0 → 2.2.0)
3. `sw.js`의 `SHELL`에 새 파일 추가했는지 확인
4. 같은 주소(도메인)에 다시 배포 — 주소가 바뀌면 그 기기의 로컬 일기가 보이지 않으므로 주소는 고정
5. 테스트: `.claude/launch.json`의 `diary` 서버 (PowerShell 정적 서버, 포트 5577)

## 구조
무빌드 HTML/CSS/Vanilla JS ES Modules. 진입점 `js/ui.js`. 스펙은 README.md 참고.
