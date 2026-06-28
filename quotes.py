"""
quotes.py — 명언 / 칭찬 문구 모음

매월 출석 안내에 들어갈 '명언', 회원 응답 시 단톡에 게시할 '칭찬' 문구.
월별로 일관된 명언을 뽑되 단조롭지 않게, 인덱스 기반으로 순환 선택한다.
"""

from __future__ import annotations

QUOTES: list[str] = [
    "봉사는 자기 자신을 넘어서는 가장 아름다운 일입니다. — 로터리 정신",
    "초아의 봉사(Service Above Self), 그 한 걸음이 세상을 바꿉니다.",
    "함께 모이는 것은 시작이고, 함께 머무는 것은 발전이며, 함께 일하는 것은 성공입니다. — 헨리 포드",
    "한 사람의 작은 친절이 모여 큰 변화를 만듭니다.",
    "우리가 가진 것이 아니라 우리가 나누는 것이 우리를 부유하게 합니다.",
    "오늘 우리가 함께한 시간이 내일의 누군가에게 희망이 됩니다.",
    "좋은 친구와 좋은 모임은 인생의 가장 큰 재산입니다.",
    "성공의 비결은 꾸준함입니다. 매달의 만남이 우리를 단단하게 합니다.",
    "나눔은 줄어드는 것이 아니라 곱해지는 것입니다.",
    "혼자 가면 빨리 가지만, 함께 가면 멀리 갑니다. — 아프리카 속담",
    "작은 정성이 모여 큰 봉사가 됩니다. 당신의 참여가 곧 봉사입니다.",
    "어제보다 나은 오늘, 오늘보다 나은 내일을 함께 만들어갑시다.",
]

PRAISE_ATTEND: list[str] = [
    "👏 {name} 님, 참석 확인 감사합니다! 이번 모임도 함께해 주셔서 든든합니다.",
    "🎉 {name} 님의 참석으로 모임이 더욱 빛납니다. 감사합니다!",
    "🌟 {name} 님, 변함없는 참여에 깊이 감사드립니다. 뵙겠습니다!",
    "🙌 {name} 님 참석! 클럽의 가장 큰 힘은 바로 회원님들의 발걸음입니다.",
    "💪 {name} 님, 함께해 주셔서 감사합니다. 좋은 모임 만들어 가요!",
]

PRAISE_ABSENT: list[str] = [
    "🙏 {name} 님, 회신 주셔서 감사합니다. 다음 모임에서 꼭 뵙겠습니다!",
    "📝 {name} 님, 알려 주셔서 감사합니다. 늘 마음으로 함께하고 있습니다.",
    "🤝 {name} 님, 사정상 불참 알겠습니다. 다음 기회에 반갑게 뵙겠습니다!",
]


def quote_for_month(year: int, month: int) -> str:
    """해당 연·월에 대해 일관되게 하나의 명언을 선택(순환)."""
    idx = (year * 12 + (month - 1)) % len(QUOTES)
    return QUOTES[idx]


def _pick(pool: list[str], seed: int) -> str:
    return pool[seed % len(pool)]


def praise_message(name: str, status: str, seed: int) -> str:
    """
    status: 'attend' 또는 'absent'
    seed: user_id 등으로 문구를 분산.
    """
    pool = PRAISE_ATTEND if status == "attend" else PRAISE_ABSENT
    return _pick(pool, seed).format(name=name)
