/**
 * Remote.js — 개발자 원격 도구 (clasp run 전용)
 *
 * 이 함수들은 텔레그램 명령 표에 없으므로 웹훅으로는 닿을 수 없다. Apps Script 실행 API(매니페스트 executionApi: MYSELF)로
 * 스크립트 소유자의 구글 로그인을 거쳐야만 실행된다 → 외부에 새 구멍을 만들지 않고 개발자가 직접 점검·수정할 수 있다.
 *
 *   clasp run-function remotePing
 *   clasp run-function remoteSimulate -p '[{"message":{"text":"/recruit","from":{"id":123},"chat":{"id":123,"type":"private"}}}]'
 *   clasp run-function remoteSet -p '["창립일","2026-10-14"]'
 *   clasp run-function remoteWebhookInfo · remoteErrors -p '[20]' · remoteLog -p '[20]'
 *
 * 비밀값(토큰·웹훅 비밀값)은 어떤 함수도 반환하지 않는다.
 */

// 시트를 바꾸지 않는 명령 — remoteSimulate 가 기본으로 허용하는 범위
var REMOTE_READONLY_CMDS = ['/help', '/도움말', '/start', '/id', '/whoami', '/내권한', '/recruit', '/모집현황', '/recruitlist', '/모집명단',
  '/recruitcheck', '/모집점검', '/log', '/로그', '/rooms', '/방목록', '/form', '/양식', '/save', '/보관', '/guide', '/사용법', '/안내', '/prep', '/준비', '/edu', '/교육', '/이수현황', '/edu', '/교육', '/schedule', '/일정'];

/**
 * 가상 실행: 텔레그램 업데이트를 실제 시트를 상대로 처리하되, **텔레그램으로는 아무것도 보내지 않고** 봇이 보냈을 내용을 돌려준다.
 * 시트를 바꾸는 명령·양식·버튼은 allowWrites=true 일 때만 실행한다(기본은 거부).
 */
function remoteSimulate(update, allowWrites) {
  if (typeof update === 'string') update = JSON.parse(update);
  var m = update.message, cq = update.callback_query;
  var text = m ? String(m.text || '').trim() : '', cmd = text.charAt(0) === '/' ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';
  var readOnly = !!m && !!cmd && REMOTE_READONLY_CMDS.indexOf(cmd) !== -1 && !(m.reply_to_message && docsIsCmd_(text));
  if (!readOnly && !allowWrites) return { refused: '시트를 바꿀 수 있는 요청입니다. 실제로 실행하려면 두 번째 인자를 true 로.', what: cmd || (cq ? '버튼' : '글/파일') };

  var out = [], keep = { send: tgSend_, api: tgApi_, ans: tgAnswerCallback_ };
  tgSend_ = function (chatId, body, kb) {
    out.push({ to: String(chatId), text: body, buttons: kb && kb.inline_keyboard ? kb.inline_keyboard.map(function (r) { return r.map(function (b) { return b.text + ' ⟶ ' + b.callback_data; }); }) : undefined });
    return { ok: true, result: { message_id: 0 } };
  };
  tgApi_ = function (method) { out.push({ api: method }); return { ok: true, result: {} }; };
  tgAnswerCallback_ = function (id, body) { out.push({ toast: body }); return { ok: true }; };
  var error = null;
  try { if (cq) handleCallback_(cq); else if (m) handleMessage_(m); }
  catch (e) { error = String(e && e.message || e) + '\n' + String(e && e.stack || '').slice(0, 600); }
  finally { tgSend_ = keep.send; tgApi_ = keep.api; tgAnswerCallback_ = keep.ans; }
  return { wrote: !readOnly, replies: out, error: error };
}

/** 설정 탭 값 변경(/set 과 같은 검증). 로그에는 '(원격)'으로 남는다 */
function remoteSet(key, value) {
  try { seedSettings_(); } catch (e) {}
  var sh = getOrCreateSheet_(getSS_(), SETTINGS_SHEET, SETTINGS_HEADERS), plan = settingsSetPlan_(sh.getDataRange().getValues(), key, value);
  if (plan.error) return plan;
  if (plan.before === plan.value) return { unchanged: plan.value };
  if (plan.row) sh.getRange(plan.row, 2).setNumberFormat('@').setValue(plan.value); else sh.appendRow([key, plan.value, '']);
  invalidateSettings_();
  audit_({ userId: '', name: '(원격) 개발자', role: '' }, '설정 변경', key, plan.before, plan.value, 'clasp run');
  return { key: key, before: plan.before, after: plan.value };
}

/** 텔레그램이 보는 웹훅 상태: 밀린 메시지 수, 마지막 오류. (주소는 호스트만) */
function remoteWebhookInfo() {
  var r = tgApi_('getWebhookInfo', {}), w = (r && r.result) || {};
  return { ok: !!(r && r.ok), host: String(w.url || '').replace(/^https?:\/\/([^\/]+).*$/, '$1'), pending: w.pending_update_count,
    lastError: w.last_error_message || '', lastErrorAt: w.last_error_date ? Utilities.formatDate(new Date(w.last_error_date * 1000), TZ, 'yyyy-MM-dd HH:mm:ss') : '',
    allowed: w.allowed_updates };
}

function remoteTail_(sheetName, headers, n) {
  var v = getOrCreateSheet_(getSS_(), sheetName, headers).getDataRange().getValues();
  return v.slice(1).slice(-(n || 20)).map(function (r) { return r.map(function (c) { return Object.prototype.toString.call(c) === '[object Date]' ? Utilities.formatDate(c, TZ, 'yyyy-MM-dd HH:mm:ss') : c; }); });
}
/** 등록된 방 가운데 해당 유형의 방에 사용 설명서를 올리고 고정한다(실제 텔레그램 전송). 반환: 보낸 방 이름과 성공 여부 */
function remotePostGuide(type) {
  if (!ROOM_TYPES[type]) return { error: '없는 방 유형: ' + type, types: Object.keys(ROOM_TYPES) };
  return rooms_().filter(function (r) { return r.type === type; }).map(function (r) {
    var res = officePostGuide_(r.chatId, type, true);
    return { room: r.name, ok: !!(res && res.ok), error: res && !res.ok ? res.description : undefined };
  });
}

