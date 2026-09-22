/**
 * Edu.js — 1단계 교육 봇 ('교육과정' · '교육이수' 탭)
 *
 * 흐름
 *  1) 관리자가 「교육과정」 탭을 채운다(초안은 remoteEduImport 로 교육자료 엑셀에서 가져옴).
 *  2) /edu post N (관리자) 또는 게시예정일 도래 → 'edu' 기능이 열린 방에 회차 카드(영상·확인질문·[답하기] 버튼) 게시.
 *  3) 임원이 [답하기] → 봇 개인 대화창으로 질문을 다시 보냄 → 임원이 개인 대화창에서 답을 씀
 *     → 「교육이수」 탭 기록 → 정답기준을 보여 주며 자기 점검(👍 이해했어요 / 🔁 다시 볼게요) → 방에는 "○○ 님 N회차 이수 ✅" 한 줄.
 *  - 답을 AI 로 채점하지 않는다. 정답기준은 답한 뒤에만 보여 주고, 판정은 본인 자기 점검 + (필요하면) 담당자가 시트에서 수정.
 *  - 답을 기다리는 상태는 CacheService(24h)에 둔다. 개인 대화창에서 일반 글을 보내면 그 회차의 답으로 받는다.
 *  - 대상이 직책별 회차면, 그 직책이 아닌 사람에게는 카드에 '해당 직책' 표시만 하고 답하기는 누구나 가능(학습 권장).
 */
var EDU_SHEET = '교육과정', EDU_DONE_SHEET = '교육이수';
var EDU_HEADERS = ['회차', '주제', '영상링크', '확인질문', '정답기준', '게시예정일', '게시시각', '대상', '보조영상'];
var EDU_DONE_HEADERS = ['시각', '회차', 'user_id', '성명', '응답', '판정'];

/** 시트 값 → 회차 목록(순수). 열은 제목 이름으로 찾는다(순서 무관, 없는 열은 빈 값) */
function eduParse_(values) {
  if (!values.length) return [];
  var head = values[0].map(function (h) { return String(h).replace(/\s+/g, ''); });
  var ix = {}; ['회차', '주제', '영상링크', '확인질문', '정답기준', '게시예정일', '게시시각', '대상', '보조영상'].forEach(function (k) { ix[k] = head.indexOf(k); });
  var get = function (r, k) { return ix[k] === -1 || r[ix[k]] === null || r[ix[k]] === undefined ? '' : r[ix[k]]; };
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var no = String(get(values[i], '회차')).replace(/\.0+$/, '').trim(), topic = String(get(values[i], '주제')).trim();
    if (!no || !topic) continue;
    out.push({ row: i + 1, no: no, topic: topic, url: String(get(values[i], '영상링크')).trim(), q: String(get(values[i], '확인질문')).trim(),
      answer: String(get(values[i], '정답기준')).trim(), due: settingDateOf_(get(values[i], '게시예정일')), posted: String(get(values[i], '게시시각')).trim(),
      who: String(get(values[i], '대상')).trim() || '전 임원', extra: String(get(values[i], '보조영상')).split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean) });
  }
  return out;
}

/** 이수 기록 → {회차: {user_id: {name, verdict}}} (순수) */
function eduDoneMap_(values) {
  var m = {};
  for (var i = 1; i < values.length; i++) {
    var no = String(values[i][1]).replace(/\.0+$/, '').trim(), uid = String(values[i][2]).replace(/\.0+$/, '').trim();
    if (!no || !uid) continue;
    (m[no] = m[no] || {})[uid] = { name: String(values[i][3] || ''), verdict: String(values[i][5] || '') };
  }
  return m;
}

