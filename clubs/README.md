# 클럽별 배포 (멀티 클럽 구조)

```
gas/                 코어 — 전 클럽 공용. 클럽 이름·사람 이름을 쓰지 않는다. (.clasp.json 없음)
clubs/<club>/Club.js 클럽 프로필 — 클럽명·행사·직책·역대회장·회비·명부 등 클럽마다 다른 값 전부
clubs/<club>/.clasp.json  그 클럽의 GAS 프로젝트(scriptId)
tools/deploy.ps1     dist/<club>/ = gas/ + Club.js 로 합쳐 검증 후 clasp push
tools/golden.js      코어 수정 시 무회귀 검증(리팩터 전후 출력 비교)
```

클럽마다 **GAS 프로젝트·봇 토큰·데이터시트·Cloudflare Worker 가 따로**다. 코드만 공유하고 데이터(특히 회비·장부)는
물리적으로 분리되어 섞일 수 없다.

## 배포

```powershell
.\tools\deploy.ps1 geumsong            # 빌드 + 검증 + clasp push
.\tools\deploy.ps1 geumhyang -NoPush   # 빌드 + 검증만
```

웹앱(웹훅)은 고정 버전 배포이므로 push 후 `clasp create-version` → `clasp redeploy <deploymentId> --versionNumber N` (dist/<club> 에서 실행).
트리거(dailyCheck)는 HEAD 라 push 만으로 반영된다.

**코어를 고쳤으면 두 클럽 모두 배포**해야 버전이 어긋나지 않는다.

## 새 클럽 온보딩 체크리스트

1. `clubs/<club>/Club.js` 작성 (geumhyang 을 복사해 값만 교체)
2. 텔레그램 BotFather: `/newbot` → 토큰, `/setprivacy` → Disable. `Club.js` 의 `botUsername` 입력
3. 구글 공유드라이브 생성 → ID 를 Script Property `DRIVE_FOLDER_ID` 로
4. `clubs/<club>` 에서 `clasp create --type standalone --title "<클럽> AI사무장봇"` → 생긴 `.clasp.json` 을 그 폴더에 둔다
5. `.\tools\deploy.ps1 <club>`
6. GAS 에디터 > 프로젝트 설정 > 스크립트 속성: `BOT_TOKEN`, `ADMIN_IDS`, `DRIVE_FOLDER_ID` (단톡·임원방 ID 는 봇 초대 후 `/id` 로 확인해 `GROUP_CHAT_ID`, `OFFICER_CHAT_ID`)
7. 에디터에서 `setupDriveFolders` → `setup` 순서로 1회 실행 (표준 폴더 + 데이터시트 + 일일 트리거)
8. 웹앱 배포(액세스: 모든 사용자) → Cloudflare Worker(`cloudflare-worker.js`)에 /exec URL 연결 → `WEBHOOK_URL`=Worker URL → `setWebhook` 실행
   - Worker 프록시는 **처음부터** 둔다: GAS /exec 의 302 응답을 텔레그램이 실패로 보고 재시도해 봇이 멈추는 문제를 막는다.
9. 가입 절차에 "봇과 1:1 대화에서 /start" 를 포함 → 개인 안내(DM) 도달 보장
