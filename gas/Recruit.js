/**
 * Recruit.js — 신생클럽 창립회원 모집 현황 (예비회원 명단 시트 기반)
 *
 * 사람이 관리하는 '예비회원명단' 시트를 그대로 읽어 모집 현황을 집계·보고한다.
 *  - 시트가 유일한 원본. 사람이 쓰는 칸을 봇이 덮어쓰지 않는다. 봇이 쓰는 것은 ①양식으로 접수한 새 줄(Intake.js)
 *    ②'아호' 열(성명 바로 앞에 두고, /아호 로 받은 값 기재) ③/확약 등으로 받은 확약여부 칸.
 *  - 열은 위치가 아니라 **제목 이름**으로 찾는다 → 위에 안내문·요약 줄이 있어도, 열을 추가·이동해도 동작.
 *  - 개인정보 최소화: 연락처·이메일·출생년도 등은 아예 읽어 들이지 않는다(메시지·로그에 나갈 수 없음).
 *
 * 설정
 *  - Script Property RECRUIT_SHEET_ID : 예비회원 명단 구글시트 ID (xlsx 는 불가 — Google Sheets 로 변환)
 *  - Script Property CHARTER_DATE     : 창립행사일 'yyyy-MM-dd' (없으면 CLUB.recruit.charterDate, 그것도 없으면 D-day 생략)
 *  - Club.js CLUB.recruit = { tab: '예비회원명단', target: 20, charterDate: '' }
 *
 * 명령(관리자): /모집현황 (/recruit) — 요약, /모집명단 (/recruitlist) — 상태별 이름, /모집점검 (/recruitcheck) — 시트 입력 누락 점검
 */
var RECRUIT_COLS = {           // 내부 키 → 시트 열 제목
  name: '성명', aho: '아호', job: '직업분류', referrer: '추천인', engName: '영문명', joinDate: '가입일',
  status: '확약여부', role: '창립회기 직책', manager: '담당 관리위원', premeet: '예비모임 참석'
};
var RECRUIT_STATUS_ORDER = ['확약', '검토중', '보류'];

function recruitConf_() {
  var c = (typeof CLUB !== 'undefined' && CLUB.recruit) || {};
  var target = c.target || 20;
  if (officeMode_()) { try { target = settingNum_('목표인원', target); } catch (e) {} }   // 설정 탭 우선
  return { tab: c.tab || '예비회원명단', target: target, charterDate: c.charterDate || '' };
}

/** 2차원 배열(시트 값) → 회원 행 목록. 순수 함수(시트 접근 없음). */
function recruitParse_(values) {
  var headerRow = -1, col = {};
  for (var r = 0; r < values.length && headerRow === -1; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).trim() === RECRUIT_COLS.name) { headerRow = r; break; }
    }
  }
  if (headerRow === -1) throw new Error("명단 시트에서 '성명' 열 제목을 찾지 못했습니다.");
  values[headerRow].forEach(function (h, i) {
    var t = String(h).replace(/\s+/g, ' ').trim();
    Object.keys(RECRUIT_COLS).forEach(function (k) { if (RECRUIT_COLS[k] === t && col[k] === undefined) col[k] = i; });
  });
  var noCol = values[headerRow].map(function (h) { return String(h).trim(); }).indexOf('번호');
  var rows = [];
  for (var i = headerRow + 1; i < values.length; i++) {
    var get = function (k) { return col[k] === undefined ? '' : String(values[i][col[k]] === null || values[i][col[k]] === undefined ? '' : values[i][col[k]]).trim(); };
    var name = get('name');
    if (!name) continue;
    // '번호' 칸이 숫자인 줄만 회원으로 인정 → 같은 탭 아래쪽에 다른 표·메모가 붙어 있어도 섞이지 않는다
    if (noCol !== -1 && !/^\d+$/.test(String(values[i][noCol]).trim())) continue;
    rows.push({
      row: i + 1, name: name, aho: get('aho'), job: get('job'), referrer: get('referrer'), engName: get('engName'),
      joinDate: get('joinDate'), status: recruitNormStatus_(get('status')), role: get('role'),
      manager: get('manager'), premeet: get('premeet')
    });
  }
  return { rows: rows, headerRow: headerRow + 1, width: values[headerRow].length, ahoMissing: col.aho === undefined,
    missingCols: Object.keys(RECRUIT_COLS).filter(function (k) { return k !== 'aho' && col[k] === undefined; }).map(function (k) { return RECRUIT_COLS[k]; }) };
}

/** 명단 정렬 순위: 임원 서열(회장→차기회장→부회장→총무→재무→사찰→위원장…, Config.js ATTEND_ROLE_RANK) 먼저, 나머지는 시트 번호순 */
function recruitRoleRank_(role) {
  if (!role) return 99;
  return ATTEND_ROLE_RANK[role] || ATTEND_ROLE_RANK[roleKey_(role)] || 50;
}

