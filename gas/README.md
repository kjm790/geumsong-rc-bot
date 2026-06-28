# AI사무장봇 (GAS 버전) — 국제로타리 3700지구 대구금송로타리클럽

Google Apps Script + 웹훅으로 **Google 서버에서 24시간** 구동되는 출석 자동화 봇.
PC를 켜둘 필요 없이, 기존 클럽 봇들(GAS/clasp)과 동일한 방식으로 동작합니다.

- **버튼 응답**: 웹훅(`doPost`)으로 즉시 처리
- **월말 공지·리마인더**: 시간 기반 트리거(`dailyCheck`, 매일 1회)
- **데이터 저장**: Google Sheets (members / attendance / meetings)

## 등록 행사

### ① 정기 행사 (`kind: recurring` — 출석 버튼/집계/리마인더)
| 행사 | 일정 | (JS 요일) |
|------|------|-----------|
| 정기모임 | 매월 **첫째 화요일 19:30** | weekday 2, nth 1 |
| 자유재활원 정기봉사 | 매월 **셋째 토요일 10:00** | weekday 6, nth 3 |

- 7월 정기모임은 **정기총회**, 12월 정기모임은 **연차총회(차기 회장·임원 선출)** 로 공지에 자동 표기.
- 공지에 **회기 라벨**(예: `2026-27`) 자동 표기.

### ② 동호회 행사 (`kind: monthly_notice` — 시각 미지정, 안내만)
시각이 정해지지 않고 **정기모임에서 익월 행사를 구두 공지**하는 구조라, 출석 집계 없이
**정기모임 공지문 하단에 "다음 달 동호회 행사"** 로 자동 안내됩니다.

| 동호회 | 진행 월 / 내용 |
|--------|----------------|
| 골프회 | 7월 스크린골프 · 9월 정기라운딩 · 11월 정기라운딩 · 1월 스크린골프 · 3월 정기라운딩 · 5월 골프회장배 |
| 문화레저동호회 | 8·10·12·2·4월 — 전 회원 대상(음악회·미술관·영화·강연·스포츠 중) |

> 행사·시간·내용은 `Config.js` 의 `EVENTS` 에서 수정합니다. **recurring 의 요일은 JS 기준(0=일·1=월·2=화 … 6=토)**.
> 동호회 행사는 `activities`(월→내용) 또는 `months`+`activity` 로 정의합니다.

## 파일

| 파일 | 설명 |
|------|------|
| `Code.js` | 웹훅·명령·버튼·`dailyCheck`·`setup` |
| `Config.js` | 행사 정의(EVENTS)·설정·Script Properties 접근 |
| `Scheduling.js` | N번째 요일·월말 계산 |
| `Sheets.js` | Google Sheets 데이터 계층 |
| `Telegram.js` | Bot API 호출·웹훅 관리 |
| `Quotes.js` | 명언·칭찬 문구 |
| `appsscript.json` | 매니페스트(시간대 Asia/Seoul, 웹앱 익명 접근) |

## Script Properties (프로젝트 설정 → 스크립트 속성)

| 키 | 필수 | 설명 |
|----|------|------|
| `BOT_TOKEN` | ✅ | BotFather 토큰 |
| `GROUP_CHAT_ID` | ✅ | 클럽 단톡 chat ID (음수) |
| `ADMIN_IDS` | ✅ | 관리자 user ID, 쉼표 구분 |
| `OFFICER_CHAT_ID` | – | 임원 보고방 chat ID (없으면 보고 생략) |
| `SHEET_ID` | 자동 | `setup()` 이 생성·기록 |
| `WEBHOOK_URL` | ✅(배포 후) | 웹앱 `/exec` URL |
| `DRIVE_FOLDER_ID` | – | 데이터 시트를 만들 공유드라이브 폴더 ID |

## 설치 순서

### 1. 코드 업로드 (clasp)
```powershell
cd C:\Users\kjm79\ai-samujang-bot\gas
clasp login                # 브라우저 로그인 (1회)
clasp create-script --title "대구금송RC AI사무장봇" --type standalone
clasp push -f              # 6개 .js + appsscript.json 업로드
clasp open-script          # 편집기 열기
```

### 2. 스크립트 속성 입력 (편집기)
프로젝트 설정(⚙️) → **스크립트 속성** → 다음 추가:
- `BOT_TOKEN` = (BotFather 토큰)
- `GROUP_CHAT_ID` = `-1` (임시 — 3-④에서 교체)
- `ADMIN_IDS` = `1` (임시 — 3-④에서 교체)
- (선택) `DRIVE_FOLDER_ID` = `0AHr1ac6OYt5zUk9PVA` (금송RC 공유드라이브)

### 3. 초기화 + 점검 (편집기에서 함수 실행)
- `setup` 실행 → 권한 승인 → 실행 로그에서 **SHEET_ID·시트 URL** 확인
  (Sheets 3종 생성 + 매일 `dailyCheck` 트리거 등록)
- `testScheduling_` 실행 → 로그에 `=== 전체 통과 ===` 확인

### 4. 웹앱 배포 + 웹훅 연결
1. 편집기 우상단 **배포 → 새 배포 → 유형: 웹 앱**
   - 실행 계정: **나**, 액세스: **모든 사용자**(익명 포함) → 배포
2. **웹 앱 URL**(`.../exec`) 복사
3. 스크립트 속성에 `WEBHOOK_URL` = 그 URL 추가
4. 편집기에서 `setWebhook` 실행 → 로그에 `"ok":true` 확인

### 5. BotFather 그룹 권한
@BotFather → `/setprivacy` → 봇 선택 → **Disable**
(그룹에서 `/id` 등 명령을 받으려면 필요. 버튼은 권한과 무관하게 동작)

### 6. chat ID 채우기
봇을 단톡·임원방에 초대 후, 각 방에서 **`/id`** 입력(텔레그램 앱에서!) →
표시된 값으로 스크립트 속성 `GROUP_CHAT_ID`·`OFFICER_CHAT_ID`·`ADMIN_IDS` 교체.
(속성은 저장 즉시 반영 — 재배포 불필요)

### 7. 동작 점검
- 관리자 1:1에서 `/help` → 관리자 메뉴 + 두 행사 일정
- `/announce` → 단톡에 두 행사 안내문(버튼 포함) 게시
- 버튼 `✅참석` → 토스트 + 단톡 칭찬 1회 + 임원방 현황 보고
- `/status` → 행사별 참석/불참/미응답 집계

## 코드 수정 후 반영
- `clasp push -f` 로 업로드 → **배포 → 배포 관리 → (기존 배포) 편집 → 버전: 새 버전 → 배포**
  (웹앱 URL은 그대로 유지됩니다. `clasp redeploy <deploymentId>` 로도 가능)
- `Config.js`/문구 등 트리거·웹훅 로직과 무관한 변경도 웹앱은 배포된 버전을 쓰므로 재배포 필요.

---
※ 같은 봇의 Python(폴링) 버전이 상위 폴더에 있습니다. GAS 버전을 쓰면 그쪽은 실행하지 않아도 됩니다.
（두 버전을 동시에 켜면 충돌하니 하나만 사용하세요. 폴링↔웹훅은 `deleteWebhook`/`setWebhook` 로 전환.）
