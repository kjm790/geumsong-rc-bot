/**
 * Intake.js — 그룹방에 올린 '예비회원 추천 양식' 글을 읽어 명단 시트에 자동 기재
 *
 *  - 양식(1. 성명 : … 11. 비고 : …)을 복사해 채워 올리면 봇이 인식한다. 한 메시지에 여러 명도 가능.
 *  - 글자 규칙(정규식)으로만 읽는다 — 연락처·이메일·생년을 AI(LLM)에 보내지 않는다.
 *  - 명단 시트의 번호만 있고 성명이 빈 첫 줄에 기재(수식·드롭다운·요약 줄은 건드리지 않음). 빈 줄이 없으면 마지막 번호 아래에 줄 추가.
 *  - 중복(같은 이름+같은 연락처)은 기재하지 않고 알린다. 이름만 같으면 기재하되 '동명이인 확인' 표시.
 *  - 그룹방 확인 답장에는 연락처를 가려서 표시한다(텔레그램 대화 기록에 개인정보가 남지 않게).
 */
var INTAKE_LABELS = [   // [내부 키, 양식 라벨 첫머리(공백·괄호 제거 후 비교)]
  ['name', ['성명', '이름']], ['gender', ['성별']], ['birth', ['출생년도', '출생연도', '생년', '출생']],
  ['job', ['직업', '업종']], ['company', ['회사명', '회사', '직장']], ['referrer', ['추천인', '추천']],
  ['phone', ['연락처', '전화', '휴대폰', '핸드폰']], ['email', ['이메일', '메일', 'email', 'e-mail']],
  ['eng', ['영문명', '영문', '영어이름']], ['aho', ['아호']], ['note', ['비고', '특이사항', '메모']]
];
var INTAKE_SHEET_COLS = {   // 내부 키 → 명단 시트 열 제목(공백 무시 비교)
  name: '성명', gender: '성별', birth: '출생년도', job: '직업분류', company: '회사/직위', referrer: '추천인',
  phone: '연락처', email: '이메일', eng: '영문명', aho: '아호', note: '비고', joinDate: '가입일', status: '확약여부'
};

function intakeLabelKey_(label) {
  var t = String(label).replace(/\([^)]*\)/g, '').replace(/[\s/·]/g, '').toLowerCase();
  for (var i = 0; i < INTAKE_LABELS.length; i++) {
    var names = INTAKE_LABELS[i][1];
    for (var j = 0; j < names.length; j++) if (t.indexOf(names[j].toLowerCase()) === 0) return INTAKE_LABELS[i][0];
  }
  return null;
}

/** 양식으로 보이는 글인가(성명 + 다른 항목 2개 이상) */
function intakeLooksLikeForm_(text) {
  var keys = {};
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var m = /^\s*(?:\d+\s*[.)]\s*)?([^:：]{1,20}?)\s*[:：]/.exec(line);
    if (m) { var k = intakeLabelKey_(m[1]); if (k) keys[k] = 1; }
  });
  return !!keys.name && Object.keys(keys).length >= 3;
}

/** 글 → [{name, gender, …}] (순수). 성명이 다시 나오면 다음 사람. 성명이 빈 묶음은 버린다. */
function intakeParse_(text) {
  var people = [], cur = null;
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var m = /^\s*(?:\d+\s*[.)]\s*)?([^:：]{1,20}?)\s*[:：]\s*(.*)$/.exec(line);
    if (!m) return;
    var k = intakeLabelKey_(m[1]);
    if (!k) return;
    if (k === 'name') { cur = {}; people.push(cur); }
    if (!cur) return;
    var v = m[2].trim();
    if (/^(없음|없슴|무|x|-|–|—|\.)$/i.test(v)) v = '';
    if (cur[k] === undefined || cur[k] === '') cur[k] = v;
  });
  return people.map(intakeNormalize_).filter(function (p) { return p.name; });
}

