"""
config.py — .env 로더 및 필수값 검증

대구금송로타리클럽 'AI사무장봇' 설정 모듈.
정기 행사(EVENT)를 여러 개 지원한다. 기본 2개:
  - 정기모임          : 첫째 화요일 19:30
  - 자유재활원 정기봉사 : 셋째 토요일 10:00
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()

TZ = ZoneInfo("Asia/Seoul")

WEEKDAY_KR = ["월", "화", "수", "목", "금", "토", "일"]
NTH_KR = ["", "첫째", "둘째", "셋째", "넷째", "다섯째"]


class ConfigError(Exception):
    """설정값이 잘못되었거나 누락되었을 때 발생."""


def _get_str(name: str, default: str | None = None, required: bool = False) -> str | None:
    value = os.getenv(name)
    if value is not None:
        value = value.strip()
    if not value:
        if required:
            raise ConfigError(f"[.env 오류] 필수 항목 '{name}' 이(가) 비어 있습니다.")
        return default
    return value


def _get_int(name: str, default: int | None = None, required: bool = False) -> int | None:
    raw = _get_str(name, required=required)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"[.env 오류] '{name}' 은(는) 정수여야 합니다. 현재값: {raw!r}") from exc


def _get_bool(name: str, default: bool) -> bool:
    raw = _get_str(name)
    if raw is None:
        return default
    return raw.lower() in ("1", "true", "yes", "y", "on", "참", "예")


def _get_int_list(name: str) -> list[int]:
    raw = _get_str(name)
    if not raw:
        return []
    result: list[int] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            result.append(int(chunk))
        except ValueError as exc:
            raise ConfigError(
                f"[.env 오류] '{name}' 의 값 {chunk!r} 은(는) 정수가 아닙니다. (쉼표로 구분된 ID 목록)"
            ) from exc
    return result


@dataclass
class Event:
    """반복되는 정기 행사 하나."""
    key: str        # 콜백/DB 식별자 (예: event1) — 콜론·공백 없는 영숫자
    name: str       # 표시명 (예: 정기모임)
    weekday: int    # 0=월 ... 6=일
    nth: int        # 1=첫째 ... 5=다섯째
    hour: int       # 0~23
    minute: int = 0 # 0~59

    @property
    def weekday_name(self) -> str:
        return WEEKDAY_KR[self.weekday]

    @property
    def nth_name(self) -> str:
        return NTH_KR[self.nth] if 1 <= self.nth < len(NTH_KR) else f"{self.nth}번째"

    def schedule_text(self) -> str:
        t = f"{self.hour}시" + (f" {self.minute}분" if self.minute else "")
        return f"매월 {self.nth_name} {self.weekday_name}요일 {t}"


# .env 에 EVENT* 가 하나도 없을 때 사용할 기본 핵심 행사 2종
DEFAULT_EVENTS = [
    Event(key="event1", name="정기모임", weekday=1, nth=1, hour=19, minute=30),
    Event(key="event2", name="자유재활원 정기봉사", weekday=5, nth=3, hour=10, minute=0),
]


@dataclass
class Config:
    bot_token: str
    group_chat_id: int
    officer_chat_id: int | None
    admin_ids: list[int]
    events: list[Event]

    announce_hour: int = 10
    reminder_days_before: int = 3

    praise_in_group: bool = True
    report_to_officers: bool = True

    db_path: str = "samujang.db"

    def event_by_key(self, key: str) -> Event | None:
        for e in self.events:
            if e.key == key:
                return e
        return None

    def schedule_summary(self) -> str:
        return " / ".join(f"{e.name}({e.schedule_text()})" for e in self.events)


def _validate_event(e: Event) -> None:
    if not (0 <= e.weekday <= 6):
        raise ConfigError(f"[.env 오류] {e.key} 의 WEEKDAY 는 0~6 (0=월..6=일). 현재값: {e.weekday}")
    if not (1 <= e.nth <= 5):
        raise ConfigError(f"[.env 오류] {e.key} 의 NTH 는 1~5. 현재값: {e.nth}")
    if not (0 <= e.hour <= 23):
        raise ConfigError(f"[.env 오류] {e.key} 의 HOUR 는 0~23. 현재값: {e.hour}")
    if not (0 <= e.minute <= 59):
        raise ConfigError(f"[.env 오류] {e.key} 의 MINUTE 는 0~59. 현재값: {e.minute}")


def _load_events() -> list[Event]:
    """EVENT1_*, EVENT2_*, ... 를 순서대로 읽는다. 하나도 없으면 DEFAULT_EVENTS."""
    events: list[Event] = []
    i = 1
    while True:
        prefix = f"EVENT{i}_"
        weekday = _get_int(prefix + "WEEKDAY")
        if weekday is None:
            break
        name = _get_str(prefix + "NAME", default=f"행사{i}")
        nth = _get_int(prefix + "NTH", default=1)
        hour = _get_int(prefix + "HOUR", default=19)
        minute = _get_int(prefix + "MINUTE", default=0)
        e = Event(key=f"event{i}", name=name, weekday=weekday, nth=nth, hour=hour, minute=minute)
        _validate_event(e)
        events.append(e)
        i += 1
    if not events:
        return list(DEFAULT_EVENTS)
    return events


def load_config() -> Config:
    bot_token = _get_str("BOT_TOKEN", required=True)
    group_chat_id = _get_int("GROUP_CHAT_ID", required=True)
    officer_chat_id = _get_int("OFFICER_CHAT_ID", default=None)
    admin_ids = _get_int_list("ADMIN_IDS")
    events = _load_events()

    announce_hour = _get_int("ANNOUNCE_HOUR", default=10)
    reminder_days_before = _get_int("REMINDER_DAYS_BEFORE", default=3)

    praise_in_group = _get_bool("PRAISE_IN_GROUP", default=True)
    report_to_officers = _get_bool("REPORT_TO_OFFICERS", default=True)
    db_path = _get_str("DB_PATH", default="samujang.db")

    if not (0 <= announce_hour <= 23):
        raise ConfigError(f"[.env 오류] ANNOUNCE_HOUR 는 0~23. 현재값: {announce_hour}")
    if reminder_days_before < 0:
        raise ConfigError(f"[.env 오류] REMINDER_DAYS_BEFORE 는 0 이상. 현재값: {reminder_days_before}")
    if group_chat_id >= 0:
        print(f"[경고] GROUP_CHAT_ID({group_chat_id}) 가 음수가 아닙니다. 그룹 chat ID 가 맞는지 확인하세요.")

    return Config(
        bot_token=bot_token,
        group_chat_id=group_chat_id,
        officer_chat_id=officer_chat_id,
        admin_ids=admin_ids,
        events=events,
        announce_hour=announce_hour,
        reminder_days_before=reminder_days_before,
        praise_in_group=praise_in_group,
        report_to_officers=report_to_officers,
        db_path=db_path,
    )