/**
 * 새로 접수되는 회원의 가입일(순수): 창립행사 전이면 창립행사일(창립회원으로 입회), 그 뒤면 접수한 날. 창립행사일 미정이면 ''(비워 둠)
 */
function recruitJoinDateOf_(today, charter) { return !charter ? '' : (today < charter ? charter : today); }

/** 표기: '아호 성명' (아호 없으면 성명만) */
function recruitLabel_(m) { return (m.aho ? m.aho + ' ' : '') + m.name; }

/** '검토 중'·' 확약 ' 같은 표기 흔들림 정리. 빈 값은 '미정'. */
function recruitNormStatus_(s) {
  var t = String(s || '').replace(/\s+/g, '');
  return t || '미정';
}

function recruitSummary_(rows) {
  var byStatus = {}, byManager = {};
  rows.forEach(function (m) {
    byStatus[m.status] = (byStatus[m.status] || 0) + 1;
    var k = m.manager || '(담당 미지정)';
    byManager[k] = byManager[k] || { total: 0, confirmed: 0 };
    byManager[k].total++;
    if (m.status === '확약') byManager[k].confirmed++;
  });
  return { total: rows.length, confirmed: byStatus['확약'] || 0, byStatus: byStatus, byManager: byManager };
}

function recruitStatusKeys_(byStatus) {
  var rest = Object.keys(byStatus).filter(function (k) { return RECRUIT_STATUS_ORDER.indexOf(k) === -1; }).sort();
  return RECRUIT_STATUS_ORDER.filter(function (k) { return byStatus[k]; }).concat(rest);
}

/** 'yyyy-MM-dd' 두 날짜의 일수 차(b - a) */
function recruitDayDiff_(a, b) {
  var pa = a.split('-'), pb = b.split('-');
  return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
}

function recruitBar_(n, target) {
  var len = 10, fill = Math.max(0, Math.min(len, Math.round(len * n / target)));
  return new Array(fill + 1).join('■') + new Array(len - fill + 1).join('□');
}

/** 요약 메시지. today/charter: 'yyyy-MM-dd' (charter 없으면 D-day 생략) */
function recruitSummaryText_(rows, today, charter) {
  var conf = recruitConf_(), s = recruitSummary_(rows);
  var L = ['🌱 <b>' + CLUB.short + ' 창립회원 모집 현황</b>', UI_LINE];
  if (charter) {
    var d = recruitDayDiff_(today, charter);
    L.push('🗓 창립행사일 ' + charter + '  <b>' + (d > 0 ? 'D-' + d : d === 0 ? 'D-DAY' : 'D+' + (-d)) + '</b>');
  }
  L.push('🎯 확약 <b>' + s.confirmed + '</b> / 목표 ' + conf.target + '명  ' + recruitBar_(s.confirmed, conf.target),
    s.confirmed >= conf.target ? '   ✅ 목표 달성!' : '   ➜ <b>' + (conf.target - s.confirmed) + '명</b> 더 필요');
  if (charter && s.confirmed < conf.target) {
    var weeks = Math.max(1, Math.ceil(recruitDayDiff_(today, charter) / 7));
    L.push('   ➜ 남은 ' + weeks + '주간 주당 <b>' + Math.ceil((conf.target - s.confirmed) / weeks) + '명</b> 확약 필요');
  }
  L.push('', '▌<b>상태별</b> (명단 ' + s.total + '명)');
  recruitStatusKeys_(s.byStatus).forEach(function (k) { L.push(' • ' + escapeHtml_(k) + ' ' + s.byStatus[k] + '명'); });
  L.push('', '▌<b>담당 관리위원별</b> (확약/담당)');
  Object.keys(s.byManager).sort().forEach(function (k) {
    L.push(' • ' + escapeHtml_(k) + ' ' + s.byManager[k].confirmed + '/' + s.byManager[k].total);
  });
  L.push(UI_LINE, '이름 보기 /recruitlist · 입력 누락 점검 /recruitcheck');
  return L.join('\n');
}

/** 상태별 이름 목록(성명 + 직업분류 + 내정 직책). 연락처 등은 애초에 읽지 않음. */
function recruitListText_(rows) {
  var s = recruitSummary_(rows), L = ['🌱 <b>' + CLUB.short + ' 예비회원 명단</b>', UI_LINE];
  recruitStatusKeys_(s.byStatus).forEach(function (k) {
    L.push('▌<b>' + escapeHtml_(k) + '</b> ' + s.byStatus[k] + '명');
    rows.filter(function (m) { return m.status === k; })
      .sort(function (a, b) { return recruitRoleRank_(a.role) - recruitRoleRank_(b.role) || a.row - b.row; })
      .forEach(function (m, i) {
      L.push('  ' + (i + 1) + '. ' + escapeHtml_(recruitLabel_(m)) + (m.role ? ' — ' + roleBadge_(m.role) + ' ' + escapeHtml_(m.role) : '') +
        (m.job ? '  <i>' + escapeHtml_(m.job) + '</i>' : ''));
    });
    L.push('');
  });
  return L.join('\n').trim();
}