function intakeNormalize_(p) {
  var o = {};
  INTAKE_LABELS.forEach(function (l) { o[l[0]] = String(p[l[0]] || '').trim(); });
  o.name = o.name.replace(/\s+/g, '');
  if (/^(여|여성|여자|f|female)$/i.test(o.gender)) o.gender = '여';
  else if (/^(남|남성|남자|m|male)$/i.test(o.gender)) o.gender = '남';
  var b = o.birth.replace(/[^\d]/g, '');
  if (b.length >= 4) o.birth = b.slice(0, 4);
  else if (b.length === 2) o.birth = String((+b > 30 ? 1900 : 2000) + +b);
  var d = o.phone.replace(/[^\d]/g, '');
  if (/^01\d{8,9}$/.test(d)) o.phone = d.slice(0, 3) + '-' + d.slice(3, d.length - 4) + '-' + d.slice(-4);
  o.eng = o.eng.toUpperCase();
  return o;
}

function intakeMaskPhone_(phone) {
  var d = String(phone || '').replace(/[^\d]/g, '');
  return d.length >= 8 ? d.slice(0, 3) + '-****-' + d.slice(-4) : (phone ? '(입력됨)' : '');
}

/**
 * 어디에 무엇을 쓸지 계산(순수). values=명단 탭 전체 값.
 * 반환 { dupRow, homonym, targetRow(1부터, 없으면 null), insertAfterRow, no, writes:[[열(1부터), 값]], needAhoCol:boolean, headerRow, ahoCol }
 */
function intakePlan_(values, person, today) {
  var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, '').trim(); };
  var headerRow = -1;
  for (var r = 0; r < values.length && headerRow === -1; r++) {
    for (var c = 0; c < values[r].length; c++) if (norm(values[r][c]) === '성명') { headerRow = r; break; }
  }
  if (headerRow === -1) throw new Error("명단 시트에서 '성명' 열 제목을 찾지 못했습니다.");
  var head = values[headerRow].map(norm), col = {};
  Object.keys(INTAKE_SHEET_COLS).forEach(function (k) { var i = head.indexOf(INTAKE_SHEET_COLS[k]); if (i !== -1) col[k] = i; });
  var noCol = head.indexOf('번호');
  if (noCol === -1) throw new Error("명단 시트에 '번호' 열이 없습니다.");

  var digits = function (s) { return String(s || '').replace(/[^\d]/g, ''); };
  var dupRow = null, homonym = false, targetRow = null, lastNoRow = headerRow + 1, maxNo = 0;
  for (var i = headerRow + 1; i < values.length; i++) {
    var noStr = norm(values[i][noCol]);
    if (!/^\d+$/.test(noStr)) continue;
    lastNoRow = i + 1; maxNo = Math.max(maxNo, +noStr);
    var nm = norm(values[i][col.name]);
    if (!nm) { if (targetRow === null) targetRow = i + 1; continue; }
    if (nm === person.name) {
      var ph = col.phone === undefined ? '' : digits(values[i][col.phone]);
      if (!ph || !digits(person.phone) || ph === digits(person.phone)) { if (dupRow === null) dupRow = i + 1; }
      else homonym = true;
    }
  }
  var needAhoCol = col.aho === undefined && !!person.aho;
  var ahoCol = col.aho !== undefined ? col.aho : head.length;       // 없으면 맨 오른쪽에 새 열
  var writes = [], put = function (k, v) { if (col[k] !== undefined && v !== '' && v !== undefined) writes.push([col[k] + 1, v]); };
  ['name', 'gender', 'job', 'company', 'referrer', 'phone', 'email', 'eng'].forEach(function (k) { put(k, person[k]); });
  if (person.birth) put('birth', /^\d{4}$/.test(person.birth) ? +person.birth : person.birth);
  put('joinDate', today);                                   // 호출한 쪽이 넘긴 가입일(빈 값이면 기재 안 함)
  put('status', '검토중');
  put('note', [person.note, homonym ? '동명이인 확인' : ''].filter(Boolean).join(' / '));
  if (person.aho) writes.push([ahoCol + 1, person.aho]);
  return { dupRow: dupRow, homonym: homonym, targetRow: targetRow, insertAfterRow: lastNoRow, no: targetRow ? null : maxNo + 1, noCol: noCol + 1,
    writes: writes, needAhoCol: needAhoCol, ahoCol: ahoCol + 1, headerRow: headerRow + 1 };
}