/** 준비 체크리스트 초안 채우기(「준비」 탭이 비어 있을 때만). 반환=채운 줄 수 */
function remotePrepSeed() { var n = prepSeedIfEmpty_(); if (n) audit_({ userId: '', name: '(원격) 개발자', role: '' }, '준비 체크리스트 초안', PREP_SHEET, '', n + '항목', 'clasp run'); return { seeded: n, total: prepItems_().length }; }

function remoteErrors(n) { return remoteTail_(ERRORS_SHEET, ERRORS_HEADERS, n); }
function remoteLog(n) { return remoteTail_(AUDIT_SHEET, AUDIT_HEADERS, n); }

/**
 * 명단 시트에 회원 사진 넣기: 「사진」 열(성명 바로 뒤, 없으면 생성)에 썸네일을 셀 안 이미지로 넣고, 메모에 원본 사진 링크를 단다.
 *  - 사진 위치: 공유드라이브/02_회원명부·가입신청서/회원사진/성명.(jpg|png), 썸네일은 그 아래 '_썸네일(시트용)'/성명.jpg (160px)
 *  - 파일명(확장자 제외)이 성명과 정확히 같은 회원에게만 넣는다. 셀 이미지가 안 되면 '사진 보기' 링크로 대신한다.
 *  - 여러 번 실행해도 안전(같은 칸을 다시 채울 뿐). 반환: 누구에게 넣었고 누가 사진이 없는지
 */
function remoteRosterPhotos() {
  var sub = function (parent, name) { var it = parent.getFoldersByName(name); if (!it.hasNext()) throw new Error('폴더 없음: ' + name); return it.next(); };
  var photos = sub(sub(DriveApp.getFolderById(getProp_('DRIVE_FOLDER_ID', true)), '02_회원명부·가입신청서'), '회원사진'), thumbs = sub(photos, '_썸네일(시트용)');
  var stem = function (n) { return String(n).replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/\s+/g, ''); };
  var full = {}, it = photos.getFiles();
  while (it.hasNext()) { var f = it.next(); full[stem(f.getName())] = f.getUrl(); }

  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0];
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  var lay = recruitAhoLayout_(sh.getDataRange().getValues()), head = sh.getRange(lay.headerRow, 1, 1, sh.getLastColumn()).getValues()[0].map(norm);
  var col = head.indexOf('사진') + 1, created = false;
  if (!col) { var after = head.indexOf('성명') + 1; sh.insertColumnAfter(after); col = after + 1; created = true; sh.getRange(lay.headerRow, col).setValue('사진'); }
  try { sh.setColumnWidth(col, 72); } catch (e) {}

  var values = sh.getDataRange().getValues(), out = { created: created, image: [], link: [], notFound: [], noPhoto: [] }, got = {};
  var tf = thumbs.getFiles();
  while (tf.hasNext()) {
    var t = tf.next(), person = stem(t.getName()), plan = recruitStatusPlan_(values, [person], '(이름 찾기 전용)');
    if (plan.notFound.length || plan.ambiguous.length) { out.notFound.push(person); continue; }
    var row = plan.changes[0].row, cell = sh.getRange(row, col), url = full[person] || t.getUrl();
    try {
      var blob = t.getBlob(), img = SpreadsheetApp.newCellImage().setSourceUrl('data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()))
        .setAltTextTitle(person).setAltTextDescription(url).build();
      cell.setValue(img); out.image.push(person);
    } catch (e) {
      cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText('사진 보기').setLinkUrl(url).build()); out.link.push(person);
    }
    cell.setNote('원본 사진: ' + url).setHorizontalAlignment('center').setVerticalAlignment('middle');
    try { sh.setRowHeight(row, 72); } catch (e2) {}
    got[person] = 1;
  }
  recruitParse_(sh.getDataRange().getValues()).rows.forEach(function (m) { if (!got[m.name]) out.noPhoto.push(m.name); });
  SpreadsheetApp.flush();
  try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '회원 사진 넣기', '명단 「사진」 열', '', out.image.length + out.link.length + '명', 'clasp run'); } catch (e3) {}
  return out;
}

/** 명단 시트의 열 제목 바꾸기(값은 그대로). 새 제목이 이미 있으면 아무것도 안 함 */
function remoteRenameColumn(oldTitle, newTitle) {
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0];
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  var lay = recruitAhoLayout_(sh.getDataRange().getValues()), head = sh.getRange(lay.headerRow, 1, 1, sh.getLastColumn()).getValues()[0].map(norm);
  if (head.indexOf(norm(newTitle)) !== -1) return { unchanged: newTitle };
  var col = head.indexOf(norm(oldTitle)) + 1;
  if (!col) return { error: '열 없음: ' + oldTitle };
  sh.getRange(lay.headerRow, col).setValue(newTitle);
  try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '명단 열 제목 변경', col + '열', oldTitle, newTitle, 'clasp run'); } catch (e) {}
  return { column: col, before: oldTitle, after: newTitle };
}