/** 시트 입력 누락 점검 — 어떤 칸이 비었는지 '개수와 이름'만 보고 */
function recruitCheckText_(parsed) {
  var rows = parsed.rows, L = ['🔍 <b>예비회원 명단 입력 점검</b>', UI_LINE];
  if (parsed.missingCols.length) L.push('⚠️ 시트에 없는 열: ' + parsed.missingCols.join(', '), '');
  var checks = [
    ['manager', '담당 관리위원 미지정', '→ 누가 챙길지 정해야 독려가 됩니다'],
    ['referrer', '추천인 미입력', ''],
    ['joinDate', '가입일 미입력', '→ RI 인준 명단은 인준일, 그 뒤 입회는 창립총회일·입회일'],
    ['engName', '영문명 미입력', '→ RI 회원 등록에 필요']
  ];
  var ok = true;
  checks.forEach(function (c) {
    var miss = rows.filter(function (m) { return !m[c[0]]; });
    if (!miss.length) return;
    ok = false;
    L.push('• <b>' + c[1] + '</b> ' + miss.length + '명 ' + c[2],
      '   ' + miss.map(function (m) { return escapeHtml_(m.name); }).join(', '));
  });
  var seen = {}, dup = [];
  rows.forEach(function (m) { if (seen[m.name]) dup.push(m.name + '(' + m.row + '행)'); seen[m.name] = 1; });
  if (dup.length) { ok = false; L.push('• <b>이름 중복</b>: ' + dup.map(escapeHtml_).join(', ')); }
  var odd = rows.filter(function (m) { return RECRUIT_STATUS_ORDER.indexOf(m.status) === -1; });
  if (odd.length) { ok = false; L.push('• <b>확약여부가 목록 밖 값</b>: ' + odd.map(function (m) { return escapeHtml_(m.name) + '=' + escapeHtml_(m.status); }).join(', ')); }
  if (ok) L.push('✅ 누락 없음 (' + rows.length + '명)');
  return L.join('\n');
}

// ── 시트 접근 + 명령 ─────────────────────────────────────────
function recruitLoad_() {
  var id = getProp_('RECRUIT_SHEET_ID', false);
  if (!id) throw new Error('Script Property RECRUIT_SHEET_ID 가 없습니다(예비회원 명단 구글시트 ID).');
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0];
  if (officeMode_()) { try { recruitEnsureAhoBeforeName_(sh); } catch (e) { Logger.log('아호 열 정리 실패: ' + e); } }
  if (officeMode_() && CLUB.riAdmittedDate) { try { recruitDropProvisional_(sh); } catch (e) { Logger.log('(가칭) 정리 실패: ' + e); } }   // '아호' 열을 성명 바로 앞에(이미 제자리면 무동작)
  return recruitParse_(sh.getDataRange().getValues());
}
function recruitCharterDate_() {
  var d = getProp_('CHARTER_DATE', false) || '';
  if (!d && officeMode_()) { try { d = settingDate_('창립일'); } catch (e) {} }   // 설정 탭의 창립일
  return d || recruitConf_().charterDate || '';
}

function cmdRecruit_(chat, from, mode) {
  if (!requireAdmin_(chat, from)) return;
  recruitReply_(chat, mode);
}
/** 권한 확인은 호출한 쪽 책임 */
function recruitReply_(chat, mode) {
  var parsed;
  try { parsed = recruitLoad_(); } catch (e) { tgSend_(chat.id, '⚠️ 모집 명단을 읽지 못했습니다: ' + escapeHtml_(e.message)); return; }
  var text = mode === 'list' ? recruitListText_(parsed.rows) + (parsed.rows.some(function (m) { return m.aho; }) ? '' : '\n\n<i>💡 아호 넣기: /아호 이름 아호, 이름 아호 …  (시트의 성명 앞 「아호」 칸에 직접 적어도 됩니다)</i>')
    : mode === 'check' ? recruitCheckText_(parsed)
    : recruitSummaryText_(parsed.rows, todayStr_(), recruitCharterDate_());
  tgSend_(chat.id, text);
}

/** 매주 월요일 임원방 자동 보고(dailyCheck 에서 호출). RECRUIT_SHEET_ID 없으면 아무것도 안 함. */
function postWeeklyRecruitIfDue_() {
  if (!getProp_('RECRUIT_SHEET_ID', false)) return;
  var targets = [];
  if (officeMode_()) { try { targets = roomsWithFeature_(rooms_(), 'report.recruit').map(function (x) { return x.chatId; }); } catch (e) {} }
  if (!targets.length && getOfficerChatId_()) targets = [getOfficerChatId_()];
  if (!targets.length) return;
  var t = ymd_(todayStr_());
  if (weekdayOf_(t.y, t.m, t.d) !== 1) return;
  var key = 'RECRUIT_WEEKLY_LAST';
  if (props_().getProperty(key) === todayStr_()) return;   // 같은 날 1회만
  var parsed = recruitLoad_();
  var weekly = recruitSummaryText_(parsed.rows, todayStr_(), recruitCharterDate_());
  targets.forEach(function (id) { tgSend_(id, weekly); });
  props_().setProperty(key, todayStr_());
}