/** 확인 답장 한 사람분(순수) */
function intakeConfirmLine_(no, p, flags) {
  var miss = [];
  if (!p.eng) miss.push('영문명');
  if (!p.phone) miss.push('연락처');
  if (!p.birth) miss.push('출생년도');
  var bits = [p.gender, p.birth, p.job, p.company].filter(Boolean).map(escapeHtml_).join(' · ');
  return '✅ <b>' + no + '번 ' + escapeHtml_((p.aho ? p.aho + ' ' : '') + p.name) + '</b>' + (bits ? '\n   ' + bits : '') +
    '\n   추천인: ' + (p.referrer ? escapeHtml_(p.referrer) : '—') + (p.phone ? ' · 연락처 ' + intakeMaskPhone_(p.phone) : '') + (p.email ? ' · 이메일 ✓' : '') +
    (miss.length ? '\n   ❔ 미입력: ' + miss.join(', ') : '') + (flags && flags.homonym ? '\n   ⚠️ 같은 이름이 이미 있습니다 — 동명이인인지 확인해 주세요' : '');
}

// ── 시트 기록 ────────────────────────────────────────────────
function intakeHandle_(chat, user, text, photo) {
  var people = intakeParse_(text);
  if (!people.length) return;
  var id = getProp_('RECRUIT_SHEET_ID', false);
  if (!id) { tgSend_(chat.id, '⚠️ 명단 시트가 아직 연결되지 않았습니다. 관리자가 /linkroster 로 연결해 주세요.'); return; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) { tgSend_(chat.id, '⚠️ 잠시 후 다시 올려 주세요(다른 기재가 진행 중).'); return; }
  var lines = [];
  try {
    var ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0];
    var today = recruitJoinDateOf_(todayStr_(), recruitCharterDate_());   // 가입일 규칙: 창립행사 전 접수 → 창립행사일
    recruitEnsureAhoBeforeName_(sh);
    people.forEach(function (p) {
      var plan = intakePlan_(sh.getDataRange().getValues(), p, today);
      if (plan.dupRow) { lines.push('↩️ <b>' + escapeHtml_(p.name) + '</b> — 이미 명단에 있습니다(' + plan.dupRow + '행). 기재하지 않았습니다.'); return; }
      if (plan.needAhoCol) sh.getRange(plan.headerRow, plan.ahoCol).setValue('아호');
      var row = plan.targetRow, no;
      if (!row) { sh.insertRowAfter(plan.insertAfterRow); row = plan.insertAfterRow + 1; sh.getRange(row, plan.noCol).setValue(plan.no); }
      no = sh.getRange(row, plan.noCol).getValue();
      plan.writes.forEach(function (w) { sh.getRange(row, w[0]).setValue(w[1]); });
      SpreadsheetApp.flush();
      try { audit_(user, '예비회원 기재', p.name + ' (' + row + '행)', '', '추천인 ' + (p.referrer || '-'), plan.homonym ? '동명이인 확인' : ''); } catch (e) {}
      lines.push(intakeConfirmLine_(no, p, plan));
    });
    var s = recruitSummary_(recruitParse_(sh.getDataRange().getValues()).rows), conf = recruitConf_();
    lines.push(UI_LINE, '📋 명단 ' + s.total + '명 · 확약 <b>' + s.confirmed + '</b> / 목표 ' + conf.target + '명',
      '시트: https://docs.google.com/spreadsheets/d/' + id + '/edit', '<i>틀린 내용은 시트에서 바로 고치시면 됩니다. 확약되면 「확약여부」를 확약으로.</i>');
  } catch (e) {
    lines.push('⚠️ 기재 중 오류: ' + escapeHtml_(e.message));
  } finally { lock.releaseLock(); }
  // 사진: 같이 올린 사진(캡션 양식) 또는 조금 전에 올려 둔 사진을 붙인다. 없으면 '곧 올라올 사진'을 기다린다.
  var cache = CacheService.getScriptCache(), key = intakePhotoKey_(chat, user);
  if (people.length === 1) {
    var ph = photo, pend = photo ? null : cache.get('intk_pend_' + key);
    if (pend) { try { ph = JSON.parse(pend); } catch (e2) {} cache.remove('intk_pend_' + key); }
    if (ph) lines.push(intakePhotoAttach_(people[0].name, ph, user).text);
    else if (chat.type !== 'private') { cache.put('intk_last_' + key, people[0].name, INTAKE_PHOTO_WAIT_SEC); lines.push('📷 사진은 이어서 이 방에 올리시면 명단에 함께 들어갑니다(10분 안).'); }
  } else if (photo) lines.push('📷 여러 명을 한 번에 올리면 사진 주인을 알 수 없습니다 — 사진 설명글에 성명만 적어 한 장씩 올려 주세요.');
  tgSend_(chat.id, '🌱 <b>예비회원 추천 접수</b> (올린 분: ' + escapeHtml_(user.name) + ')\n' + UI_LINE + '\n' + lines.join('\n'));
}