/** 「관리위원별 현황」 탭의 관리위원 이름 칸(제목 '관리위원' 바로 아래)을 names 로 채운다. 집계 수식은 이름이 명단의 「담당 관리위원」 값과 같아야 맞는다 */
function remoteSetManagers(names) {
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true));
  var sh = ss.getSheets().filter(function (s) { return s.getName().indexOf('관리위원') !== -1; })[0];
  if (!sh) return { error: '관리위원 탭 없음' };
  var v = sh.getDataRange().getValues(), hr = -1;
  for (var r = 0; r < v.length && hr === -1; r++) if (String(v[r][0]).replace(/\s+/g, '') === '관리위원') hr = r;
  if (hr === -1) return { error: "'관리위원' 제목 칸 없음" };
  var slots = 0;
  for (var i = hr + 1; i < v.length; i++) { if (/입력하면|자동 집계/.test(String(v[i][0]))) break; slots++; }
  if (names.length > slots) return { error: '이름 칸이 ' + slots + '개뿐입니다.' };
  var before = v.slice(hr + 1, hr + 1 + slots).map(function (row) { return row[0]; }).filter(String);
  var col = names.concat(new Array(slots - names.length).fill('')).map(function (n) { return [n]; });
  sh.getRange(hr + 2, 1, slots, 1).setValues(col);
  SpreadsheetApp.flush();
  try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '관리위원 이름 설정', sh.getName(), before.join(', '), names.join(', '), 'clasp run'); } catch (e) {}
  return { tab: sh.getName(), before: before, after: names, rows: sh.getRange(hr + 2, 1, names.length, 5).getValues() };
}

/**
 * 구글 문서의 내용을 HTML 원본으로 통째로 교체한다(문서 ID·주소·공유 설정은 그대로).
 *  - 원본 HTML 은 공유드라이브 「99_봇데이터/_문서원본/<htmlName>」 에 둔다(리포의 clubs/<club>/docs/*.html 을 복사).
 *  - Drive 업로드 API 의 '가져오기 변환'을 쓰므로 새 권한(문서 API)이 필요 없다 — 기존 드라이브 권한으로 동작.
 *  - 문서에 사람이 직접 고친 내용이 있으면 사라진다 → 봇이 관리하는 안내 문서에만 쓸 것.
 */
function remoteDocFromHtml(docId, htmlName) {
  var sub = function (parent, name) { var it = parent.getFoldersByName(name); if (!it.hasNext()) throw new Error('폴더 없음: ' + name); return it.next(); };
  var src = sub(sub(DriveApp.getFolderById(getProp_('DRIVE_FOLDER_ID', true)), '99_봇데이터'), '_문서원본').getFilesByName(htmlName);
  if (!src.hasNext()) return { error: '원본 없음: ' + htmlName };
  var doc = DriveApp.getFileById(docId);
  if (doc.getMimeType() !== 'application/vnd.google-apps.document') return { error: '구글 문서가 아닙니다: ' + doc.getName() };
  var bytes = Utilities.newBlob(src.next().getBlob().getDataAsString('UTF-8'), 'text/html').getBytes();
  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files/' + docId + '?uploadType=media&supportsAllDrives=true', {
    method: 'patch', contentType: 'text/html; charset=UTF-8', payload: bytes,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  var ok = res.getResponseCode() === 200;
  if (ok) { try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '문서 내용 교체', doc.getName(), '', htmlName + ' (' + bytes.length + ' bytes)', 'clasp run'); } catch (e) {} }
  return { ok: ok, code: res.getResponseCode(), doc: doc.getName(), bytes: bytes.length, error: ok ? undefined : res.getContentText().slice(0, 300) };
}

/**
 * 직책 명칭 바꾸기(예: '분과6 위원장(명칭 미정)' → 'DEI위원장'): 명단 파일의 모든 탭에서 그 글자와 '완전히 같은' 칸을 바꾸고,
 * 명단 「창립회기 직책」 열의 드롭다운이 직접 입력한 목록이면 목록 값도 바꾼다(범위를 참조하는 드롭다운이면 칸만 바꾸면 따라온다).
 * 봇 데이터시트의 「임원」 탭도 함께 바꾼다.
 */
function remoteRenameRole(oldTitle, newTitle) {
  var out = { cells: {}, validation: '' }, roster = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true));
  [roster, getSS_()].forEach(function (ss) {
    ss.getSheets().forEach(function (sh) {
      var n = sh.createTextFinder(oldTitle).matchEntireCell(true).replaceAllWith(newTitle);
      if (n) out.cells[ss.getName() + ' / ' + sh.getName()] = n;
    });
  });
  var sh = roster.getSheetByName(recruitConf_().tab) || roster.getSheets()[0], values = sh.getDataRange().getValues(), lay = recruitAhoLayout_(values);
  var col = values[lay.headerRow - 1].map(function (h) { return String(h).replace(/\s+/g, ''); }).indexOf('창립회기직책') + 1;
  if (col) {
    var rows = Math.max(1, sh.getMaxRows() - lay.headerRow), rng = sh.getRange(lay.headerRow + 1, col, rows, 1), rules = rng.getDataValidations(), changed = 0, kind = '';
    for (var i = 0; i < rules.length; i++) {
      var dv = rules[i][0];
      if (!dv) continue;
      kind = String(dv.getCriteriaType());
      if (dv.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) continue;
      var list = dv.getCriteriaValues()[0];
      if (list.indexOf(oldTitle) === -1) continue;
      rules[i][0] = dv.copy().requireValueInList(list.map(function (v) { return v === oldTitle ? newTitle : v; }), true).build();
      changed++;
    }
    if (changed) rng.setDataValidations(rules);
    out.validation = kind + (changed ? ' — 목록 ' + changed + '칸 갱신' : ' — 갱신 불필요');
    var dv0 = sh.getRange(lay.headerRow + 1, col).getDataValidation();
    if (dv0 && dv0.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) out.list = dv0.getCriteriaValues()[0];
  }
  SpreadsheetApp.flush();
  try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '직책 명칭 변경', oldTitle, oldTitle, newTitle, 'clasp run'); } catch (e) {}
  return out;
}