// ── 명단 연결: 엑셀이면 구글시트로 변환까지 봇이 직접 ─────────────
/** 드라이브 주소 또는 ID 에서 파일 ID 추출(순수). 못 찾으면 '' */
function driveIdFromText_(t) {
  t = String(t || '').trim();
  var m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(t) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(t) || /^([A-Za-z0-9_-]{20,})$/.exec(t);
  return m ? m[1] : '';
}

/**
 * 명단 파일을 모집 현황에 연결한다. 구글시트면 그대로, 엑셀(xlsx)이면 구글시트로 변환한 뒤 연결.
 *  - 변환본은 원본과 같은 폴더에 같은 이름으로 생기고, 원본 엑셀은 이름 앞에 '(구) ' 를 붙여 남긴다(삭제하지 않음).
 *  - Drive REST API 를 스크립트 소유자 권한으로 호출(공유드라이브 지원). 반환 {id, converted, name}
 */
function recruitLinkFile_(fileId) {
  var file = DriveApp.getFileById(fileId), mime = file.getMimeType(), name = file.getName();
  if (mime === 'application/vnd.google-apps.spreadsheet') return { id: fileId, converted: false, name: name };
  if (mime !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && mime !== 'application/vnd.ms-excel') {
    throw new Error('스프레드시트 파일이 아닙니다: ' + name);
  }
  var parents = file.getParents(), body = { name: name.replace(/\.xlsx?$/i, ''), mimeType: 'application/vnd.google-apps.spreadsheet' };
  if (parents.hasNext()) body.parents = [parents.next().getId()];
  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?supportsAllDrives=true', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('변환 실패(' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  var newId = JSON.parse(res.getContentText()).id;
  try { file.setName('(구) ' + name); } catch (e) { Logger.log('원본 이름 변경 실패(무시 가능): ' + e); }
  return { id: newId, converted: true, name: body.name };
}

/** /linkroster <드라이브 주소|ID> — 권한 확인은 호출한 쪽 책임 */
function recruitLinkReply_(chat, user, text) {
  var arg = String(text || '').replace(/^\/\S+\s*/, ''), force = /(^|\s)(교체|replace)\s*$/i.test(arg);
  var id = driveIdFromText_(arg.replace(/\s*(교체|replace)\s*$/i, '')), cur = getProp_('RECRUIT_SHEET_ID', false);
  if (cur && !(id && force)) {                              // 이미 연결돼 있으면 다시 변환하지 않는다(같은 엑셀로 두 번 실행하면 시트가 둘로 갈라짐)
    var curName = '';
    try {
      var cf = DriveApp.getFileById(cur); curName = cf.getName();
      if (/^(\(구\)\s*)+/.test(curName)) { curName = curName.replace(/^(\(구\)\s*)+/, ''); cf.setName(curName); }   // 연결된 시트에 '(구)' 가 붙어 있으면 떼어 준다
    } catch (e) {}
    tgSend_(chat.id, '🔗 이미 연결된 명단이 있습니다: <b>' + escapeHtml_(curName || cur) + '</b>\nhttps://docs.google.com/spreadsheets/d/' + cur + '/edit' +
      (id ? '\n\n다른 파일로 바꾸려면 주소 뒤에 <code>교체</code> 를 붙이세요: <code>/linkroster 주소 교체</code>' : ''));
    return;
  }
  if (!id) { tgSend_(chat.id, '사용법: <code>/linkroster 명단파일_드라이브주소</code>\n엑셀(xlsx)이면 구글시트로 변환해서 연결합니다.'); return; }
  var r, parsed;
  try {
    r = recruitLinkFile_(id);
    var ss = SpreadsheetApp.openById(r.id);
    parsed = recruitParse_((ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0]).getDataRange().getValues());   // 읽히는지 먼저 검증
  } catch (e) { tgSend_(chat.id, '⚠️ 명단 연결 실패: ' + escapeHtml_(e.message)); return; }
  var before = getProp_('RECRUIT_SHEET_ID', false) || '';
  props_().setProperty('RECRUIT_SHEET_ID', r.id);
  try { audit_(user, '명단 연결', 'RECRUIT_SHEET_ID', before, r.id, r.converted ? '엑셀→구글시트 변환' : ''); } catch (e) {}
  tgSend_(chat.id, '✅ 명단 연결 완료: <b>' + escapeHtml_(r.name) + '</b> (' + parsed.rows.length + '명 인식)' +
    (r.converted ? '\n엑셀을 구글시트로 변환했습니다. 앞으로는 <b>구글시트만</b> 수정하세요. (원본 엑셀은 이름 앞에 "(구)" 를 붙여 보관)' : '') +
    '\nhttps://docs.google.com/spreadsheets/d/' + r.id + '/edit\n\n→ /recruit 로 현황을 확인하세요.');
}

