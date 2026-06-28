/**
 * Quotes.js — 명언 / 칭찬 문구
 */

var QUOTES = [
  '봉사는 자기 자신을 넘어서는 가장 아름다운 일입니다. — 로터리 정신',
  '초아의 봉사(Service Above Self), 그 한 걸음이 세상을 바꿉니다.',
  '함께 모이는 것은 시작이고, 함께 머무는 것은 발전이며, 함께 일하는 것은 성공입니다. — 헨리 포드',
  '한 사람의 작은 친절이 모여 큰 변화를 만듭니다.',
  '우리가 가진 것이 아니라 우리가 나누는 것이 우리를 부유하게 합니다.',
  '오늘 우리가 함께한 시간이 내일의 누군가에게 희망이 됩니다.',
  '좋은 친구와 좋은 모임은 인생의 가장 큰 재산입니다.',
  '성공의 비결은 꾸준함입니다. 매달의 만남이 우리를 단단하게 합니다.',
  '나눔은 줄어드는 것이 아니라 곱해지는 것입니다.',
  '혼자 가면 빨리 가지만, 함께 가면 멀리 갑니다. — 아프리카 속담',
  '작은 정성이 모여 큰 봉사가 됩니다. 당신의 참여가 곧 봉사입니다.',
  '어제보다 나은 오늘, 오늘보다 나은 내일을 함께 만들어갑시다.'
];

var PRAISE_ATTEND = [
  '👏 {name} 님, 참석 확인 감사합니다! 이번 모임도 함께해 주셔서 든든합니다.',
  '🎉 {name} 님의 참석으로 모임이 더욱 빛납니다. 감사합니다!',
  '🌟 {name} 님, 변함없는 참여에 깊이 감사드립니다. 뵙겠습니다!',
  '🙌 {name} 님 참석! 클럽의 가장 큰 힘은 바로 회원님들의 발걸음입니다.',
  '💪 {name} 님, 함께해 주셔서 감사합니다. 좋은 모임 만들어 가요!'
];

var PRAISE_ABSENT = [
  '🙏 {name} 님, 회신 주셔서 감사합니다. 다음 모임에서 꼭 뵙겠습니다!',
  '📝 {name} 님, 알려 주셔서 감사합니다. 늘 마음으로 함께하고 있습니다.',
  '🤝 {name} 님, 사정상 불참 알겠습니다. 다음 기회에 반갑게 뵙겠습니다!'
];

// 참여 독려 한마디 (주간 다이제스트·개인 독려에 사용)
var ENCOURAGE_NUDGE = [
  '한 분 한 분의 참여가 클럽을 움직입니다. 함께해 주세요! 💪',
  '바쁘시더라도 잠깐의 참여가 큰 힘이 됩니다. 🙏',
  '여러분의 발걸음이 곧 봉사입니다. 기다리겠습니다! 🌟',
  '올해도 변함없는 참여 부탁드립니다. 함께라서 든든합니다. 🤝',
  '작은 정성이 모여 큰 봉사가 됩니다. 참석으로 마음을 보태주세요. 😊'
];

function quoteForMonth_(year, month) {
  var idx = (year * 12 + (month - 1)) % QUOTES.length;
  return QUOTES[idx];
}

/** 날짜 기반으로 매일 바뀌는 명언/독려 선택 (epochDay seed) */
function quoteForDay_(epochDay) { return QUOTES[Math.abs(epochDay) % QUOTES.length]; }
function nudgeForDay_(epochDay) { return ENCOURAGE_NUDGE[Math.abs(epochDay) % ENCOURAGE_NUDGE.length]; }

function praiseMessage_(name, status, seed) {
  var pool = status === 'attend' ? PRAISE_ATTEND : PRAISE_ABSENT;
  var s = Math.abs(seed || 0) % pool.length;
  return pool[s].replace('{name}', name);
}