/** 명단 탭 제목 줄 위쪽(요약 영역)의 수식·글자에서 old → new 로 바꾼다. 회원 줄은 건드리지 않는다. 반환: 바뀐 칸과 전후 */
function remoteRosterHeaderReplace(oldText, newText) {
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0];
  var lay = recruitAhoLayout_(sh.getDataRange().getValues()), rng = sh.getRange(1, 1, lay.headerRow - 1, sh.getLastColumn());
  var f = rng.getFormulas(), v = rng.getValues(), out = [];
  for (var r = 0; r < f.length; r++) for (var c = 0; c < f[r].length; c++) {
    var cur = f[r][c] || (typeof v[r][c] === 'string' ? v[r][c] : '');
    if (!cur || cur.indexOf(oldText) === -1) continue;
    var next = cur.split(oldText).join(newText);
    sh.getRange(r + 1, c + 1).setFormula(f[r][c] ? next : null) ; if (!f[r][c]) sh.getRange(r + 1, c + 1).setValue(next);
    out.push({ cell: sh.getRange(r + 1, c + 1).getA1Notation(), before: cur, after: next });
  }
  SpreadsheetApp.flush();
  if (out.length) { try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '명단 요약 수식 변경', out.map(function (x) { return x.cell; }).join(','), oldText, newText, 'clasp run'); } catch (e) {} }
  return out;
}

/**
 * 회원 소개 앨범을 방에 게시: 명단(확약)을 임원 서열순으로, 사진 폴더의 원본 사진을 텔레그램 앨범(10장 묶음)으로 보낸다.
 * 캡션 = 아호 성명 · 직책(동호회장) · 직업분류. 연락처·생년 등은 넣지 않는다. 사진 없는 회원은 마지막에 글로 안내.
 * chatId 생략 시 회장단 방. 반환: 보낸 묶음 수·사진 없는 사람
 */
function remoteIntroAlbum(chatId) {
  var rooms = rooms_(), target = chatId || (rooms.filter(function (r) { return r.type === '회장단'; })[0] || {}).chatId;
  if (!target) return { error: '회장단 방이 없습니다.' };
  var sub = function (p, n) { var it = p.getFoldersByName(n); if (!it.hasNext()) throw new Error('폴더 없음: ' + n); return it.next(); };
  var photos = sub(sub(DriveApp.getFolderById(getProp_('DRIVE_FOLDER_ID', true)), '02_회원명부·가입신청서'), '회원사진');
  var files = {}, it = photos.getFiles();
  while (it.hasNext()) { var f = it.next(); files[f.getName().replace(/\.[A-Za-z0-9]+$/, '').replace(/\s+/g, '')] = f; }
  var subs = recruitSubTitles_(), rows = recruitParse_((function () { var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)); return (ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0]).getDataRange().getValues(); })()).rows
    .filter(function (m) { return m.status === '확약'; })
    .sort(function (a, b) { return recruitRoleRank_(a.role) - recruitRoleRank_(b.role) || a.row - b.row; });
  var media = [], blobs = [], noPhoto = [];
  rows.forEach(function (m, i) {
    var f = files[m.name];
    if (!f) { noPhoto.push(recruitLabel_(m)); return; }
    var cap = (i + 1) + '. ' + recruitLabel_(m) + (m.role ? ' — ' + m.role + (subs[m.name] ? '(' + subs[m.name] + ')' : '') : (subs[m.name] ? ' — ' + subs[m.name] : '')) + (m.job ? '\n' + m.job : '');
    var key = 'p' + blobs.length;
    blobs.push({ key: key, blob: f.getBlob().setName(key + '.jpg') });
    media.push({ type: 'photo', media: 'attach://' + key, caption: cap });
  });
  tgSend_(target, '👥 <b>' + CLUB.short + ' 창립회원 소개</b> — 확약 ' + rows.length + '명 (임원 서열순)\n' + UI_LINE);
  var sentGroups = 0;
  for (var s = 0; s < media.length; s += 10) {
    var chunk = media.slice(s, s + 10), payload = { chat_id: target, media: JSON.stringify(chunk) };
    blobs.slice(s, s + 10).forEach(function (b) { payload[b.key] = b.blob; });
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + getToken_() + '/sendMediaGroup', { method: 'post', payload: payload, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) sentGroups++; else return { error: 'sendMediaGroup ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200), sentGroups: sentGroups };
  }
  if (noPhoto.length) tgSend_(target, '📷 사진 준비 중: ' + noPhoto.map(escapeHtml_).join(', '));
  try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '회원 소개 앨범 게시', String(target), '', rows.length + '명 · ' + sentGroups + '묶음', 'clasp run'); } catch (e) {}
  return { members: rows.length, groups: sentGroups, noPhoto: noPhoto };
}

/**
 * 회원 소개를 한 사람씩(사진 1장 + 소개 캡션) 방에 올린다. 임원단 → 회원 순. 사진 없는 회원은 글로만.
 * 보낸 메시지 ID는 Script Property INTRO_MSGS_<chat> 에 저장해 다음 게시 때 지울 수 있게 한다.
 * roomTypes: ['회장단','임원'] 등. 반환: 방별 보낸 수
 */