// ── 확약여부 변경: /확약 이름 [이름…] · /검토중 … · /보류 … ─────────────
/** 무엇을 바꿀지 계산(순수). 반환 {changes:[{row,col,name,before}], same:[], notFound:[], ambiguous:[]} — row/col 은 1부터 */
function recruitStatusPlan_(values, names, status) {
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  var headerRow = -1;
  for (var r = 0; r < values.length && headerRow === -1; r++) for (var c = 0; c < values[r].length; c++) if (norm(values[r][c]) === '성명') { headerRow = r; break; }
  if (headerRow === -1) throw new Error("명단 시트에서 '성명' 열 제목을 찾지 못했습니다.");
  var head = values[headerRow].map(norm), nameCol = head.indexOf('성명'), stCol = head.indexOf('확약여부'), noCol = head.indexOf('번호');
  if (stCol === -1) throw new Error("명단 시트에 '확약여부' 열이 없습니다.");
  var out = { changes: [], same: [], notFound: [], ambiguous: [] }, seen = {};
  names.forEach(function (raw) {
    var n = norm(raw); if (!n || seen[n]) return; seen[n] = 1;
    var hits = [];
    for (var i = headerRow + 1; i < values.length; i++) {
      if (noCol !== -1 && !/^\d+$/.test(norm(values[i][noCol]))) continue;
      if (norm(values[i][nameCol]) === n) hits.push(i);
    }
    if (!hits.length) { out.notFound.push(n); return; }
    if (hits.length > 1) { out.ambiguous.push(n); return; }
    var before = recruitNormStatus_(values[hits[0]][stCol]);
    if (before === status) out.same.push(n); else out.changes.push({ row: hits[0] + 1, col: stCol + 1, name: n, before: before });
  });
  return out;
}

/** 권한 확인은 호출한 쪽 책임 */
function recruitSetStatusReply_(chat, user, text, status) {
  var names = String(text || '').replace(/^\/\S+\s*/, '').split(/[\s,，·]+/).filter(Boolean);
  if (!names.length) { tgSend_(chat.id, '사용법: <code>/' + status + ' 이름 [이름 …]</code>\n예) <code>/확약 홍길동 김영희</code> · <code>/보류 박철수</code> · <code>/검토중 이영수</code>'); return; }
  var id = getProp_('RECRUIT_SHEET_ID', false);
  if (!id) { tgSend_(chat.id, '⚠️ 명단 시트가 아직 연결되지 않았습니다.'); return; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { tgSend_(chat.id, '⚠️ 잠시 후 다시 시도해 주세요.'); return; }
  var L = [], kb = [];
  try {
    var ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0];
    var plan = recruitStatusPlan_(sh.getDataRange().getValues(), names, status);
    plan.changes.forEach(function (ch) {
      sh.getRange(ch.row, ch.col).setValue(status);
      try { audit_(user, '확약여부 변경', ch.name + ' (' + ch.row + '행)', ch.before, status, ''); } catch (e) {}
      L.push('✅ ' + escapeHtml_(ch.name) + ': ' + escapeHtml_(ch.before) + ' → <b>' + status + '</b>');
    });
    SpreadsheetApp.flush();
    if (plan.same.length) L.push('➖ 이미 ' + status + ': ' + plan.same.map(escapeHtml_).join(', '));
    if (plan.notFound.length) {
      var rosterNames = recruitParse_(sh.getDataRange().getValues()).rows.map(function (m) { return m.name; });
      plan.notFound.forEach(function (n) {
        var sug = recruitSuggestName_(rosterNames, n), btn = sug && recruitSuggestButton_('st', sug, status);
        L.push('❓ 명단에 없는 이름: ' + escapeHtml_(n) + (sug ? ' — 혹시 <b>' + escapeHtml_(sug) + '</b>?' : ''));
        if (btn) kb.push(btn);
      });
    }
    if (plan.ambiguous.length) L.push('⚠️ 같은 이름이 여러 명이라 시트에서 직접 바꿔 주세요: ' + plan.ambiguous.map(escapeHtml_).join(', '));
    var s = recruitSummary_(recruitParse_(sh.getDataRange().getValues()).rows), conf = recruitConf_();
    L.push(UI_LINE, '🎯 확약 <b>' + s.confirmed + '</b> / 목표 ' + conf.target + '명  ' + recruitBar_(s.confirmed, conf.target) +
      '\n' + recruitStatusKeys_(s.byStatus).map(function (k) { return escapeHtml_(k) + ' ' + s.byStatus[k]; }).join(' · '));
  } catch (e) { L.push('⚠️ 변경 중 오류: ' + escapeHtml_(e.message)); }
  finally { lock.releaseLock(); }
  tgSend_(chat.id, '🌱 <b>확약여부 변경</b>\n' + UI_LINE + '\n' + L.join('\n'), kb.length ? { inline_keyboard: kb } : null);
}

