/**
 * Config.js — 설정 / Script Properties / 행사 헬퍼 (전 클럽 공용 코어)
 *
 * 로타리클럽 'AI사무장봇' (Google Apps Script 버전)
 * 클럽별 값(CLUB·EVENTS·CLUB_ROLES·PAST_PRESIDENTS·SUB_TITLES·SHARE_BY_ROLE·ROSTER_SEED)은
 * clubs/<클럽>/Club.js 에 있다. 이 파일에는 클럽 이름·사람 이름을 쓰지 않는다.
 *
 * 비밀값은 Script Properties(프로젝트 설정 > 스크립트 속성)에 저장합니다.
 *   BOT_TOKEN        : BotFather 토큰
 *   GROUP_CHAT_ID    : 클럽 단톡 chat ID (음수)
 *   OFFICER_CHAT_ID  : 임원 보고방 chat ID (선택)
 *   ADMIN_IDS        : 관리자 user ID, 쉼표 구분
 *   SHEET_ID         : 데이터 스프레드시트 ID (setup() 이 자동 생성/기록)
 *   WEBHOOK_URL      : 배포한 웹앱 /exec URL (setWebhook() 이 사용)
 *   DRIVE_FOLDER_ID  : (선택) 데이터 시트를 만들 공유드라이브 폴더 ID
 */

// 행사 정의(EVENTS)는 Club.js. kind: 'recurring'(출석 집계) / 'monthly_notice'(안내만)
function recurringEvents_() { return EVENTS.filter(function (e) { return e.kind === 'recurring'; }); }
function noticeEvents_()    { return EVENTS.filter(function (e) { return e.kind === 'monthly_notice'; }); }

/** 공지형 행사가 특정 월에 진행하는 내용(없으면 null). month: 1~12 */
function clubEventActivityForMonth_(ev, month) {
  if (ev.activities) return ev.activities[String(month)] || null;
  if (ev.months) return ev.months.indexOf(month) !== -1 ? ev.activity : null;
  return null;
}

/** 특정 월의 동호회 행사 안내 줄 목록(없으면 빈 배열). */
function clubNoticeForMonth_(month) {
  var lines = [];
  noticeEvents_().forEach(function (ev) {
    var act = clubEventActivityForMonth_(ev, month);
    if (act) {
      lines.push('• ' + ev.name + ': ' + act);
      if (ev.officers) lines.push('   └ ' + ev.officers);
    }
  });
  return lines;
}

/** 여러 달의 동호회 행사 안내(각 줄에 (N월) 표기). months: [7, 8] 등 */
function clubNoticeForMonths_(months) {
  var lines = [];
  months.forEach(function (month) {
    noticeEvents_().forEach(function (ev) {
      var act = clubEventActivityForMonth_(ev, month);
      if (act) {
        lines.push('• (' + month + '월) ' + ev.name + ': ' + act);
        if (ev.officers) lines.push('   └ ' + ev.officers);
      }
    });
  });
  return lines;
}

/** 행사 일정 설명(도움말용). recurring=요일/시각, notice=월별 내용. */
function eventDescribe_(e) {
  if (e.kind === 'recurring') return eventScheduleText_(e);
  if (e.activities) {
    var ms = Object.keys(e.activities).map(Number).sort(function (a, b) { return a - b; });
    return ms.map(function (m) { return m + '월 ' + e.activities[String(m)]; }).join(', ');
  }
  if (e.months) {
    var sorted = e.months.slice().sort(function (a, b) { return a - b; });
    return sorted.join('·') + '월 — ' + e.activity;
  }
  return '';
}

var SETTINGS = {
  announceHour: 10,        // dailyCheck 트리거 시각(시). createDailyTrigger_ 에서 사용
  reminderDaysBefore: 3,   // 행사 D-N 단톡 리마인더
  praiseInGroup: true,     // 응답 시 단톡 칭찬
  reportToOfficers: true,  // 임원방 현황 보고

  weeklyDigest: true,            // 매주 월요일 단톡 다이제스트(명언+행사+참석예정 명단+독려)
  personalNudge: true,           // 정기모임 미응답자에게 개인(1:1) 독려를 매일(말일~당일 오전)
  personalNudgeEventKey: 'event1' // 개인 독려 대상 행사 키
};

var TZ = 'Asia/Seoul';

function props_() {
  return PropertiesService.getScriptProperties();
}

function getProp_(key, required) {
  var v = props_().getProperty(key);
  if ((v === null || v === '') && required) {
    throw new Error('[설정 오류] Script Property 누락: ' + key);
  }
  return v;
}

function getToken_()        { return getProp_('BOT_TOKEN', true); }
function getGroupChatId_()  { return getProp_('GROUP_CHAT_ID', true); }
function getOfficerChatId_(){ var v = getProp_('OFFICER_CHAT_ID', false); return v ? v : null; }

