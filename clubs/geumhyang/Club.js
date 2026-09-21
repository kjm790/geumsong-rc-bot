/**
 * Club.js — 클럽 프로필 (대구금향로타리클럽 · 2026-09-07 국제로타리 가입 승인, 창립행사는 2026-10 예정)
 *
 * 코어(gas/*.js)는 모든 클럽이 공유하고, 클럽마다 다른 값은 전부 이 파일에만 둔다.
 * 배포: tools/deploy.ps1 geumhyang
 * ⚠️ '확정 전' 표시는 창립 준비 과정에서 정해지는 대로 채운다(빈 값이어도 봇은 정상 동작).
 */
var CLUB = {
  name: '대구금향로타리클럽',
  short: '대구금향RC',
  nick: '금향',
  district: '국제로타리 3700지구',            // 확정 전: 소속 지구 확인
  botUsername: 'geumhyang_office_bot',        // 토큰은 여기 쓰지 않는다 → Script Property BOT_TOKEN
  dataSheetName: '대구금향RC AI사무장 데이터',
  riAdmittedDate: '2026-09-07',               // 국제로타리 가입증서 날짜 — 이 날부터 정식 클럽('(가칭)' 아님)
  accessControl: true,                        // 임원방 모드(Office.js): 등록된 user_id 만, 설정은 시트 「설정」 탭 우선

  // 지구 연도 테마(2026-27)
  theme: '🌍 지속적인 영향력을 · CREATE LASTING IMPACT',
  slogan: '🤝 봉사는 팩트 · 기부는 임팩트 · 사랑은 퍼펙트',

  // 확정 전: 창립총회에서 초대 회장 선출 후 입력 (또는 Script Property PRESIDENT_LABEL / PRESIDENT_NAME)
  presidentLabel: '',                         // 예: '아호 홍길동 회장'
  presidentName: '',
  ippName: '',                                // 신생클럽은 직전회장 없음

  // 확정 전: 회비(원). 0 이면 해당 항목 미부과
  dues: { annual: 0, service: 0, weekly: 0, newSeed: 0, rfsmUsd: 100, fiscalStart: 7 },
  duesInfo: ['', '회비는 창립총회에서 확정 후 안내드리겠습니다.'],

  // 창립회원 모집(Recruit.js): 예비회원 명단 시트의 탭 이름·목표 인원. 창립행사일(D-day 기준)은 설정 탭 「창립일」 또는 Script Property CHARTER_DATE
  recruit: { tab: '예비회원명단', target: 20, charterDate: '' },

  ledgerExamples: { income: '/수입 창립기금 100만 홍길동', expense: '/지출 창립행사비 350000 현수막·명패' }
};

// 확정 전: 정기모임 요일·시각이 정해지면 추가.
//   { key: 'event1', name: '정기모임', kind: 'recurring', weekday: 2, nth: 1, hour: 19, minute: 30 }
//   요일은 JavaScript 기준 0=일 1=월 2=화 3=수 4=목 5=금 6=토, nth=매월 N째
var EVENTS = [];

var PAST_PRESIDENTS = {};                     // 신생클럽 — 회기가 쌓이면 추가

// 확정 전: 성명 → 직책. 직책명은 코어의 정렬·뱃지 표(ATTEND_ROLE_RANK)와 같은 표기를 쓰면 자동 적용.
//   '홍길동': '클럽 회장', '...': '총무이사', '...': '재무이사'(=회비·장부 관리 권한)
var CLUB_ROLES = {};

var SUB_TITLES = {};

// 확정 전: 직책별 분담금(만원). 예: { '클럽 회장': 300, '총무이사': 50 }
var SHARE_BY_ROLE = {};

// 창립회원 명부 — [연번, 아호, 성명]. 가입신청서가 들어오는 대로 추가(데이터시트 roster 탭에서 직접 편집해도 됨).
var ROSTER_SEED = [];