// ── 아호: 열을 성명 바로 앞에 두고, /아호 로 값 기재 ─────────────────
/** 아호 열 위치 계산(순수). 반환 {headerRow, nameCol, ahoCol(없으면 0), ok} — 1부터. ok=아호가 성명 바로 앞 */
function recruitAhoLayout_(values) {
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  for (var r = 0; r < values.length; r++) {
    var head = values[r].map(norm), n = head.indexOf('성명');
    if (n !== -1) { var a = head.indexOf('아호'); return { headerRow: r + 1, nameCol: n + 1, ahoCol: a + 1, ok: a !== -1 && a === n - 1 }; }
  }
  throw new Error("명단 시트에서 '성명' 열 제목을 찾지 못했습니다.");
}

/**
 * '아호' 열을 성명 바로 앞에 둔다(없으면 새로 만들고, 다른 곳에 있으면 값째 옮김). 이미 제자리면 아무것도 안 함(멱등).
 * 열 삽입이라 다른 탭의 수식 참조는 구글시트가 자동으로 따라 옮긴다. 봇은 열을 제목 이름으로 찾으므로 영향 없음. 반환=바꿨는지
 */
function recruitEnsureAhoBeforeName_(sh) {
  var lay = recruitAhoLayout_(sh.getDataRange().getValues());
  if (lay.ok) return false;
  sh.insertColumnBefore(lay.nameCol);                       // 새 열이 nameCol 자리에, 성명은 한 칸 뒤로
  sh.getRange(lay.headerRow, lay.nameCol).setValue(RECRUIT_COLS.aho);
  try { sh.setColumnWidth(lay.nameCol, 70); } catch (e) {}
  if (lay.ahoCol) {
    var old = lay.ahoCol >= lay.nameCol ? lay.ahoCol + 1 : lay.ahoCol, rows = sh.getLastRow() - lay.headerRow;
    if (rows > 0) sh.getRange(lay.headerRow + 1, lay.nameCol, rows, 1).setValues(sh.getRange(lay.headerRow + 1, old, rows, 1).getValues());
    sh.deleteColumn(old);
  }
  SpreadsheetApp.flush();
  try { audit_({ userId: '', name: '(봇)', role: '' }, '명단 열 정리', "'아호' 열을 성명 앞으로", lay.ahoCol ? lay.ahoCol + '열' : '없음', lay.nameCol + '열', ''); } catch (e) {}
  return true;
}

/** '이름 아호, 이름 아호 …' → [[이름, 아호]] (순수). 쉼표·줄바꿈으로 구분. 아호 자리에 '없음'/'-' 이면 지움('') */
function recruitAhoPairs_(text) {
  var out = [];
  String(text || '').replace(/^\/\S+\s*/, '').split(/[,，\n;]+/).forEach(function (seg) {
    var t = seg.trim().split(/\s+/).filter(Boolean);
    if (t.length < 2) return;
    var aho = t.slice(1).join(' ');
    out.push([t[0], /^(없음|-|x|삭제)$/i.test(aho) ? '' : aho]);
  });
  return out;
}

/** 권한 확인은 호출한 쪽 책임 */
function recruitSetAhoReply_(chat, user, text) {
  var pairs = recruitAhoPairs_(text), kb = [];
  if (!pairs.length) { tgSend_(chat.id, '사용법: <code>/아호 이름 아호, 이름 아호, …</code>\n예) <code>/아호 홍길동 청향, 김영희 다솜</code>  (지우기: <code>/아호 홍길동 없음</code>)'); return; }
  var id = getProp_('RECRUIT_SHEET_ID', false);
  if (!id) { tgSend_(chat.id, '⚠️ 명단 시트가 아직 연결되지 않았습니다.'); return; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { tgSend_(chat.id, '⚠️ 잠시 후 다시 시도해 주세요.'); return; }
  var L = [];
  try {
    var ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0];
    recruitEnsureAhoBeforeName_(sh);
    var values = sh.getDataRange().getValues(), lay = recruitAhoLayout_(values);
    var rosterNames = recruitParse_(values).rows.map(function (m) { return m.name; });
    pairs.forEach(function (pr) {
      var plan = recruitStatusPlan_(values, [pr[0]], '\u0000');          // 이름 찾기만 재사용(상태 비교는 항상 '다름')
      if (plan.notFound.length) {
        var sug = recruitSuggestName_(rosterNames, pr[0]), btn = sug && pr[1] && recruitSuggestButton_('aho', sug, pr[1]);
        L.push('❓ 명단에 없는 이름: ' + escapeHtml_(pr[0]) + (sug ? ' — 혹시 <b>' + escapeHtml_(sug) + '</b>?' : ''));
        if (btn) kb.push(btn);
        return;
      }
      if (plan.ambiguous.length) { L.push('⚠️ 같은 이름이 여러 명 — 시트에서 직접: ' + escapeHtml_(pr[0])); return; }
      var row = plan.changes[0].row, before = String(values[row - 1][lay.ahoCol - 1] || '').trim();
      if (before === pr[1]) { L.push('➖ ' + escapeHtml_(pr[0]) + ': 이미 ' + escapeHtml_(pr[1] || '(없음)')); return; }
      sh.getRange(row, lay.ahoCol).setValue(pr[1]);
      try { audit_(user, '아호 기재', pr[0] + ' (' + row + '행)', before, pr[1], ''); } catch (e) {}
      L.push('✅ ' + escapeHtml_((pr[1] ? pr[1] + ' ' : '') + pr[0]) + (before ? '  <i>(이전: ' + escapeHtml_(before) + ')</i>' : ''));
    });
  } catch (e) { L.push('⚠️ 기재 중 오류: ' + escapeHtml_(e.message)); }
  finally { lock.releaseLock(); }
  tgSend_(chat.id, '🖋 <b>아호 기재</b>\n' + UI_LINE + '\n' + L.join('\n') + '\n\n/recruitlist 로 확인하세요.', kb.length ? { inline_keyboard: kb } : null);
}