// 회장 호칭(불참 독려 서명용). 매년 바뀌므로 Script Property 'PRESIDENT_LABEL' 로 교체 가능.
function presidentLabel_() { return getProp_('PRESIDENT_LABEL', false) || CLUB.presidentLabel; }
// 회장 식별용 성명(매칭값과 비교). Script Property 'PRESIDENT_NAME' 로 교체 가능.
function presidentName_() { return getProp_('PRESIDENT_NAME', false) || CLUB.presidentName; }
// 직전회장 성명(공손한 예우 환영용). Script Property 'IPP_NAME' 로 교체 가능.
function immediatePastPresidentName_() { return getProp_('IPP_NAME', false) || CLUB.ippName; }

// 역대 회장 표(PAST_PRESIDENTS)·현 직책 표(CLUB_ROLES)·보조 명칭(SUB_TITLES)은 Club.js
function pastPresidentTitle_(name) { return PAST_PRESIDENTS[name] || null; }

function clubRole_(name) { return CLUB_ROLES[name] || null; }

// 괄호에 넣을 보조 명칭: 동호회장 우선, 없으면 역대회장.
function subTitle_(name) { return SUB_TITLES[name] || pastPresidentTitle_(name) || null; }

// ── 참석 명단 임원 정렬 순위 + 직책 뱃지(장식) ─────────────────
// 참석 명단은 늦게 눌러도 항상 이 순서로 상단 고정:
// 회장→차기회장→부회장→총무→재무→사찰→공공이미지→멤버십→클럽관리→로타리재단→봉사프로젝트→IT→DEI→출석위원장→일반(누른순서).
var ATTEND_ROLE_RANK = {
  '클럽 회장': 1, '회장': 1, '차기회장': 2, '부회장': 3,
  '총무이사': 4, '재무이사': 5, '사찰이사': 6,
  '공공이미지위원장': 7, '멤버십위원장': 8, '회원위원장': 8, '클럽관리위원장': 9,
  '로타리재단위원장': 10, '봉사프로젝트위원장': 11, 'IT위원장': 12, 'DEI위원장': 13,
  '출석위원장': 14   // 임원 중 제일 아래(일반 회원 바로 위)
};
// 직책 라벨에서 괄호 보조명칭 제거(예: '공공이미지위원장(클럽감사)' → '공공이미지위원장')
function roleKey_(role) { return String(role || '').replace(/\s*\(.*\)\s*/, '').trim(); }
function attendRank_(name) {
  var role = clubRole_(name);
  if (!role) return 99;                                            // 일반 회원(직책 없음)
  return ATTEND_ROLE_RANK[role] || ATTEND_ROLE_RANK[roleKey_(role)] || 50;  // 지정 13직책=1~13, 그 외 임원=50
}
// 직책별 장식 이모지
var ROLE_BADGE = {
  '클럽 회장': '👑', '회장': '👑', '차기회장': '🌟', '부회장': '🎖️',
  '총무이사': '📋', '재무이사': '💰', '사찰이사': '⚖️',
  '공공이미지위원장': '📢', '멤버십위원장': '🤝', '회원위원장': '🤝', '클럽관리위원장': '🏛️',
  '로타리재단위원장': '💝', '봉사프로젝트위원장': '🛠️', 'IT위원장': '💻',
  'DEI위원장': '🌈', '출석위원장': '📅'
};
function roleBadge_(role) { return ROLE_BADGE[role] || ROLE_BADGE[roleKey_(role)] || '🎗️'; }
// 참석 명단 표기: 임원이면 '아호 이름 — 👑 클럽 회장', 일반은 '아호 이름'
function attendLabel_(aho, name) {
  var base = (aho ? aho + ' ' : '') + name;
  var role = clubRole_(name);
  return role ? base + ' — ' + roleBadge_(role) + ' ' + role : base;
}

// ── 회비: 직책별 분담금(만원). 표(SHARE_BY_ROLE)는 Club.js, 표에 없으면 0 ──
function shareByRole_(role) {
  if (!role) return 0;
  return SHARE_BY_ROLE[roleKey_(role)] || 0;
}

function getAdminIds_() {
  var raw = getProp_('ADMIN_IDS', false) || '';
  return raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function isAdmin_(userId) {
  return getAdminIds_().indexOf(String(userId)) !== -1;
}

function getEventByKey_(key) {
  for (var i = 0; i < EVENTS.length; i++) {
    if (EVENTS[i].key === key) return EVENTS[i];
  }
  return null;
}

// ── 한국어 표기 헬퍼 ──────────────────────────────────────────
function weekdayNameKr_(w) {           // JS 0=일 .. 6=토
  return ['일', '월', '화', '수', '목', '금', '토'][w];
}
function nthNameKr_(n) {
  return ['', '첫째', '둘째', '셋째', '넷째', '다섯째'][n] || (n + '번째');
}
function eventScheduleText_(e) {
  var t = e.hour + '시' + (e.minute ? ' ' + e.minute + '분' : '');
  return '매월 ' + nthNameKr_(e.nth) + ' ' + weekdayNameKr_(e.weekday) + '요일 ' + t;
}
function displayName_(fullName, username) {
  if (fullName) return fullName;
  if (username) return '@' + username;
  return '회원';
}