// ── 회원 사진: 회장단 방에 올린 사진 → 회원사진 폴더 저장 + 명단 「사진」 칸 ─────────
var INTAKE_PHOTO_WAIT_SEC = 600;
var INTAKE_WRONG_ROOM = '🔒 예비회원 추천 양식은 개인정보 보호를 위해 <b>회장단 방</b>(또는 봇과의 개인 대화창)에서만 접수합니다.\n회장단 방에 다시 올려 주시고, 이 방에 올린 글은 지워 주세요.';
function intakePhotoKey_(chat, user) { return chat.id + '_' + user.userId; }

/** 메시지의 사진(순수). 반환 {big: 원본 file_id, thumb: 시트용 작은 크기 file_id} 또는 null. 파일로 보낸 그림도 인정 */
function intakePhotoPick_(m) {
  if (!m) return null;
  if (m.photo && m.photo.length) {
    var t = m.photo[m.photo.length - 1];
    for (var i = 0; i < m.photo.length; i++) if ((m.photo[i].width || 0) >= 160) { t = m.photo[i]; break; }
    return { big: m.photo[m.photo.length - 1].file_id, thumb: t.file_id };
  }
  var d = m.document;
  if (d && /^image\//.test(d.mime_type || '')) { var th = d.thumbnail || d.thumb; return { big: d.file_id, thumb: th ? th.file_id : d.file_id }; }
  return null;
}

/**
 * 그룹방에 올라온 사진 처리. 누구 사진인지 정하는 순서:
 *  ① 설명글이 추천 양식 → 기재 + 그 사람 사진  ② 양식 글에 답장으로 올린 사진  ③ 설명글이 성명('홍길순' · '아호 홍길순' · '홍길순 사진')
 *  ④ 설명글 없음 → 방금(10분 안) 같은 사람이 올린 양식의 주인. 그런 양식이 없으면 잠시 보관했다가 뒤따라 오는 양식에 붙인다.
 */
function intakePhotoMessage_(msg) {
  var chat = msg.chat, ph = intakePhotoPick_(msg), cap = String(msg.caption || '').trim(), re = msg.reply_to_message || {};
  var user = authUser_(msg.from.id);
  if (!user || !can_(user, 'roster.add')) return;
  var rooms = []; try { rooms = rooms_(); } catch (e) {}
  if (!roomAllows_(rooms, chat, 'intake')) { if (intakeLooksLikeForm_(cap) && roomFind_(rooms, chat.id)) tgSend_(chat.id, INTAKE_WRONG_ROOM); return; }
  if (intakeLooksLikeForm_(cap)) { intakeHandle_(chat, user, cap, ph); return; }

  var cache = CacheService.getScriptCache(), key = intakePhotoKey_(chat, user), name = '', quiet = false;
  if (intakeLooksLikeForm_(re.text || re.caption)) {
    var ps = intakeParse_(re.text || re.caption);
    if (ps.length !== 1) return;
    name = ps[0].name;
  } else if (cap) {
    var t = cap.replace(/사진|님/g, ' ').trim();
    if (!t || t.length > 12 || t.split(/\s+/).length > 2) return;   // 이름으로 보이지 않는 설명글 — 일반 사진
    name = recruitNameOf_(t); quiet = true;
  } else {
    name = cache.get('intk_last_' + key) || '';
    if (!name) { cache.put('intk_pend_' + key, JSON.stringify(ph), INTAKE_PHOTO_WAIT_SEC); return; }
    cache.remove('intk_last_' + key);
  }
  var res = intakePhotoAttach_(name, ph, user);
  if (res.ok || !quiet) tgSend_(chat.id, res.text);
}

/** 사진을 회원사진 폴더(원본 성명.jpg · 시트용 썸네일)에 저장하고 명단 「사진」 칸에 넣는다. 반환 {ok, text} */
function intakePhotoAttach_(name, ph, user) {
  try {
    var id = getProp_('RECRUIT_SHEET_ID', false);
    if (!id) return { ok: false, text: '⚠️ 명단 시트가 아직 연결되지 않았습니다.' };
    var ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName(recruitConf_().tab) || ss.getSheets()[0], values = sh.getDataRange().getValues();
    var plan = recruitStatusPlan_(values, [name], '(이름 찾기 전용)');
    if (plan.ambiguous.length) return { ok: false, text: '📷 <b>' + escapeHtml_(name) + '</b> — 같은 이름이 둘 이상이라 사진을 넣지 않았습니다. 시트에서 직접 넣어 주세요.' };
    if (plan.notFound.length) return { ok: false, text: '📷 <b>' + escapeHtml_(name) + '</b> — 명단에 없는 이름이라 사진을 넣지 않았습니다.' };
    var row = (plan.changes[0] || {}).row;
    if (!row) return { ok: false, text: '📷 <b>' + escapeHtml_(name) + '</b> — 명단에서 줄을 찾지 못했습니다.' };

    var sub = function (parent, n) { var it = parent.getFoldersByName(n); return it.hasNext() ? it.next() : parent.createFolder(n); };
    var photos = sub(sub(DriveApp.getFolderById(getProp_('DRIVE_FOLDER_ID', true)), '02_회원명부·가입신청서'), '회원사진'), thumbs = sub(photos, '_썸네일(시트용)');
    var stem = function (n) { return String(n).replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/\s+/g, ''); };
    var olds = photos.getFiles(), replaced = false;
    while (olds.hasNext()) { var o = olds.next(); if (stem(o.getName()) === name) { o.setName('(이전 ' + todayStr_() + ') ' + o.getName()); replaced = true; } }   // 원본은 지우지 않고 이름만 바꿔 둔다
    var oldT = thumbs.getFiles();
    while (oldT.hasNext()) { var ot = oldT.next(); if (stem(ot.getName()) === name) ot.setTrashed(true); }

    var big = docsDownload_(ph.big), ext = /png/i.test(big.getContentType() || '') ? '.png' : '.jpg';
    var url = photos.createFile(big.setName(name + ext)).getUrl();
    var tb = ph.thumb && ph.thumb !== ph.big ? docsDownload_(ph.thumb) : big;
    thumbs.createFile(tb.copyBlob().setName(name + '.jpg'));

    var norm = function (s) { return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ''); };
    var lay = recruitAhoLayout_(values), col = sh.getRange(lay.headerRow, 1, 1, sh.getLastColumn()).getValues()[0].map(norm).indexOf('사진') + 1, how = '폴더에 저장';
    if (col) {
      var cell = sh.getRange(row, col), ctype = /png/i.test(tb.getContentType() || '') ? 'image/png' : 'image/jpeg';
      try {
        cell.setValue(SpreadsheetApp.newCellImage().setSourceUrl('data:' + ctype + ';base64,' + Utilities.base64Encode(tb.getBytes())).setAltTextTitle(name).setAltTextDescription(url).build());
        how = '명단에 넣음';
      } catch (e) {
        cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText('사진 보기').setLinkUrl(url).build()); how = '명단에 링크로 넣음';
      }
      cell.setNote('원본 사진: ' + url).setHorizontalAlignment('center').setVerticalAlignment('middle');
      try { sh.setRowHeight(row, 72); } catch (e2) {}
      SpreadsheetApp.flush();
    }
    try { audit_(user, '회원 사진', name + ' (' + row + '행)', replaced ? '이전 사진 있음' : '', how, ''); } catch (e3) {}
    return { ok: true, text: '📷 <b>' + escapeHtml_(name) + '</b> 님 사진 — ' + how + (replaced ? ' (이전 사진은 폴더에 보관)' : '') };
  } catch (err) {
    return { ok: false, text: '⚠️ 사진 넣기 오류: ' + escapeHtml_(err.message) };
  }
}

