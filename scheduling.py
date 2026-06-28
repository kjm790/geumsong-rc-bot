"""
scheduling.py — N번째 요일 / 월말 날짜 계산

모든 날짜 계산은 '날짜(date)' 단위로 처리한다. (시각은 config.MEETING_HOUR 사용)
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta


def last_day_of_month(year: int, month: int) -> date:
    """해당 월의 말일(date)."""
    last = calendar.monthrange(year, month)[1]
    return date(year, month, last)


def is_last_day_of_month(d: date) -> bool:
    """주어진 날짜가 그 달의 말일인지."""
    return d == last_day_of_month(d.year, d.month)


def nth_weekday_of_month(year: int, month: int, weekday: int, nth: int) -> date | None:
    """
    해당 월의 'N번째 특정 요일' 날짜를 반환.
    weekday: 0=월 ... 6=일
    nth: 1=첫째 ... 5=다섯째
    해당 월에 그 요일이 nth번 존재하지 않으면 None.
    """
    # 그 달 1일의 요일
    first_weekday = calendar.monthrange(year, month)[0]  # 0=월
    # 첫 번째 해당 요일의 '일(day)'
    offset = (weekday - first_weekday) % 7
    day = 1 + offset + (nth - 1) * 7
    days_in_month = calendar.monthrange(year, month)[1]
    if day > days_in_month:
        return None
    return date(year, month, day)


def _add_month(year: int, month: int) -> tuple[int, int]:
    if month == 12:
        return year + 1, 1
    return year, month + 1


def meeting_date_for_month(year: int, month: int, weekday: int, nth: int) -> date:
    """
    해당 월의 정기모임 날짜.
    만약 그 달에 nth번째 요일이 없으면(예: 다섯째 요일이 없는 달) 마지막 해당 요일로 보정.
    """
    d = nth_weekday_of_month(year, month, weekday, nth)
    if d is not None:
        return d
    # nth가 그 달에 없으면, 존재하는 마지막(가장 큰 n)으로 대체
    for fallback in range(nth - 1, 0, -1):
        d = nth_weekday_of_month(year, month, weekday, fallback)
        if d is not None:
            return d
    # 이론상 도달 불가
    raise ValueError(f"{year}-{month} 에서 {weekday} 요일을 찾을 수 없습니다.")


def next_meeting_date(from_date: date, weekday: int, nth: int) -> date:
    """
    from_date(포함) 기준으로 가장 가까운 다가오는 정기모임 날짜.
    이번 달 모임이 이미 지났으면 다음 달 모임을 반환.
    """
    this_month = meeting_date_for_month(from_date.year, from_date.month, weekday, nth)
    if this_month >= from_date:
        return this_month
    ny, nm = _add_month(from_date.year, from_date.month)
    return meeting_date_for_month(ny, nm, weekday, nth)


def days_until(target: date, from_date: date) -> int:
    """from_date 에서 target 까지 남은 일수."""
    return (target - from_date).days


WEEKDAY_KR = ["월", "화", "수", "목", "금", "토", "일"]


def format_meeting_date(d: date, hour: int, minute: int = 0) -> str:
    """예: 2026년 7월 7일 (화) 19시 30분"""
    t = f"{hour}시" + (f" {minute}분" if minute else "")
    return f"{d.year}년 {d.month}월 {d.day}일 ({WEEKDAY_KR[d.weekday()]}) {t}"