function eduCardText_(s) {
  var L = ['📚 <b>' + CLUB.short + ' 임원 교육 · ' + s.no + '회차</b>', UI_LINE, '<b>' + escapeHtml_(s.topic) + '</b>', '대상: ' + escapeHtml_(s.who), ''];
  if (s.url) L.push('▶ 영상: ' + s.url);
  s.extra.forEach(function (u) { L.push('   보조: ' + u); });
  if (s.q) L.push('', '❓ <b>확인질문</b>', escapeHtml_(s.q));
  L.push('', UI_LINE, '영상을 본 뒤 아래 <b>답하기</b>를 누르면 봇과의 개인 대화창에서 답을 받습니다. 답하면 이 방에 이수 표시가 올라갑니다.');
  return L.join('\n');
}
function eduCardKeyboard_(no) { return { inline_keyboard: [[{ text: '✍️ 답하기 (개인 대화창)', callback_data: 'edu|a|' + no }, { text: '📊 이수 현황', callback_data: 'edu|s|' + no }]] }; }

/** 이수 현황 텍스트(순수): 회차별 답한 사람 수 + 이름. users=등록 임원 목록 */
function eduStatusText_(sessions, doneMap, users, onlyNo) {
  var L = ['📊 <b>교육 이수 현황</b>', UI_LINE], total = users.length;
  sessions.filter(function (s) { return s.posted && (!onlyNo || s.no === onlyNo); }).forEach(function (s) {
    var d = doneMap[s.no] || {}, names = Object.keys(d).map(function (u) { return d[u].name; });
    L.push('<b>' + s.no + '회차</b> ' + escapeHtml_(s.topic) + ' — ' + names.length + '/' + total + '명' + (names.length ? '\n   ' + names.map(escapeHtml_).join(', ') : ''));
  });
  if (L.length === 2) L.push('아직 게시된 회차가 없습니다.');
  if (!onlyNo) { L.push('', '▌<b>아직 답하지 않은 임원</b>');
    var posted = sessions.filter(function (s) { return s.posted; });
    users.forEach(function (u) {
      var miss = posted.filter(function (s) { return !((doneMap[s.no] || {})[u.userId]); }).map(function (s) { return s.no; });
      if (miss.length) L.push('• ' + escapeHtml_(u.name) + ': ' + miss.join(', ') + '회차');
    });
  }
  return L.join('\n');
}

// ── 시트 접근 ─────────────────────────────────────────────────
function eduSheet_() { return getOrCreateSheet_(getSS_(), EDU_SHEET, EDU_HEADERS); }
function eduSessions_() { return eduParse_(eduSheet_().getDataRange().getValues()); }
function eduDone_() { return eduDoneMap_(getOrCreateSheet_(getSS_(), EDU_DONE_SHEET, EDU_DONE_HEADERS).getDataRange().getValues()); }
function eduFind_(no) { return eduSessions_().filter(function (s) { return s.no === String(no); })[0] || null; }

/** 회차를 edu 방들에 게시하고 게시시각 기록. 반환: 보낸 방 수 */
function eduPost_(s, user) {
  var rooms = roomsWithFeature_(rooms_(), 'edu'), n = 0;
  rooms.forEach(function (r) { var res = tgSend_(r.chatId, eduCardText_(s), eduCardKeyboard_(s.no)); if (res && res.ok) n++; });
  if (n) {
    var sh = eduSheet_(), col = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).replace(/\s+/g, ''); }).indexOf('게시시각') + 1;
    if (col) sh.getRange(s.row, col).setNumberFormat('@').setValue(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
    try { audit_(user || { userId: '', name: '(봇)', role: '' }, '교육 회차 게시', s.no + '회차 ' + s.topic, '', n + '개 방', ''); } catch (e) {}
  }
  return n;
}

/** dailyCheck: 게시예정일이 오늘 이하이고 아직 안 올린 회차를 하루 1개만 게시(몰아서 올라가지 않게) */
function eduDailyIfDue_() {
  var today = todayStr_(), due = eduSessions_().filter(function (s) { return !s.posted && s.due && s.due <= today; });
  if (due.length) eduPost_(due[0], null);
}