function intakeFormText_() {
  return '■ 금향 예비회원 추천 양식\n(1명당 아래 내용을 복사해서 옆에 적어 주세요)\n\n1. 성명 :\n2. 성별 :\n3. 출생년도 :\n4. 직업(업종) :\n5. 회사명 / 직위 :\n6. 추천인 :\n' +
    '7. 연락처 :\n8. 이메일 :\n9. 영문명(여권 표기) :\n10. 아호(있으면) :\n11. 비고(특이사항) :';
}

// ── 사용자 등록: 상대 메시지에 '답장'으로 /adduser 권한 [성명] ─────────
function officeCmdAddUser_(msg, chat, user, text) {
  var args = text.split(/\s+/).slice(1), role = args[0] || '', target = msg.reply_to_message && msg.reply_to_message.from;
  var roles = Object.keys(ROLE_CAPS).filter(function (r) { return r !== '관리자'; });
  if (!target || target.is_bot) {
    tgSend_(chat.id, '등록할 분이 쓴 메시지를 길게 눌러 <b>답장</b>으로 <code>/adduser</code> 를 보내 주세요. (권한은 버튼으로 고릅니다)');
    return;
  }
  var tgName = ((target.first_name || '') + ' ' + (target.last_name || '')).trim();
  if (roles.indexOf(role) === -1) {                          // 권한을 안 적었으면 버튼으로 고르게 한다
    try { CacheService.getScriptCache().put('AU_NAME_' + target.id, tgName, 3600); } catch (e) {}
    var rowsKb = [];
    roles.forEach(function (r, i) { if (i % 3 === 0) rowsKb.push([]); rowsKb[rowsKb.length - 1].push({ text: r, callback_data: 'au:' + target.id + ':' + r }); });
    tgSend_(chat.id, '👤 <b>' + escapeHtml_(tgName) + '</b> 님을 어떤 권한으로 등록할까요?', { inline_keyboard: rowsKb });
    return;
  }
  var given = args.slice(1).join(' ');
  officeAddUserApply_(chat, user, String(target.id), given || tgName, role, !!given);
}

