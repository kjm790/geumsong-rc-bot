"""
database.py — SQLite 데이터 계층 (회원 / 출석 / 행사)

행사(event_key)별로 출석을 따로 기록한다.
- members:    회원 등록 정보
- attendance: (event_key, meeting_date, user_id) 단위 출석 응답
- meetings:   (event_key, meeting_date) 단위 안내/리마인더 발송 메타(중복 방지)
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Seoul")


def _now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


class Database:
    def __init__(self, path: str):
        self.path = path
        self._init_schema()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS members (
                    user_id     INTEGER PRIMARY KEY,
                    username    TEXT,
                    full_name   TEXT,
                    is_active   INTEGER NOT NULL DEFAULT 1,
                    registered_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS meetings (
                    event_key    TEXT NOT NULL,
                    meeting_date TEXT NOT NULL,        -- ISO date (YYYY-MM-DD)
                    announced_at TEXT,
                    reminded_at  TEXT,
                    PRIMARY KEY (event_key, meeting_date)
                );

                CREATE TABLE IF NOT EXISTS attendance (
                    event_key    TEXT NOT NULL,
                    meeting_date TEXT NOT NULL,
                    user_id      INTEGER NOT NULL,
                    status       TEXT NOT NULL,        -- 'attend' | 'absent'
                    responded_at TEXT NOT NULL,
                    PRIMARY KEY (event_key, meeting_date, user_id),
                    FOREIGN KEY (user_id) REFERENCES members(user_id)
                );
                """
            )

    # ------------------------------------------------------------------ 회원
    def upsert_member(self, user_id: int, username: str | None, full_name: str) -> bool:
        """신규 등록이면 True, 기존 회원이면 False."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT user_id FROM members WHERE user_id = ?", (user_id,)
            ).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO members (user_id, username, full_name, is_active, registered_at) "
                    "VALUES (?, ?, ?, 1, ?)",
                    (user_id, username, full_name, _now_iso()),
                )
                return True
            conn.execute(
                "UPDATE members SET username = ?, full_name = ?, is_active = 1 WHERE user_id = ?",
                (username, full_name, user_id),
            )
            return False

    def get_active_members(self) -> list[sqlite3.Row]:
        with self._conn() as conn:
            return conn.execute(
                "SELECT user_id, username, full_name FROM members "
                "WHERE is_active = 1 ORDER BY full_name COLLATE NOCASE"
            ).fetchall()

    def count_active_members(self) -> int:
        with self._conn() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM members WHERE is_active = 1"
            ).fetchone()[0]

    # ----------------------------------------------------------------- 행사
    def ensure_meeting(self, event_key: str, meeting_date: date) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO meetings (event_key, meeting_date) VALUES (?, ?)",
                (event_key, meeting_date.isoformat()),
            )

    def mark_announced(self, event_key: str, meeting_date: date) -> None:
        self.ensure_meeting(event_key, meeting_date)
        with self._conn() as conn:
            conn.execute(
                "UPDATE meetings SET announced_at = ? WHERE event_key = ? AND meeting_date = ?",
                (_now_iso(), event_key, meeting_date.isoformat()),
            )

    def mark_reminded(self, event_key: str, meeting_date: date) -> None:
        self.ensure_meeting(event_key, meeting_date)
        with self._conn() as conn:
            conn.execute(
                "UPDATE meetings SET reminded_at = ? WHERE event_key = ? AND meeting_date = ?",
                (_now_iso(), event_key, meeting_date.isoformat()),
            )

    def is_announced(self, event_key: str, meeting_date: date) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT announced_at FROM meetings WHERE event_key = ? AND meeting_date = ?",
                (event_key, meeting_date.isoformat()),
            ).fetchone()
            return bool(row and row["announced_at"])

    def is_reminded(self, event_key: str, meeting_date: date) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT reminded_at FROM meetings WHERE event_key = ? AND meeting_date = ?",
                (event_key, meeting_date.isoformat()),
            ).fetchone()
            return bool(row and row["reminded_at"])

    # ---------------------------------------------------------------- 출석
    def record_attendance(self, event_key: str, meeting_date: date, user_id: int, status: str) -> bool:
        """'최초 응답'이면 True, 이미 응답한 적 있으면(상태 변경 포함) False."""
        self.ensure_meeting(event_key, meeting_date)
        with self._conn() as conn:
            row = conn.execute(
                "SELECT status FROM attendance WHERE event_key = ? AND meeting_date = ? AND user_id = ?",
                (event_key, meeting_date.isoformat(), user_id),
            ).fetchone()
            is_first = row is None
            conn.execute(
                "INSERT INTO attendance (event_key, meeting_date, user_id, status, responded_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(event_key, meeting_date, user_id) DO UPDATE SET "
                "status = excluded.status, responded_at = excluded.responded_at",
                (event_key, meeting_date.isoformat(), user_id, status, _now_iso()),
            )
            return is_first

    def get_attendance_summary(self, event_key: str, meeting_date: date) -> dict:
        """{'attend': [...], 'absent': [...], 'no_response': [...]}"""
        with self._conn() as conn:
            responses = conn.execute(
                "SELECT a.user_id, a.status, m.full_name, m.username "
                "FROM attendance a JOIN members m ON m.user_id = a.user_id "
                "WHERE a.event_key = ? AND a.meeting_date = ?",
                (event_key, meeting_date.isoformat()),
            ).fetchall()
            responded_ids = {r["user_id"] for r in responses}

            attend = [r for r in responses if r["status"] == "attend"]
            absent = [r for r in responses if r["status"] == "absent"]

            members = conn.execute(
                "SELECT user_id, full_name, username FROM members WHERE is_active = 1"
            ).fetchall()
            no_response = [m for m in members if m["user_id"] not in responded_ids]

        return {"attend": attend, "absent": absent, "no_response": no_response}

    def get_non_responders(self, event_key: str, meeting_date: date) -> list[sqlite3.Row]:
        return self.get_attendance_summary(event_key, meeting_date)["no_response"]
