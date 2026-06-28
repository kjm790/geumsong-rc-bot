/**
 * Config.js — 설정 / Script Properties / 행사 정의
 *
 * 대구금송로타리클럽 'AI사무장봇' (Google Apps Script 버전)
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

// 행사 종류(kind):
//  - 'recurring'      : 매월 N째 요일 고정 + 출석 버튼/집계/리마인더 (정기모임·봉사)
//  - 'monthly_notice' : 시각 미지정. 정기모임에서 '익월 행사'로 안내만(출석 집계 없음). (동호회)
//
// ⚠️ recurring 의 요일은 JavaScript 기준: 0=일 1=월 2=화 3=수 4=목 5=금 6=토 (화=2, 토=6)
var EVENTS = [
  { key: 'event1', name: '정기모임',            kind: 'recurring', weekday: 2, nth: 1, hour: 19, minute: 30 }, // 첫째 화요일 19:30
  { key: 'event2', name: '자유재활원 정기봉사', kind: 'recurring', weekday: 6, nth: 3, hour: 10, minute: 0  }, // 셋째 토요일 10:00

  // 골프회 — 홀수월, 달마다 내용이 다름
  {
    key: 'event3', name: '골프회', kind: 'monthly_notice',
    activities: { '7': '스크린 골프', '9': '정기 라운딩', '11': '정기 라운딩', '1': '스크린 골프', '3': '정기 라운딩', '5': '골프회장배' }
  },
  // 문화레저동호회 — 8·10·12·2·4월, 전 회원 대상(형태는 회차별)
  {
    key: 'event4', name: '문화레저동호회', kind: 'monthly_notice',
    months: [8, 10, 12, 2, 4], activity: '전 회원 대상 행사 (음악회·미술관·영화·강연·스포츠 중)'
  }
];

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
    if (act) lines.push('• ' + ev.name + ': ' + act);
  });
  return lines;
}

/** 여러 달의 동호회 행사 안내(각 줄에 (N월) 표기). months: [7, 8] 등 */
function clubNoticeForMonths_(months) {
  var lines = [];
  months.forEach(function (month) {
    noticeEvents_().forEach(function (ev) {
      var act = clubEventActivityForMonth_(ev, month);
      if (act) lines.push('• (' + month + '월) ' + ev.name + ': ' + act);
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
function presidentLabel_() { return getProp_('PRESIDENT_LABEL', false) || '돈일 박동용 회장'; }
// 회장 식별용 성명(매칭값과 비교). Script Property 'PRESIDENT_NAME' 로 교체 가능.
function presidentName_() { return getProp_('PRESIDENT_NAME', false) || '박동용'; }
// 직전회장 성명(공손한 예우 환영용). Script Property 'IPP_NAME' 로 교체 가능.
function immediatePastPresidentName_() { return getProp_('IPP_NAME', false) || '윤용택'; }

// 역대 회장(성명 → 직책). 참석 시 예우 호칭에 사용. 회기마다 추가.
var PAST_PRESIDENTS = {
  '김종만': '초대·2대 회장',
  '홍계영': '3대회장',
  '김영상': '4대회장',
  '송건호': '5대회장',
  '이영준': '6대회장',
  '이영희': '7대회장',
  '윤용택': '8대/직전회장'
};
function pastPresidentTitle_(name) { return PAST_PRESIDENTS[name] || null; }

// 현 직책(성명 → 직책). 명칭 앞에 붙는다. 회기마다 갱신. (예: 출석위원장 동우 김종만)
var CLUB_ROLES = {
  '박동용': '회장',
  '서상일': '차기회장',
  '황준영': '부회장',
  '이준원': '총무',
  '김태훈': '사찰',
  '김종만': '출석위원장',
  '김영상': '재무이사',
  '이영희': 'IT위원장',
  '윤성묵': 'DEI위원장',
  '권준철': '멤버십위원장',
  '이영준': '클럽관리위원장',
  '송선호': '재단관리위원장',
  '김태수': '봉사프로젝트위원장',
  '윤용택': '공공이미지위원장(클럽감사)'
  // … 나머지 직책은 추가 예정
};
function clubRole_(name) { return CLUB_ROLES[name] || null; }

// 괄호 안 보조 명칭(성명 → 동호회장 등). 역대회장과 함께 subTitle_ 로 묶임.
var SUB_TITLES = {
  '서상일': '골프회장',
  '황준영': '문화레저동호회 회장'
};
// 괄호에 넣을 보조 명칭: 동호회장 우선, 없으면 역대회장.
function subTitle_(name) { return SUB_TITLES[name] || pastPresidentTitle_(name) || null; }

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