function remoteIntroSolo(roomTypes) {
  var rooms = rooms_().filter(function (r) { return (roomTypes || ['회장단']).indexOf(r.type) !== -1; });
  if (!rooms.length) return { error: '해당 방 없음' };
  var sub = function (p, n) { var it = p.getFoldersByName(n); if (!it.hasNext()) throw new Error('폴더 없음: ' + n); return it.next(); };
  var photos = sub(sub(DriveApp.getFolderById(getProp_('DRIVE_FOLDER_ID', true)), '02_회원명부·가입신청서'), '회원사진');
  var files = {}, it = photos.getFiles();
  while (it.hasNext()) { var f = it.next(); files[f.getName().replace(/\.[A-Za-z0-9]+$/, '').replace(/\s+/g, '')] = f; }
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0];
  var subs = recruitSubTitles_(), rows = recruitParse_(sh.getDataRange().getValues()).rows.filter(function (m) { return m.status === '확약'; })
    .sort(function (a, b) { return recruitRoleRank_(a.role) - recruitRoleRank_(b.role) || a.row - b.row; });
  var blobs = {}; rows.forEach(function (m) { if (files[m.name]) blobs[m.name] = files[m.name].getBlob(); });
  var out = {};
  rooms.forEach(function (r) {
    remoteIntroClear_(r.chatId);
    var ids = [], head = tgSend_(r.chatId, '👥 <b>' + CLUB.short + ' 창립회원 소개</b> · 확약 ' + rows.length + '명\n' + UI_LINE + '\n임원단부터 차례로 소개합니다.');
    if (head && head.ok) ids.push(head.result.message_id);
    rows.forEach(function (m) {
      var title = m.role ? roleBadge_(m.role) + ' ' : '🙂 ', line2 = m.role ? m.role + (subs[m.name] ? ' · ' + subs[m.name] : '') : (subs[m.name] || '회원');
      var cap = title + '<b>' + escapeHtml_(recruitLabel_(m)) + '</b>\n' + escapeHtml_(line2) + (m.job ? '\n' + escapeHtml_(m.job) + (m.company ? ' (' + escapeHtml_(m.company) + ')' : '') : '');
      var res;
      if (blobs[m.name]) {
        var raw = UrlFetchApp.fetch('https://api.telegram.org/bot' + getToken_() + '/sendPhoto', { method: 'post', payload: { chat_id: r.chatId, caption: cap, parse_mode: 'HTML', photo: blobs[m.name].setName(m.name + '.jpg') }, muteHttpExceptions: true });
        res = JSON.parse(raw.getContentText());
      } else res = tgSend_(r.chatId, '📷 (사진 준비 중)\n' + cap);
      if (res && res.ok) ids.push(res.result.message_id);
    });
    props_().setProperty('INTRO_MSGS_' + r.chatId, JSON.stringify(ids));
    out[r.name] = ids.length;
  });
  try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '회원 소개(개별) 게시', Object.keys(out).join(', '), '', rows.length + '명', 'clasp run'); } catch (e) {}
  return out;
}
/** 이전에 올린 소개 메시지 삭제(ID 를 저장해 둔 것만) */
function remoteIntroClear_(chatId) {
  var raw = props_().getProperty('INTRO_MSGS_' + chatId); if (!raw) return 0;
  var n = 0; JSON.parse(raw).forEach(function (id) { var r = tgApi_('deleteMessage', { chat_id: chatId, message_id: id }); if (r && r.ok) n++; });
  props_().deleteProperty('INTRO_MSGS_' + chatId); return n;
}
/** 방의 특정 메시지 ID 들을 삭제(앨범처럼 ID 를 저장 못 한 경우). ids: [번호…] */
function remoteDeleteMessages(chatId, ids) {
  return ids.map(function (id) { var r = tgApi_('deleteMessage', { chat_id: chatId, message_id: id }); return { id: id, ok: !!(r && r.ok), err: r && r.description }; });
}

/** 「창립회기 임원」 탭의 수식·값을 읽어 온다(구조 파악용) */
function remoteBoardInspect() {
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheets().filter(function (s) { return s.getName().indexOf('임원') !== -1; })[0];
  if (!sh) return { error: '임원 탭 없음' };
  var rng = sh.getDataRange(), f = rng.getFormulas(), v = rng.getValues(), out = [];
  for (var r = 0; r < v.length; r++) out.push(v[r].map(function (c, i) { return f[r][i] || (c === '' ? '' : String(c)); }));
  return { tab: sh.getName(), rows: out, validation: sh.getRange(5, 1).getDataValidation() ? 'has' : 'none' };
}

/**
 * 「창립회기 임원」 탭 보강:
 *  - 성명 옆에 「사진」 열(셀 이미지)을 만들고 회원 사진 썸네일을 넣는다. 성명이 바뀌면 다시 실행하면 갱신.
 *  - 차기회장 줄: 창립 회기엔 초대회장 겸임 → 성명 칸에 값(수식 대신)으로 기재, 상태 '겸임'.
 *  - 표 아래에 동호회 줄(골프회 회장·골프회 총무·문화레저동호회 회장)을 추가하고 봇 설정값(아호 성명)으로 채운다. 이미 있으면 갱신.
 */
