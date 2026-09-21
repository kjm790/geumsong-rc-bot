/**
 * Auth.js — 텔레그램 user_id 기준 권한 ('회원' 탭)
 *
 * - '회원' 탭의 user_id·권한 열로 사용자를 식별한다. 등록되지 않은 user_id 의 명령은 무시.
 * - 코드는 '직책'이 아니라 '할 수 있는 일(cap)'을 검사한다 → 임원이 바뀌어도 시트만 고치면 된다.
 * - 권한↔할 수 있는 일 대응표(ROLE_CAPS)는 시트가 아니라 코드에 둔다(시트 편집만으로 권한을 넓힐 수 없게).
 * - 개인정보 최소화: 성명·직책·user_id·권한·상태 열만 읽는다(연락처 등이 같은 탭에 있어도 읽지 않음).
 */
var AUTH_SHEET = '회원';
var AUTH_HEADERS = ['번호', '성명', '직책', 'user_id', '권한', '상태', '입회일', '비고'];

var ROLE_CAPS = {
  '관리자':   ['*'],
  '회장':     ['view', 'finance.view', 'roster.add', 'docs.upload', 'expense.approve'],
  '재무이사': ['view', 'finance.view', 'roster.add', 'docs.upload', 'payment.confirm', 'expense.draft', 'expense.execute'],
  '총무이사': ['view', 'finance.view', 'roster.add', 'docs.upload', 'record', 'report.post'],
  '차기회장': ['view', 'finance.view', 'roster.add', 'docs.upload'],
  '부회장':   ['view', 'finance.view', 'roster.add', 'docs.upload'],
  '조회':     ['view', 'finance.view', 'docs.upload'],   // 사찰이사·상임위원장 등: 조회 + 자기 분야 자료 보관
  '참관':     ['view']                       // 어드바이저·추진위원장: 읽기 전용(재무 조회 제외)
};

var _AUTH_USERS = null;
function invalidateAuth_() { _AUTH_USERS = null; }

/** 시트 값(2차원) → [{userId,name,title,role,active}]. 제목 이름으로 열을 찾는 순수 함수. */
function authParse_(values) {
  if (!values.length) return [];
  var head = values[0].map(function (h) { return String(h).trim(); });
  var ix = { name: head.indexOf('성명'), title: head.indexOf('직책'), uid: head.indexOf('user_id'), role: head.indexOf('권한'), st: head.indexOf('상태') };
  if (ix.uid === -1 || ix.role === -1) return [];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var cell = function (j) { return j === -1 || values[i][j] === null || values[i][j] === undefined ? '' : String(values[i][j]).trim(); };
    var uid = cell(ix.uid).replace(/\.0+$/, '');            // 시트가 숫자로 바꾼 id('123.0') 보정
    if (!/^\d+$/.test(uid)) continue;
    var role = cell(ix.role);
    if (!ROLE_CAPS[role]) continue;                          // 표에 없는 권한 이름은 권한 없음으로 취급
    out.push({ userId: uid, name: cell(ix.name), title: cell(ix.title), role: role, active: ['정지', '탈퇴', '중지'].indexOf(cell(ix.st)) === -1 });
  }
  return out;
}
function authUsers_() {
  if (_AUTH_USERS) return _AUTH_USERS;
  _AUTH_USERS = authParse_(getOrCreateSheet_(getSS_(), AUTH_SHEET, AUTH_HEADERS).getDataRange().getValues());
  return _AUTH_USERS;
}

/** users 목록 + 관리자 id 목록으로 사용자 판정(순수). 미등록·정지면 null */
function authResolve_(users, adminIds, userId) {
  var uid = String(userId), row = null;
  for (var i = 0; i < users.length; i++) if (users[i].userId === uid) { row = users[i]; break; }
  if (adminIds.indexOf(uid) !== -1) {                        // Script Property ADMIN_IDS = 시트가 비어 있어도 되는 최초 관리자
    return { userId: uid, name: (row && row.name) || '관리자', title: (row && row.title) || '', role: '관리자' };
  }
  if (!row || !row.active) return null;
  return { userId: uid, name: row.name, title: row.title, role: row.role };
}
function authUser_(userId) {
  var users = [];
  try { users = authUsers_(); } catch (e) { Logger.log('회원 탭 읽기 실패(관리자만 인식): ' + e); }
  return authResolve_(users, getAdminIds_(), userId);
}

function can_(user, cap) {
  if (!user) return false;
  var caps = ROLE_CAPS[user.role] || [];
  return caps.indexOf('*') !== -1 || caps.indexOf(cap) !== -1;
}

/** 권한 없으면 안내 후 false */
function requireCap_(chat, user, cap) {
  if (can_(user, cap)) return true;
  tgSend_(chat.id, '🔒 이 명령은 권한이 필요합니다. (현재 권한: ' + escapeHtml_(user ? user.role : '없음') + ')');
  return false;
}
