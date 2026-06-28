"""
bot.py — 대구금송로타리클럽 'AI사무장봇' 메인

핵심 정기 행사 2종(각각 출석을 따로 기록):
  - 정기모임          : 첫째 화요일 19:30
  - 자유재활원 정기봉사 : 셋째 토요일 10:00
(행사·시간은 .env 의 EVENT* 로 변경 가능)

기능
1. 매월 말일, 단톡에 행사별 "명언 + 다음 일정 안내 + [✅참석][❌불참]" 자동 게시
2. 버튼 응답 → (a) SQLite 기록 (b) 단톡 칭찬(최초 응답만) (c) 임원방 현황 보고
3. 각 행사 D-N일 전, 미응답자에게 단톡 리마인더
4. 관리자: /status /announce /remind /members /id /help
5. 회원 /start 또는 버튼 응답 시 자동 등록
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
)

import quotes
import scheduling
from config import TZ, Config, ConfigError, Event, load_config
from database import Database

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("samujang")


# ─────────────────────────────────────────────────────────── 공통 헬퍼
def get_cfg(context: ContextTypes.DEFAULT_TYPE) -> Config:
    return context.application.bot_data["cfg"]


def get_db(context: ContextTypes.DEFAULT_TYPE) -> Database:
    return context.application.bot_data["db"]


def today() -> date:
    return datetime.now(TZ).date()


def is_admin(cfg: Config, user_id: int) -> bool:
    return user_id in cfg.admin_ids


def display_name(full_name: str | None, username: str | None) -> str:
    if full_name:
        return full_name
    if username:
        return f"@{username}"
    return "회원"


def event_next_date(event: Event) -> date:
    return scheduling.next_meeting_date(today(), event.weekday, event.nth)


def event_when(event: Event, d: date) -> str:
    return scheduling.format_meeting_date(d, event.hour, event.minute)


def attendance_keyboard(event: Event, meeting: date) -> InlineKeyboardMarkup:
    # 콜백 데이터에 행사키·날짜를 실어 응답이 정확히 어느 행사인지 식별
    base = f"att:{event.key}:{meeting.isoformat()}"
    return InlineKeyboardMarkup(
        [[
            InlineKeyboardButton("✅ 참석", callback_data=f"{base}:attend"),
            InlineKeyboardButton("❌ 불참", callback_data=f"{base}:absent"),
        ]]
    )


def build_announcement(event: Event, meeting: date) -> str:
    q = quotes.quote_for_month(meeting.year, meeting.month)
    when = event_when(event, meeting)
    return (
        f"💬 <b>이달의 한마디</b>\n<i>{q}</i>\n\n"
        f"📅 <b>{event.name} 안내</b>\n"
        f"• 일시: <b>{when}</b>\n\n"
        f"참석 여부를 아래 버튼으로 알려주세요. 🙏\n"
        f"(버튼을 누르면 자동으로 출석이 기록됩니다.)"
    )


def summary_text(event: Event, meeting: date, summary: dict) -> str:
    when = event_when(event, meeting)
    attend, absent, no_resp = summary["attend"], summary["absent"], summary["no_response"]
    total = len(attend) + len(absent) + len(no_resp)

    def names(rows) -> str:
        if not rows:
            return "  (없음)"
        return "\n".join(f"  • {display_name(r['full_name'], r['username'])}" for r in rows)

    return (
        f"📊 <b>{event.name} 출석 현황</b>\n"
        f"🗓 {when}\n"
        f"전체 {total}명 — 참석 {len(attend)} · 불참 {len(absent)} · 미응답 {len(no_resp)}\n\n"
        f"✅ <b>참석 ({len(attend)})</b>\n{names(attend)}\n\n"
        f"❌ <b>불참 ({len(absent)})</b>\n{names(absent)}\n\n"
        f"❔ <b>미응답 ({len(no_resp)})</b>\n{names(no_resp)}"
    )


# ─────────────────────────────────────────────────────────── 핵심 동작
async def send_announcement(context: ContextTypes.DEFAULT_TYPE, event: Event, meeting: date) -> None:
    cfg = get_cfg(context)
    db = get_db(context)
    await context.bot.send_message(
        chat_id=cfg.group_chat_id,
        text=build_announcement(event, meeting),
        parse_mode=ParseMode.HTML,
        reply_markup=attendance_keyboard(event, meeting),
    )
    db.mark_announced(event.key, meeting)
    logger.info("출석조사 발송: %s %s", event.name, meeting.isoformat())

    if cfg.report_to_officers and cfg.officer_chat_id:
        await context.bot.send_message(
            chat_id=cfg.officer_chat_id,
            text=f"📣 {event.name} ({event_when(event, meeting)}) 출석조사를 단톡에 발송했습니다.",
        )


async def send_reminder(context: ContextTypes.DEFAULT_TYPE, event: Event, meeting: date) -> int:
    cfg = get_cfg(context)
    db = get_db(context)
    non_resp = db.get_non_responders(event.key, meeting)
    if not non_resp:
        logger.info("리마인더: %s 미응답자 없음", event.name)
        return 0

    names = ", ".join(display_name(r["full_name"], r["username"]) for r in non_resp)
    text = (
        f"⏰ <b>{event.name} 참석 여부 회신 부탁드립니다</b>\n"
        f"🗓 {event_when(event, meeting)} 일정이 곧 다가옵니다.\n\n"
        f"아직 회신하지 않으신 {len(non_resp)}분: {names}\n\n"
        f"아래 버튼으로 참석 여부를 알려주세요. 🙏"
    )
    await context.bot.send_message(
        chat_id=cfg.group_chat_id,
        text=text,
        parse_mode=ParseMode.HTML,
        reply_markup=attendance_keyboard(event, meeting),
    )
    db.mark_reminded(event.key, meeting)
    logger.info("리마인더 발송: %s %s, 미응답 %d명", event.name, meeting.isoformat(), len(non_resp))
    return len(non_resp)


# ─────────────────────────────────────────────────────────── 버튼 핸들러
async def on_attendance_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cfg = get_cfg(context)
    db = get_db(context)
    query = update.callback_query
    user = query.from_user

    # 콜백: att:<event_key>:<iso>:<status>
    try:
        _, event_key, iso, status = query.data.split(":")
        meeting = date.fromisoformat(iso)
    except ValueError:
        await query.answer("잘못된 요청입니다.")
        return

    event = cfg.event_by_key(event_key)
    if event is None:
        await query.answer("알 수 없는 행사입니다.")
        return

    status_kr = "참석" if status == "attend" else "불참"

    full_name = user.full_name or (user.first_name or "")
    db.upsert_member(user.id, user.username, full_name)  # 자동 등록

    db.ensure_meeting(event_key, meeting)
    is_first = db.record_attendance(event_key, meeting, user.id, status)

    await query.answer(f"{event.name} {status_kr}(으)로 기록했습니다. 감사합니다!")

    name = display_name(full_name, user.username)

    # (b) 단톡 칭찬 — 최초 응답 시에만
    if cfg.praise_in_group and is_first:
        praise = quotes.praise_message(name, status, seed=user.id)
        await context.bot.send_message(chat_id=cfg.group_chat_id, text=f"[{event.name}] {praise}")

    # (c) 임원방 현황 보고
    if cfg.report_to_officers and cfg.officer_chat_id:
        summary = db.get_attendance_summary(event_key, meeting)
        await context.bot.send_message(
            chat_id=cfg.officer_chat_id,
            text=f"🔔 {name} 님 → {event.name} {status_kr}\n\n" + summary_text(event, meeting, summary),
            parse_mode=ParseMode.HTML,
        )


# ─────────────────────────────────────────────────────────── 명령어 핸들러
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    db = get_db(context)
    user = update.effective_user
    full_name = user.full_name or (user.first_name or "")
    is_new = db.upsert_member(user.id, user.username, full_name)
    name = display_name(full_name, user.username)
    if is_new:
        msg = (
            f"환영합니다, {name} 님! 🎉\n"
            f"대구금송로타리클럽 <b>AI사무장봇</b>에 회원으로 등록되었습니다.\n"
            f"앞으로 정기모임·봉사활동 출석 안내를 보내드리겠습니다."
        )
    else:
        msg = f"{name} 님, 이미 등록되어 있습니다. 반갑습니다! 🙌"
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML)


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cfg = get_cfg(context)
    user_is_admin = is_admin(cfg, update.effective_user.id)
    common = (
        "🤖 <b>AI사무장봇 도움말</b>\n"
        "대구금송로타리클럽 정기모임·봉사 출석을 도와드립니다.\n\n"
        "• /start — 회원 등록\n"
        "• /id — 이 대화방의 chat ID 확인\n"
        "• /help — 도움말\n"
    )
    admin = (
        "\n<b>관리자 전용</b>\n"
        "• /status — 다가오는 행사별 출석 현황\n"
        "• /announce — 지금 즉시 출석조사 발송(전체 행사)\n"
        "• /remind — 지금 즉시 미응답자 리마인더(전체 행사)\n"
        "• /members — 등록 회원 목록\n"
    )
    lines = "\n".join(f"• {e.name}: <b>{e.schedule_text()}</b>" for e in cfg.events)
    schedule_info = f"\n📅 등록된 정기 일정\n{lines}"
    text = common + (admin if user_is_admin else "") + schedule_info
    await update.message.reply_text(text, parse_mode=ParseMode.HTML)


async def cmd_id(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    user = update.effective_user
    kind = {"private": "개인 대화", "group": "그룹", "supergroup": "슈퍼그룹", "channel": "채널"}.get(
        chat.type, chat.type
    )
    await update.message.reply_text(
        f"🆔 <b>ID 정보</b>\n"
        f"• 이 대화방(chat) ID: <code>{chat.id}</code>  ({kind})\n"
        f"• 당신의 user ID: <code>{user.id}</code>\n\n"
        f"※ 단톡 → GROUP_CHAT_ID, 임원방 → OFFICER_CHAT_ID,\n"
        f"   본인 user ID → ADMIN_IDS 에 넣으세요.",
        parse_mode=ParseMode.HTML,
    )


def _require_admin(update: Update, cfg: Config) -> bool:
    return is_admin(cfg, update.effective_user.id)


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cfg = get_cfg(context)
    db = get_db(context)
    if not _require_admin(update, cfg):
        await update.message.reply_text("관리자만 사용할 수 있는 명령입니다.")
        return
    blocks = []
    for event in cfg.events:
        meeting = event_next_date(event)
        summary = db.get_attendance_summary(event.key, meeting)
        blocks.append(summary_text(event, meeting, summary))
    await update.message.reply_text("\n\n──────────\n\n".join(blocks), parse_mode=ParseMode.HTML)


async def cmd_announce(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cfg = get_cfg(context)
    if not _require_admin(update, cfg):
        await update.message.reply_text("관리자만 사용할 수 있는 명령입니다.")
        return
    sent = []
    for event in cfg.events:
        meeting = event_next_date(event)
        await send_announcement(context, event, meeting)
        sent.append(f"{event.name} ({event_when(event, meeting)})")
    await update.message.reply_text("✅ 출석조사를 단톡에 발송했습니다.\n• " + "\n• ".join(sent))


async def cmd_remind(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cfg = get_cfg(context)
    if not _require_admin(update, cfg):
        await update.message.reply_text("관리자만 사용할 수 있는 명령입니다.")
        return
    results = []
    for event in cfg.events:
        meeting = event_next_date(event)
        count = await send_reminder(context, event, meeting)
        results.append(f"{event.name}: " + ("미응답 없음" if count == 0 else f"{count}명에게 발송"))
    await update.message.reply_text("✅ 리마인더 처리 결과\n• " + "\n• ".join(results))


async def cmd_members(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    cfg = get_cfg(context)
    db = get_db(context)
    if not _require_admin(update, cfg):
        await update.message.reply_text("관리자만 사용할 수 있는 명령입니다.")
        return
    members = db.get_active_members()
    if not members:
        await update.message.reply_text("아직 등록된 회원이 없습니다.")
        return
    lines = [
        f"{i}. {display_name(m['full_name'], m['username'])}"
        + (f" (@{m['username']})" if m["username"] and m["full_name"] else "")
        for i, m in enumerate(members, 1)
    ]
    await update.message.reply_text(
        f"👥 <b>등록 회원 {len(members)}명</b>\n" + "\n".join(lines),
        parse_mode=ParseMode.HTML,
    )


# ─────────────────────────────────────────────────────────── 일일 스케줄 점검
async def daily_check(context: ContextTypes.DEFAULT_TYPE) -> None:
    """매일 1회: 월말이면 각 행사 출석조사, 행사 D-N이면 리마인더."""
    cfg = get_cfg(context)
    db = get_db(context)
    d = today()
    month_end = scheduling.is_last_day_of_month(d)

    for event in cfg.events:
        meeting = scheduling.next_meeting_date(d, event.weekday, event.nth)

        # 1) 월말 → 다음 행사 출석조사 (중복 방지)
        if month_end and not db.is_announced(event.key, meeting):
            logger.info("월말 감지 → %s 출석조사", event.name)
            await send_announcement(context, event, meeting)

        # 2) D-N → 리마인더 (중복 방지)
        days_left = scheduling.days_until(meeting, d)
        if days_left == cfg.reminder_days_before and not db.is_reminded(event.key, meeting):
            logger.info("D-%d 감지 → %s 리마인더", cfg.reminder_days_before, event.name)
            await send_reminder(context, event, meeting)


# ─────────────────────────────────────────────────────────── 부트스트랩
def build_application(cfg: Config) -> Application:
    app = Application.builder().token(cfg.bot_token).build()
    app.bot_data["cfg"] = cfg
    app.bot_data["db"] = Database(cfg.db_path)

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("id", cmd_id))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("announce", cmd_announce))
    app.add_handler(CommandHandler("remind", cmd_remind))
    app.add_handler(CommandHandler("members", cmd_members))
    app.add_handler(CallbackQueryHandler(on_attendance_button, pattern=r"^att:"))

    app.job_queue.run_daily(
        daily_check,
        time=time(hour=cfg.announce_hour, minute=0, tzinfo=TZ),
        name="daily_check",
    )
    return app


def main() -> None:
    try:
        cfg = load_config()
    except ConfigError as e:
        print(str(e))
        print("→ .env 파일을 확인하세요. (.env.example 참고)")
        raise SystemExit(1)

    logger.info("AI사무장봇 시작 — 일정: %s, 매일 점검 %02d시", cfg.schedule_summary(), cfg.announce_hour)
    logger.info("관리자 %d명, 단톡 %s, 임원방 %s",
                len(cfg.admin_ids), cfg.group_chat_id, cfg.officer_chat_id or "(미설정)")

    app = build_application(cfg)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