/** 회원 탭에 등록/권한 변경(명령·버튼 공용). 권한 확인은 호출한 쪽 책임. nameGiven=성명을 직접 적었으면 기존 행의 성명도 고친다 */
function officeAddUserApply_(chat, user, uid, name, role, nameGiven) {
  var sh = getOrCreateSheet_(getSS_(), AUTH_SHEET, AUTH_HEADERS), data = sh.getDataRange().getValues();
  var head = data[0].map(function (h) { return String(h).trim(); }), ci = function (h) { return head.indexOf(h) + 1; };
  var found = 0;
  for (var i = 1; i < data.length; i++) if (String(data[i][ci('user_id') - 1]).replace(/\.0+$/, '') === uid) { found = i + 1; break; }
  if (found) {
    var before = data[found - 1][ci('권한') - 1], oldName = String(data[found - 1][ci('성명') - 1] || '');
    sh.getRange(found, ci('권한')).setValue(role); sh.getRange(found, ci('직책')).setValue(role); sh.getRange(found, ci('상태')).setValue('');
    if (nameGiven && name !== oldName) { sh.getRange(found, ci('성명')).setValue(name); audit_(user, '성명 수정', 'user ' + uid, oldName, name, ''); }
    else name = oldName || name;                              // 버튼으로 권한만 바꿀 땐 이미 등록된 성명을 유지
    if (before !== role) audit_(user, '권한 변경', name, before, role, '');
  } else {
    var row = head.map(function () { return ''; });
    row[ci('번호') - 1] = sh.getLastRow(); row[ci('성명') - 1] = name; row[ci('직책') - 1] = role; row[ci('user_id') - 1] = uid;
    row[ci('권한') - 1] = role; row[ci('입회일') - 1] = todayStr_();
    sh.appendRow(row);
    audit_(user, '사용자 등록', name, '', role, '');
  }
  invalidateAuth_();
  tgSend_(chat.id, '✅ <b>' + escapeHtml_(name) + '</b> 님을 <b>' + escapeHtml_(role) + '</b> 권한으로 등록했습니다. /help 로 쓸 수 있는 명령을 확인하세요.');
}