// ── 명령 ─────────────────────────────────────────────────────
function eduReply_(c) {
  var args = c.text.replace(/^\/\S+\s*/, '').trim().split(/\s+/).filter(Boolean), sub = (args[0] || '').toLowerCase();
  var sessions = eduSessions_();
  if (sub === 'post' || sub === '게시') {
    if (!requireCap_(c.chat, c.user, '*')) return;
    var s = eduFind_(args[1]);
    if (!s) { tgSend_(c.chat.id, '사용법: <code>/edu post 회차번호</code>  (목록: /edu list)'); return; }
    var n = eduPost_(s, c.user);
    tgSend_(c.chat.id, n ? '✅ ' + s.no + '회차를 ' + n + '개 방에 게시했습니다.' : '⚠️ 교육(edu) 기능이 열린 방이 없습니다.');
    return;
  }
  if (sub === 'list' || sub === '목록') {
    if (!sessions.length) { tgSend_(c.chat.id, '📚 교육과정이 아직 비어 있습니다. 관리자가 초안을 가져오거나 시트 「교육과정」 탭에 적어 주세요.'); return; }
    tgSend_(c.chat.id, '📚 <b>교육과정</b>\n' + UI_LINE + '\n' + sessions.map(function (s) { return (s.posted ? '✅ ' : '▫️ ') + '<b>' + s.no + '</b> ' + escapeHtml_(s.topic) + ' <i>(' + escapeHtml_(s.who) + ')</i>' + (s.due && !s.posted ? ' · ' + s.due.slice(5) : ''); }).join('\n'));
    return;
  }
  var d = eduDone_(), users = authUsers_().filter(function (u) { return u.active; });
  tgSend_(c.chat.id, eduStatusText_(sessions, d, users, sub && /^\d+$/.test(sub) ? sub : null));
}

/** [답하기] 버튼: 개인 대화창으로 질문을 보내고 답 대기 상태로 */
function eduAskInDm_(cq, user, no) {
  var s = eduFind_(no);
  if (!s) { tgAnswerCallback_(cq.id, '회차를 찾지 못했습니다.', true); return; }
  if ((eduDone_()[s.no] || {})[user.userId]) { tgAnswerCallback_(cq.id, '이미 답하신 회차입니다. 고마워요!', true); return; }
  var res = tgSend_(user.userId, '📚 <b>' + s.no + '회차 · ' + escapeHtml_(s.topic) + '</b>\n' + UI_LINE + '\n❓ ' + escapeHtml_(s.q || '(확인질문 없음 — 소감 한 줄이면 됩니다)') +
    '\n\n이 대화창에 <b>답을 글로 써서 보내 주세요.</b> 길지 않아도 됩니다.');
  if (res && res.ok) {
    CacheService.getScriptCache().put('EDU_WAIT_' + user.userId, s.no, 86400);
    tgAnswerCallback_(cq.id, '개인 대화창으로 질문을 보냈습니다. 그곳에서 답해 주세요.', true);
  } else {
    tgAnswerCallback_(cq.id, '봇과의 개인 대화를 먼저 시작해 주세요: 봇 프로필 → 시작. 그 뒤 다시 눌러 주세요.', true);
  }
}

/** 개인 대화창의 일반 글이 교육 답인지 확인해 처리. 처리했으면 true */
function eduMaybeAnswer_(chat, user, text) {
  if (chat.type !== 'private') return false;
  var cache = CacheService.getScriptCache(), no = cache.get('EDU_WAIT_' + user.userId);
  if (!no) return false;
  var s = eduFind_(no);
  if (!s) { cache.remove('EDU_WAIT_' + user.userId); return false; }
  var sh = getOrCreateSheet_(getSS_(), EDU_DONE_SHEET, EDU_DONE_HEADERS);
  sh.appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), s.no, user.userId, user.name, text.slice(0, 1000), '']);
  cache.remove('EDU_WAIT_' + user.userId);
  cache.put('EDU_ROW_' + user.userId + '_' + s.no, String(sh.getLastRow()), 86400);
  tgSend_(chat.id, '✅ <b>' + s.no + '회차 답변 기록</b>\n' + UI_LINE + (s.answer ? '\n📌 <b>정답기준</b>\n' + escapeHtml_(s.answer) + '\n\n본인 답과 비교해 보세요.' : '\n고맙습니다.'),
    s.answer ? { inline_keyboard: [[{ text: '👍 이해했어요', callback_data: 'edu|v|' + s.no + '|ok' }, { text: '🔁 다시 볼게요', callback_data: 'edu|v|' + s.no + '|again' }]] } : null);
  roomsWithFeature_(rooms_(), 'edu').forEach(function (r) { tgSend_(r.chatId, '📗 ' + escapeHtml_(user.name) + ' 님 <b>' + s.no + '회차 이수</b> ✅'); });
  try { audit_(user, '교육 이수', s.no + '회차', '', '답변 기록', ''); } catch (e) {}
  return true;
}

