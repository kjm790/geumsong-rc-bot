/**
 * AuditLog.js — '로그' 탭 (누가 / 언제 / 무엇을 / 변경 전후)
 *
 * 금액·상태·설정·권한 변경은 전부 여기에 한 줄씩 **추가만** 한다. 수정·삭제하지 않는다.
 * 잘못 기록했으면 지우지 말고 정정 행을 새로 추가한다(비고에 정정 대상 표시).
 */
var AUDIT_SHEET = '로그';
var AUDIT_HEADERS = ['시각', 'user_id', '성명', '권한', '행위', '대상', '변경 전', '변경 후', '비고'];

function auditRow_(now, user, action, target, before, after, note) {
  var s = function (v) { return v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); };
  return [now, user ? s(user.userId) : '', user ? s(user.name) : '', user ? s(user.role) : '', s(action), s(target), s(before), s(after), s(note)];
}

/** user: authUser_ 결과(시트 직접 편집 등 봇 밖의 주체면 {name:'(시트 편집) 이메일', role:''}) */
function audit_(user, action, target, before, after, note) {
  var now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  getOrCreateSheet_(getSS_(), AUDIT_SHEET, AUDIT_HEADERS).appendRow(auditRow_(now, user, action, target, before, after, note));
}

/** 최근 n 건(시트 값 → 텍스트 줄). 순수 함수. */
function auditTailLines_(values, n) {
  return values.slice(1).slice(-n).reverse().map(function (r) {
    var chg = (r[6] !== '' || r[7] !== '') ? '  ' + escapeHtml_(String(r[6])) + ' → ' + escapeHtml_(String(r[7])) : '';
    return '• <i>' + escapeHtml_(String(r[0])) + '</i> ' + escapeHtml_(String(r[2] || r[1] || '-')) + ' · <b>' + escapeHtml_(String(r[4])) + '</b> ' +
      escapeHtml_(String(r[5])) + chg;
  });
}