// ── 이름 오타 제안: 한 글자만 다른 이름이 '딱 한 명'이면 "혹시 ○○○?" + 버튼 ─────────
function recruitEditDist_(a, b) {
  var m = a.length, n = b.length, d = [], i, j;
  for (i = 0; i <= m; i++) { d[i] = [i]; }
  for (j = 1; j <= n; j++) d[0][j] = j;
  for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
  return d[m][n];
}
/** names 중 typed 와 한 글자 차이인 이름이 정확히 하나면 그 이름, 아니면 ''(순수). 자동 기재는 하지 않는다 — 사람이 버튼으로 확인 */
function recruitSuggestName_(names, typed) {
  var t = String(typed || '').replace(/\s+/g, ''), hit = [];
  if (t.length < 2) return '';
  names.forEach(function (n) { if (n !== t && hit.indexOf(n) === -1 && recruitEditDist_(n, t) === 1) hit.push(n); });
  return hit.length === 1 ? hit[0] : '';
}
/** 제안 버튼 한 줄. kind: 'aho'(value=아호) | 'st'(value=상태). callback_data 는 64바이트 제한 → 넘으면 버튼 생략 */
function recruitSuggestButton_(kind, name, value) {
  var data = kind + '|' + name + '|' + value, bytes = unescape(encodeURIComponent(data)).length;
  return bytes <= 64 ? [{ text: '✔ ' + name + ' (으)로 ' + (kind === 'aho' ? '기재' : '변경'), callback_data: data }] : null;
}

// ── 창립회기 직책 기재: /직책 이름 직책  (해제: /직책 이름 없음) ─────────────
/**
 * 무엇을 바꿀지 계산(순수). allowed=시트 드롭다운의 허용 값 목록(없으면 검사 생략).
 * 반환 {row,col,name,before,after} 또는 {error}. holder=같은 직책을 이미 맡은 다른 사람(있으면 막는다 — 한 자리 한 명)
 */
function recruitRolePlan_(values, name, role, allowed) {
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  var headerRow = -1;
  for (var r = 0; r < values.length && headerRow === -1; r++) for (var c = 0; c < values[r].length; c++) if (norm(values[r][c]) === '성명') { headerRow = r; break; }
  if (headerRow === -1) return { error: "명단 시트에서 '성명' 열 제목을 찾지 못했습니다." };
  var head = values[headerRow].map(norm), nameCol = head.indexOf('성명'), roleCol = head.indexOf('창립회기직책'), noCol = head.indexOf('번호');
  if (roleCol === -1) return { error: "명단 시트에 '창립회기 직책' 열이 없습니다." };
  var n = norm(name), want = /^(없음|해제|-|x)$/i.test(role) ? '' : String(role).trim(), hits = [], holder = '';
  if (want && allowed && allowed.length) {
    var ok = allowed.filter(function (a) { return norm(a) === norm(want); });
    if (!ok.length) return { error: '시트에 없는 직책입니다: ' + want, allowed: allowed };
    want = ok[0];                                          // 시트 목록의 표기 그대로(띄어쓰기 등)
  }
  for (var i = headerRow + 1; i < values.length; i++) {
    if (noCol !== -1 && !/^\d+$/.test(norm(values[i][noCol]))) continue;
    var nm = norm(values[i][nameCol]);
    if (nm === n) hits.push(i);
    else if (want && nm && norm(values[i][roleCol]) === norm(want)) holder = nm;
  }
  if (!hits.length) return { error: 'notfound', name: n };
  if (hits.length > 1) return { error: '같은 이름이 여러 명이라 시트에서 직접 바꿔 주세요: ' + n };
  if (holder) return { error: '「' + want + '」 자리는 이미 ' + holder + ' 님입니다. 먼저 /직책 ' + holder + ' 없음 으로 비운 뒤 다시 지정하세요.' };
  return { row: hits[0] + 1, col: roleCol + 1, name: n, before: String(values[hits[0]][roleCol] || '').trim(), after: want };
}