/** 자기 점검 버튼 → 판정 칸 기록 */
function eduVerdict_(cq, user, no, v) {
  var row = CacheService.getScriptCache().get('EDU_ROW_' + user.userId + '_' + no);
  if (row) getOrCreateSheet_(getSS_(), EDU_DONE_SHEET, EDU_DONE_HEADERS).getRange(parseInt(row, 10), 6).setValue(v === 'ok' ? '이해' : '재학습');
  tgApi_('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
  tgAnswerCallback_(cq.id, v === 'ok' ? '기록했습니다. 수고하셨어요!' : '기록했습니다. 영상을 한 번 더 보시면 좋겠어요.', false);
}

/** 버튼 분기(officeHandleCallback_ 에서 위임) */
function eduHandleCallback_(cq, user, m) {
  if (m[1] === 'a') { eduAskInDm_(cq, user, m[2]); return; }
  if (m[1] === 's') { tgAnswerCallback_(cq.id, ''); var d = eduDone_(); tgSend_(cq.message.chat.id, eduStatusText_(eduSessions_(), d, authUsers_().filter(function (u) { return u.active; }), m[2])); return; }
  if (m[1] === 'v') { eduVerdict_(cq, user, m[2], m[3]); return; }
  tgAnswerCallback_(cq.id, '');
}

// ── 초안 가져오기(원격): 교육자료 엑셀 「교육과정(초안)」 탭 → 「교육과정」 탭 (비어 있을 때만) ──
function remoteEduImport() {
  var sh = eduSheet_();
  if (sh.getLastRow() > 1) return { skipped: '교육과정 탭에 이미 ' + (sh.getLastRow() - 1) + '줄이 있습니다.' };
  var sub = function (p, n) { var it = p.getFoldersByName(n); if (!it.hasNext()) throw new Error('폴더 없음: ' + n); return it.next(); };
  var files = sub(DriveApp.getFolderById(getProp_('DRIVE_FOLDER_ID', true)), '00_교육자료').getFilesByName('대구금향RC_임원교육자료.xlsx');
  if (!files.hasNext()) return { error: '교육자료 엑셀을 찾지 못했습니다.' };
  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + files.next().getId() + '/copy?supportsAllDrives=true', {   // 엑셀 → 임시 구글시트(기존 drive 권한)
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ name: '_tmp_edu_import', mimeType: 'application/vnd.google-apps.spreadsheet' }),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { error: '변환 실패 ' + res.getResponseCode() };
  var tmp = JSON.parse(res.getContentText());
  try {
    var src = SpreadsheetApp.openById(tmp.id).getSheetByName('교육과정(초안)'), v = src.getDataRange().getValues();
    var head = v[1].map(String), ix = function (n) { return head.indexOf(n); }, rows = [];
    for (var i = 2; i < v.length; i++) {
      if (!v[i][ix('회차')]) continue;
      rows.push([v[i][ix('회차')], v[i][ix('주제')], v[i][ix('영상링크')], v[i][ix('확인질문')], v[i][ix('정답기준(초안·검수 필요)')], '', '', v[i][ix('대상')], v[i][ix('보조 영상')]]);
    }
    sh.getRange(1, 1, 1, EDU_HEADERS.length).setValues([EDU_HEADERS]);
    if (rows.length) sh.getRange(2, 1, rows.length, EDU_HEADERS.length).setNumberFormat('@').setValues(rows);
    sh.setFrozenRows(1);
    try { audit_({ userId: '', name: '(원격) 개발자', role: '' }, '교육과정 초안 가져오기', EDU_SHEET, '', rows.length + '회차', 'clasp run'); } catch (e) {}
    return { imported: rows.length };
  } finally { try { DriveApp.getFileById(tmp.id).setTrashed(true); } catch (e) {} }
}