function remoteBoardDecorate() {
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheets().filter(function (s) { return s.getName().indexOf('임원') !== -1; })[0];
  if (!sh) return { error: '임원 탭 없음' };
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  var v = sh.getDataRange().getValues(), hr = -1;
  for (var r = 0; r < v.length && hr === -1; r++) if (norm(v[r][0]) === '직책') hr = r;
  if (hr === -1) return { error: "'직책' 제목 줄 없음" };
  var head = v[hr].map(norm), nameCol = head.indexOf('성명') + 1, out = { photos: [], noPhoto: [], added: [], updated: [] };
  var photoCol = head.indexOf('사진') + 1;
  if (!photoCol) { sh.insertColumnAfter(nameCol); photoCol = nameCol + 1; sh.getRange(hr + 1, photoCol).setValue('사진'); try { sh.setColumnWidth(photoCol, 72); } catch (e) {} }

  // 표 범위: 제목 줄 다음부터 직책 칸이 비는 곳까지
  var last = hr + 1; while (last < v.length && norm(v[last][0])) last++;
  var roleRows = {}; for (var i = hr + 1; i < last; i++) roleRows[norm(v[i][0])] = i + 1;

  // 차기회장 = 초대회장 겸임(값으로)
  var pres = String(sh.getRange(roleRows['회장'], nameCol).getValue() || '').trim();
  if (roleRows['차기회장'] && pres) {
    var rr = roleRows['차기회장'], stCol = head.indexOf('상태') + 1, jobCol = head.indexOf('직업분류') + 1, okCol = head.indexOf('확약여부') + 1;
    sh.getRange(rr, nameCol).setValue(pres);
    if (jobCol) sh.getRange(rr, jobCol).setFormula(sh.getRange(roleRows['회장'], jobCol).getFormula() || '');
    if (okCol) sh.getRange(rr, okCol).setValue('확약');
    if (stCol) sh.getRange(rr, stCol).setValue('초대회장 겸임');
    out.updated.push('차기회장 ← ' + pres + ' (겸임)');
  }

  // 동호회 줄(표 바로 아래, '내정 N / 미정 M' 집계 줄 위가 아니라 표 끝에 이어 붙임)
  var clubs = [['골프회 회장', '동호회', recruitNameOf_(setting_('골프회_회장', ''))], ['골프회 총무', '동호회', recruitNameOf_(setting_('골프회_총무', ''))], ['문화레저동호회 회장', '동호회', recruitNameOf_(setting_('문화레저동호회_회장', ''))]];
  var insertAt = last + 1;                                  // 1-based row of first empty line after the table
  clubs.forEach(function (c) {
    var row = roleRows[norm(c[0])];
    if (!row) { sh.insertRowBefore(insertAt); row = insertAt; insertAt++; sh.getRange(row, 1, 1, 2).setValues([[c[0], c[1]]]); out.added.push(c[0]); }
    var nm = c[2] || '', full = String(setting_(c[0] === '골프회 회장' ? '골프회_회장' : c[0] === '골프회 총무' ? '골프회_총무' : '문화레저동호회_회장', '')).trim();
    var ahoC = head.indexOf('아호') + 1;                 // 아호 열이 있으면 아호·성명을 따로 적는다
    if (ahoC) { var fp = full.split(/s+/); sh.getRange(row, nameCol).setValue(nm); sh.getRange(row, ahoC).setValue(fp.length > 1 ? fp.slice(0, -1).join(' ') : ''); }
    else sh.getRange(row, nameCol).setValue(full || nm);
    var jc = head.indexOf('직업분류') + 1, oc = head.indexOf('확약여부') + 1, sc = head.indexOf('상태') + 1;
    if (nm && jc) sh.getRange(row, jc).setFormula("=IFERROR(INDEX('예비회원명단'!$H$7:$H$36,MATCH(" + sh.getRange(row, nameCol).getA1Notation() + ",'예비회원명단'!$C$7:$C$36,0)),\"\")");
    if (oc) sh.getRange(row, oc).setValue(nm ? '확약' : '');
    if (sc) sh.getRange(row, sc).setValue(nm ? '겸임' : '미정');
    roleRows[norm(c[0])] = row;
    if (out.added.indexOf(c[0]) === -1) out.updated.push(c[0] + ' ← ' + (nm || '(비움)'));
  });
  SpreadsheetApp.flush();

  // 사진: 성명 칸 값 기준으로 썸네일 삽입
  var sub = function (p, n) { var it = p.getFoldersByName(n); if (!it.hasNext()) throw new Error('폴더 없음: ' + n); return it.next(); };
  var thumbs = sub(sub(sub(DriveApp.getFolderById(getProp_('DRIVE_FOLDER_ID', true)), '02_회원명부·가입신청서'), '회원사진'), '_썸네일(시트용)'), tf = thumbs.getFiles(), blobs = {};
  while (tf.hasNext()) { var t = tf.next(); blobs[t.getName().replace(/\.[A-Za-z0-9]+$/, '')] = t; }
  var v2 = sh.getDataRange().getValues();
  for (var k = hr + 1; k < v2.length; k++) {
    var nm2 = String(v2[k][nameCol - 1] || '').trim().split(/s+/).pop(); if (!nm2 || !norm(v2[k][0]) || /^(내정|미정)$/.test(norm(v2[k][0]))) continue;   // '아호 성명' 이면 성명만
    var cell = sh.getRange(k + 1, photoCol);
    if (blobs[nm2]) {
      var b = blobs[nm2].getBlob();
      cell.setValue(SpreadsheetApp.newCellImage().setSourceUrl('data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes())).setAltTextTitle(nm2).build());
      cell.setHorizontalAlignment('center').setVerticalAlignment('middle'); try { sh.setRowHeight(k + 1, 72); } catch (e) {}
      out.photos.push(nm2);
    } else { cell.setValue(''); out.noPhoto.push(nm2); }
  }
  SpreadsheetApp.flush();
  try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '임원 탭 보강', sh.getName(), '', '사진 ' + out.photos.length + ' · 추가 ' + out.added.join(',') , 'clasp run'); } catch (e) {}
  return out;
}

/**
 * 「창립회기 임원」 탭 성명 칸을 '아호 성명'으로: 수식 칸은 아호(B)+성명(C)을 합치는 수식으로, 값 칸(겸임·동호회)은 명단에서 아호를 찾아 앞에 붙인다.
 * 사진은 성명 칸이 '아호 성명'이어도 찾도록 마지막 낱말로 매칭한다(remoteBoardDecorate 재실행).
 */