/** 권한 확인은 호출한 쪽 책임 */
function recruitSetRoleReply_(chat, user, text) {
  var args = String(text || '').replace(/^\/\S+\s*/, '').trim().split(/\s+/).filter(Boolean);
  if (args.length < 2) { tgSend_(chat.id, '사용법: <code>/직책 이름 직책</code>\n예) <code>/직책 홍길동 재무이사</code>  ·  해제: <code>/직책 홍길동 없음</code>'); return; }
  var id = getProp_('RECRUIT_SHEET_ID', false);
  if (!id) { tgSend_(chat.id, '⚠️ 명단 시트가 아직 연결되지 않았습니다.'); return; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { tgSend_(chat.id, '⚠️ 잠시 후 다시 시도해 주세요.'); return; }
  var msg, kb = null;
  try {
    var ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0], values = sh.getDataRange().getValues();
    var probe = recruitRolePlan_(values, args[0], args.slice(1).join(' ')), allowed = null;
    if (probe.col) {                                        // 그 칸의 드롭다운 목록을 읽어 목록 밖 값이 들어가지 않게 한다
      try { var dv = sh.getRange(probe.row, probe.col).getDataValidation(); if (dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) allowed = dv.getCriteriaValues()[0]; } catch (e) {}
    }
    var plan = allowed ? recruitRolePlan_(values, args[0], args.slice(1).join(' '), allowed) : probe;
    if (plan.error === 'notfound') {
      var sug = recruitSuggestName_(recruitParse_(values).rows.map(function (m) { return m.name; }), plan.name);
      msg = '❓ 명단에 없는 이름: ' + escapeHtml_(plan.name) + (sug ? ' — 혹시 <b>' + escapeHtml_(sug) + '</b>? 맞으면 <code>/직책 ' + escapeHtml_(sug) + ' ' + escapeHtml_(args.slice(1).join(' ')) + '</code>' : '');
    } else if (plan.error) {
      msg = '⚠️ ' + escapeHtml_(plan.error) + (plan.allowed ? '\n쓸 수 있는 직책: ' + plan.allowed.map(escapeHtml_).join(' · ') : '');
    } else if (plan.before === plan.after) {
      msg = '➖ ' + escapeHtml_(plan.name) + ': 이미 ' + escapeHtml_(plan.after || '(직책 없음)');
    } else {
      sh.getRange(plan.row, plan.col).setValue(plan.after);
      SpreadsheetApp.flush();
      try { audit_(user, '직책 지정', plan.name + ' (' + plan.row + '행)', plan.before, plan.after, ''); } catch (e) {}
      var rows = recruitParse_(sh.getDataRange().getValues()).rows.filter(function (m) { return m.role; })
        .sort(function (a, b) { return recruitRoleRank_(a.role) - recruitRoleRank_(b.role) || a.row - b.row; });
      msg = '✅ <b>' + escapeHtml_(plan.name) + '</b>: ' + escapeHtml_(plan.before || '(없음)') + ' → <b>' + escapeHtml_(plan.after || '(없음)') + '</b>\n' + UI_LINE +
        '\n<b>창립회기 임원 내정 ' + rows.length + '명</b>\n' + rows.map(function (m) { return ' ' + roleBadge_(m.role) + ' ' + escapeHtml_(m.role) + ' — ' + escapeHtml_(recruitLabel_(m)); }).join('\n');
    }
  } catch (e) { msg = '⚠️ 변경 중 오류: ' + escapeHtml_(e.message); }
  finally { lock.releaseLock(); }
  tgSend_(chat.id, '🎗 <b>직책 지정</b>\n' + UI_LINE + '\n' + msg, kb);
}

// ── 정식 클럽이 된 뒤: 명단 시트 머리글의 '(가칭)' 표기 제거 ─────────────
/** 바꿀 칸 계산(순수): 성명 제목 줄보다 위에 있는 칸 중 '(가칭)' 이 든 것 → [{row,col,value}] (1부터) */
function recruitProvisionalCells_(values) {
  var out = [], headerRow = values.length;
  for (var r = 0; r < values.length; r++) if (values[r].some(function (c) { return String(c).replace(/\s+/g, '') === '성명'; })) { headerRow = r; break; }
  for (var i = 0; i < headerRow; i++) for (var j = 0; j < values[i].length; j++) {
    var v = values[i][j];
    if (typeof v === 'string' && /\(\s*가칭\s*\)/.test(v)) out.push({ row: i + 1, col: j + 1, value: v.replace(/\s*\(\s*가칭\s*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim() });
  }
  return out;
}
function recruitDropProvisional_(sh) {
  var cells = recruitProvisionalCells_(sh.getDataRange().getValues());
  cells.forEach(function (c) { sh.getRange(c.row, c.col).setValue(c.value); });
  if (cells.length) { try { audit_({ userId: '', name: '(봇)', role: '' }, "명단 머리글 '(가칭)' 제거", cells.length + '칸', '', CLUB.riAdmittedDate + ' RI 가입', ''); } catch (e) {} }
  return cells.length;
}
