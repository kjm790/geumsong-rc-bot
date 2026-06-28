# AI사무장봇 — 대구금송로타리클럽 출석 자동화

매월 정기모임 출석을 자동으로 조사·집계·보고하는 텔레그램 봇입니다.

- **스택**: Python 3.12 / python-telegram-bot[job-queue] 21+ / SQLite / python-dotenv
- 모든 사용자 메시지는 한국어

## 핵심 정기 행사 (각각 출석을 따로 집계)

| 행사 | 일정 |
|------|------|
| 정기모임 | 매월 **첫째 화요일 19:30** |
| 자유재활원 정기봉사 | 매월 **셋째 토요일 10:00** |

> 행사·시간은 `.env` 의 `EVENT1_*`, `EVENT2_*` 로 변경하며, `EVENT3_*` 처럼 더 추가할 수 있습니다.

## 주요 기능

1. **매월 말일** 단톡에 행사별 *명언 + 다음 일정 안내 + [✅참석][❌불참] 버튼* 자동 게시
2. 버튼 응답 시 동시에 — (a) SQLite 출석 기록 (b) 단톡 칭찬(최초 응답만) (c) 임원방 현황 보고
3. **각 행사 N일 전**, 미응답자에게 단톡 리마인더 자동 발송
4. 관리자 명령어: `/status` `/announce` `/remind` `/members` `/id` `/help`
5. 회원은 `/start` 또는 버튼 응답 시 **자동 등록**

## 파일 구성

| 파일 | 설명 |
|------|------|
| `bot.py` | 메인 (핸들러·JobQueue) |
| `config.py` | `.env` 로더 + 필수값 검증 |
| `database.py` | SQLite (회원/출석/모임) |
| `scheduling.py` | N번째 요일·월말 날짜 계산 |
| `quotes.py` | 명언·칭찬 문구 |
| `.env.example` | 설정 예시 (복사해서 `.env` 작성) |

## 설치

```powershell
cd C:\Users\kjm79\ai-samujang-bot
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # 이후 .env 값 채우기
```

## 실행

```powershell
py bot.py
```

## 정기 행사 일정 설정

`.env` 의 `EVENT*_` 값으로 조정합니다. (`WEEKDAY` 0=월 … 6=일, `NTH` 1=첫째 … 5=다섯째, `HOUR` 0~23, `MINUTE` 0~59)

```
EVENT1_NAME=정기모임
EVENT1_WEEKDAY=1   # 화요일
EVENT1_NTH=1       # 첫째
EVENT1_HOUR=19
EVENT1_MINUTE=30

EVENT2_NAME=자유재활원 정기봉사
EVENT2_WEEKDAY=5   # 토요일
EVENT2_NTH=3       # 셋째
EVENT2_HOUR=10
EVENT2_MINUTE=0
```

행사를 더 추가하려면 `EVENT3_*` 처럼 번호를 늘리면 됩니다.

## 스케줄 동작

`ANNOUNCE_HOUR` 시각에 매일 1회(Asia/Seoul) 점검 — 각 행사별로:
- 오늘이 **월말**이면 → 다음 행사 출석조사 발송 (중복 발송 방지)
- 오늘이 행사 **D-`REMINDER_DAYS_BEFORE`** 이면 → 미응답자 리마인더 (중복 방지)

즉시 실행이 필요하면 관리자가 `/announce`, `/remind` 로 수동 발송할 수 있습니다.