function remoteBoardAho() {
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheets().filter(function (s) { return s.getName().indexOf('임원') !== -1; })[0];
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  var rng = sh.getDataRange(), v = rng.getValues(), f = rng.getFormulas(), hr = -1;
  for (var r = 0; r < v.length && hr === -1; r++) if (norm(v[r][0]) === '직책') hr = r;
  var nameCol = v[hr].map(norm).indexOf('성명'), ahoOf = {};
  recruitParse_((ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0]).getDataRange().getValues()).rows.forEach(function (m) { ahoOf[m.name] = m.aho; });
  var out = { formula: 0, value: 0 };
  for (var i = hr + 1; i < v.length; i++) {
    if (!norm(v[i][0]) || /^(내정|미정)$/.test(norm(v[i][0]))) continue;
    var cell = sh.getRange(i + 1, nameCol + 1), fx = f[i][nameCol];
    if (fx && /INDEX\('예비회원명단'!\$C\$7:\$C\$36,MATCH\(\$A\d+,'예비회원명단'!\$P\$7:\$P\$36,0\)\)/.test(fx) && fx.indexOf('$B$7') === -1) {
      var m = /MATCH\((\$A\d+),/.exec(fx)[1];
      cell.setFormula("=IFERROR(TRIM(INDEX('예비회원명단'!$B$7:$B$36,MATCH(" + m + ",'예비회원명단'!$P$7:$P$36,0))&\" \"&INDEX('예비회원명단'!$C$7:$C$36,MATCH(" + m + ",'예비회원명단'!$P$7:$P$36,0))),\"\")");
      out.formula++;
    } else if (!fx) {
      var val = String(v[i][nameCol] || '').trim(), nm = val.split(/\s+/).pop();
      if (nm && ahoOf[nm] && val.indexOf(ahoOf[nm] + ' ') !== 0) { cell.setValue(ahoOf[nm] + ' ' + nm); out.value++; }
    }
  }
  SpreadsheetApp.flush();
  return out;
}

/**
 * 임원 탭: 「아호」 열을 성명 앞에 따로 두고, 성명 칸은 성명만 남긴다(합쳐 적지 않음).
 *  - 수식 줄: 아호=명단 B열, 성명=명단 C열(직책으로 MATCH). 값 줄(겸임·동호회): '아호 성명'을 두 칸으로 나눔.
 */
function remoteBoardSplitAho() {
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheets().filter(function (s) { return s.getName().indexOf('임원') !== -1; })[0];
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  var v = sh.getDataRange().getValues(), hr = -1;
  for (var r = 0; r < v.length && hr === -1; r++) if (norm(v[r][0]) === '직책') hr = r;
  var head = v[hr].map(norm), nameCol = head.indexOf('성명') + 1, ahoCol = head.indexOf('아호') + 1;
  if (!ahoCol) { sh.insertColumnBefore(nameCol); ahoCol = nameCol; nameCol++; sh.getRange(hr + 1, ahoCol).setValue('아호'); try { sh.setColumnWidth(ahoCol, 60); } catch (e) {} }
  var rng = sh.getDataRange(), f = rng.getFormulas(), vals = rng.getValues(), out = { formula: 0, value: 0 };
  for (var i = hr + 1; i < vals.length; i++) {
    if (!norm(vals[i][0]) || /^(내정|미정)$/.test(norm(vals[i][0]))) continue;
    var nf = f[i][nameCol - 1], nv = String(vals[i][nameCol - 1] || '').trim();
    if (nf && /MATCH\((\$A\d+),'예비회원명단'!\$P/.test(nf)) {
      var m = /MATCH\((\$A\d+),/.exec(nf)[1];
      sh.getRange(i + 1, ahoCol).setFormula("=IFERROR(INDEX('예비회원명단'!$B$7:$B$36,MATCH(" + m + ",'예비회원명단'!$P$7:$P$36,0)),\"\")");
      sh.getRange(i + 1, nameCol).setFormula("=IFERROR(INDEX('예비회원명단'!$C$7:$C$36,MATCH(" + m + ",'예비회원명단'!$P$7:$P$36,0)),\"\")");
      out.formula++;
    } else if (nv) {
      var parts = nv.split(/\s+/), nm = parts.pop(), aho = parts.join(' ');
      sh.getRange(i + 1, ahoCol).setValue(aho); sh.getRange(i + 1, nameCol).setValue(nm); out.value++;
    }
  }
  SpreadsheetApp.flush();
  return out;
}

/** 임원 탭에서 아호 칸이 빈 줄을 명단의 아호로 채운다(성명 기준) */
function remoteBoardFillAho() {
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheets().filter(function (s) { return s.getName().indexOf('임원') !== -1; })[0];
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  var v = sh.getDataRange().getValues(), hr = -1;
  for (var r = 0; r < v.length && hr === -1; r++) if (norm(v[r][0]) === '직책') hr = r;
  var head = v[hr].map(norm), nameCol = head.indexOf('성명'), ahoCol = head.indexOf('아호'), ahoOf = {}, filled = [];
  recruitParse_((ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0]).getDataRange().getValues()).rows.forEach(function (m) { ahoOf[m.name] = m.aho; });
  for (var i = hr + 1; i < v.length; i++) {
    var nm = norm(v[i][nameCol]);
    if (!norm(v[i][0]) || /^(내정|미정)$/.test(norm(v[i][0])) || !nm || norm(v[i][ahoCol]) || !ahoOf[nm]) continue;
    sh.getRange(i + 1, ahoCol + 1).setValue(ahoOf[nm]); filled.push(String(v[i][0]));
  }
  SpreadsheetApp.flush();
  return { filled: filled };
}

/** 임원 탭의 직업분류가 빈 줄(성명이 '아호 성명'인 값 칸)을 마지막 낱말로 명단에서 찾는 수식으로 채운다 */
function remoteBoardFixJobs() {
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheets().filter(function (s) { return s.getName().indexOf('임원') !== -1; })[0];
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  var v = sh.getDataRange().getValues(), hr = -1;
  for (var r = 0; r < v.length && hr === -1; r++) if (norm(v[r][0]) === '직책') hr = r;
  var head = v[hr].map(norm), nameCol = head.indexOf('성명') + 1, jobCol = head.indexOf('직업분류') + 1, fixed = [];
  for (var i = hr + 1; i < v.length; i++) {
    if (!norm(v[i][0]) || /^(내정|미정)$/.test(norm(v[i][0])) || !norm(v[i][nameCol - 1]) || norm(v[i][jobCol - 1])) continue;
    var a1 = sh.getRange(i + 1, nameCol).getA1Notation();
    sh.getRange(i + 1, jobCol).setFormula("=IFERROR(INDEX('예비회원명단'!$H$7:$H$36,MATCH(" + a1 + ",'예비회원명단'!$C$7:$C$36,0)),\"\")");
    fixed.push(String(v[i][0]));
  }
  SpreadsheetApp.flush();
  return { fixed: fixed };
}

/**
 * 명단 스프레드시트를 엑셀(xlsx)로 내려받아 방에 파일로 전송하고 드라이브 02_회원명부 폴더에도 보관.
 * 개인정보(연락처 등)가 담긴 파일이므로 회장단 방(intake 기능)에만 보낸다.
 */
function remoteSendRosterXlsx(roomType) {
  var rooms = rooms_().filter(function (r) { return r.type === (roomType || '회장단'); });
  if (!rooms.length) return { error: '방 없음' };
  var id = getProp_('RECRUIT_SHEET_ID', true), name = CLUB.short + '_회원명단_' + todayStr_() + '.xlsx';
  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=application%2Fvnd.openxmlformats-officedocument.spreadsheetml.sheet&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { error: 'export ' + res.getResponseCode() };
  var blob = res.getBlob().setName(name), out = {};
  rooms.forEach(function (r) {
    var raw = UrlFetchApp.fetch('https://api.telegram.org/bot' + getToken_() + '/sendDocument', { method: 'post', payload: { chat_id: r.chatId, document: blob, caption: '📋 ' + CLUB.short + ' 회원명단 (예비회원명단·창립회기 임원·관리위원별 현황) — ' + todayStr_() + ' 기준' }, muteHttpExceptions: true });
    var j = JSON.parse(raw.getContentText()); out[r.name] = j.ok ? 'sent' : (j.description || raw.getResponseCode());
  });
  try {
    var sub = function (p, n) { var it = p.getFoldersByName(n); return it.hasNext() ? it.next() : p.createFolder(n); };
    var f = sub(sub(DriveApp.getFolderById(getProp_('DRIVE_FOLDER_ID', true)), '02_회원명부·가입신청서'), '명단 내보내기').createFile(blob);
    out.drive = f.getUrl();
  } catch (e) { out.driveError = String(e); }
  try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '회원명단 엑셀 전송', Object.keys(out).join(','), '', name, 'clasp run'); } catch (e) {}
  return out;
}

/** 「사진」 열 점검: 회원별로 칸에 든 것이 이미지인지(IMAGE) 빈칸인지(EMPTY) 글자인지(TEXT) */
function remoteRosterPhotoCheck() {
  var ss = SpreadsheetApp.openById(getProp_('RECRUIT_SHEET_ID', true)), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0];
  var values = sh.getDataRange().getValues(), lay = recruitAhoLayout_(values);
  var col = values[lay.headerRow - 1].map(function (h) { return String(h).replace(/\s+/g, ''); }).indexOf('사진') + 1;
  if (!col) return { error: '사진 열 없음' };
  var out = {};
  recruitParse_(values).rows.forEach(function (m) {
    var v = sh.getRange(m.row, col).getValue();
    out[m.name] = v === '' ? 'EMPTY' : (v && typeof v === 'object' && v.toString() === 'CellImage' ? 'IMAGE' : 'TEXT');
  });
  return { column: col, cells: out };
}

/**
 * 명단 시트의 한 열을 이름 기준으로 채운다(열이 없으면 afterTitle 열 바로 뒤에 새로 만든다).
 *  - pairs: [[성명, 값], …]. 값은 문자로 저장(회원번호가 12,735,853 처럼 바뀌지 않게).
 *  - 이미 다른 값이 들어 있는 칸은 덮어쓰지 않고 conflict 로 돌려준다(overwrite=true 면 덮어씀). 같은 이름이 여러 명이면 건너뛴다.
 *  - 로그에는 '누구의 어느 열을 기재했다'만 남기고 값은 남기지 않는다.
 */
function remoteRosterFill(colTitle, pairs, afterTitle, overwrite) {
  var id = getProp_('RECRUIT_SHEET_ID', true), ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0];
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
  var lay = recruitAhoLayout_(sh.getDataRange().getValues()), head = sh.getRange(lay.headerRow, 1, 1, sh.getLastColumn()).getValues()[0].map(norm);
  var col = head.indexOf(norm(colTitle)) + 1, created = false;
  if (!col) {
    var after = head.indexOf(norm(afterTitle || '성명')) + 1;
    if (!after) throw new Error('기준 열을 찾지 못했습니다: ' + (afterTitle || '성명'));
    sh.insertColumnAfter(after); col = after + 1; created = true;
    sh.getRange(lay.headerRow, col).setValue(colTitle);
    try { sh.setColumnWidth(col, 90); } catch (e) {}
  }
  var values = sh.getDataRange().getValues(), out = { column: colTitle, created: created, written: [], same: [], conflict: [], notFound: [], ambiguous: [] };
  pairs.forEach(function (pr) {
    var plan = recruitStatusPlan_(values, [pr[0]], '(이름 찾기 전용)');       // 상태 비교는 항상 '다름' → changes 에 행 위치가 담긴다
    if (plan.notFound.length) { out.notFound.push(pr[0]); return; }
    if (plan.ambiguous.length) { out.ambiguous.push(pr[0]); return; }
    var row = plan.changes[0].row, cur = values[row - 1][col - 1], before = String(cur === null || cur === undefined ? '' : cur).trim(), v = String(pr[1]).trim();
    if (before === v) { out.same.push(pr[0]); return; }
    if (before && !overwrite) { out.conflict.push(pr[0]); return; }
    sh.getRange(row, col).setNumberFormat('@').setValue(v);
    try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, colTitle + ' 기재', pr[0] + ' (' + row + '행)', '', '(기재)', 'clasp run'); } catch (e) {}
    out.written.push(pr[0]);
  });
  SpreadsheetApp.flush();
  return out;
}
