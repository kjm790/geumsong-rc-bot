/**
 * Code.js — 대구금송로타리클럽 'AI사무장봇' 메인 (GAS / 웹훅)
 *
 * 동작
 *  - 웹훅(doPost): 회원 버튼 응답·명령을 즉시 처리
 *  - 시간 트리거(dailyCheck): 매일 1회 → 월말이면 출석조사, 행사 D-N이면 리마인더
 *
 * 핵심 정기 행사 2종(EVENTS, Config.js):
 *  - 정기모임          : 첫째 화요일 19:30
 *  - 자유재활원 정기봉사 : 셋째 토요일 10:00
 *
 * 설치 순서는 README.md 참고.
 */

// ───────────────────────────────────── 웹앱 엔드포인트
function doPost(e) {
  try {
    var update = JSON.parse(e.postData.contents);
    handleUpdate_(update);
  } catch (err) {
    Logger.log('doPost 오류: ' + err + '\n' + (e && e.postData ? e.postData.contents : ''));
  }
  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('AI사무장봇 작동 중');
}

function handleUpdate_(update) {
  // 텔레그램이 같은 업데이트를 재시도(웹훅 302 등)해도 한 번만 처리 — 중복 발송 방지
  if (!dedupeUpdate_(update.update_id)) return;
  if (update.callback_query) { handleCallback_(update.callback_query); return; }
  if (update.message)        { handleMessage_(update.message); return; }
}

/**
 * update_id 중복 차단(영구).
 * GAS 웹앱은 POST에 302를 반환하고, 텔레그램은 이를 실패로 보고 같은 업데이트를
 * 장시간(수십 분~) 재시도한다. 따라서 시간 만료 캐시가 아니라 Script Property 에
 * 최근 처리한 update_id 목록을 영구 보관하여, 재시도가 언제 오든 한 번만 처리한다.
 * 잠금으로 직렬화하여 동시 재시도의 경쟁도 차단.
 */
function dedupeUpdate_(updateId) {
  if (updateId == null) return true;
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { return true; }  // 잠금 실패 시 일단 처리
  try {
    var p = props_();
    var arr;
    try { arr = JSON.parse(p.getProperty('PROCESSED_UPDATES') || '[]'); } catch (e) { arr = []; }
    if (arr.indexOf(updateId) !== -1) return false;          // 이미 처리됨
    arr.push(updateId);
    if (arr.length > 300) arr = arr.slice(arr.length - 300); // 최근 300개만 보관(증가형 ID라 재시도 전부 커버)
    p.setProperty('PROCESSED_UPDATES', JSON.stringify(arr));
    return true;
  } finally {
    lock.releaseLock();
  }
}

// 표시 라벨: 매칭되면 '아호 성명'(예: 동우 김종만), 아니면 텔레그램명 + (미매칭)
function memberLabel_(m) {
  if (m.name) return (m.aho ? m.aho + ' ' : '') + m.name;
  return displayName_(m.full_name, m.username) + ' (미매칭)';
}

// ───────────────────────────────────── 메시지(명령) 처리
function handleMessage_(msg) {
  var chat = msg.chat;
  var from = msg.from;
  var fullName = ((from.first_name || '') + ' ' + (from.last_name || '')).trim();

  // 사진 메시지(밴드 소식용) — 단일/앨범 모두 cmdBandPhoto_ 에서 처리
  if (msg.photo && msg.photo.length) { handleBandPhoto_(msg, chat, from); return; }

  var text = (msg.text || '').trim();
  if (text.charAt(0) === '/') {
    var cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();
    switch (cmd) {
      case '/start':     cmdStart_(chat, from, fullName); break;
      case '/help':      cmdHelp_(chat, from); break;
      case '/id':        cmdId_(chat, from); break;
      case '/check': case '/체크': case '/채크': case '/출석': case '/참석': cmdShowBoard_(chat, from); break;
      case '/status':    cmdStatus_(chat, from); break;
      case '/announce':  cmdAnnounce_(chat, from); break;
      case '/remind':    cmdRemind_(chat, from); break;
      case '/members':   cmdMembers_(chat, from); break;
      case '/board':     cmdBoard_(chat, from); break;
      case '/밴드': case '/band': case '/밴드소식': cmdBandPost_(chat, from, text); break;
      case '/unmatched': cmdUnmatched_(chat, from); break;
      default: break;
    }
    return;
  }
  // 명령이 아닌 일반 텍스트는 처리하지 않음(자동 매칭은 버튼/‧start 시 조용히 수행)
}

function requireAdmin_(chat, from) {
  if (!isAdmin_(from.id)) {
    tgSend_(chat.id, '관리자만 사용할 수 있는 명령입니다.');
    return false;
  }
  return true;
}

/** 누구나 단톡에서 출석 버튼(실시간 보드)을 최하단에 다시 띄움 — 새로 들어온 회원용 */
function cmdShowBoard_(chat, from) {
  floatBoard_();
  if (String(chat.id) !== String(getGroupChatId_())) tgSend_(chat.id, '단톡에 출석 버튼을 띄웠습니다.');
}

/** 텔레그램 / 명령 메뉴 등록(에디터에서 1회 실행) */
function setCommands() {
  return tgApi_('setMyCommands', {
    commands: [
      { command: 'check', description: '출석 버튼 다시 띄우기' },
      { command: 'start', description: '회원 등록' },
      { command: 'id', description: '이 방의 chat ID 확인' },
      { command: 'help', description: '도움말' }
    ]
  });
}

function cmdStart_(chat, from, fullName) {
  var isNew = upsertMember_(from.id, from.username || '', fullName);  // 자동 등록 + 조용한 자동매칭
  var member = getMemberById_(from.id);
  var addr = (member && member.name) ? (member.aho || member.name) : displayName_(fullName, from.username);
  var msg = isNew
    ? '환영합니다, ' + addr + ' 님! 🎉\n대구금송로타리클럽 <b>AI사무장봇</b>에 등록되었습니다.\n앞으로 정기모임·봉사활동 출석 안내를 보내드리겠습니다.'
    : addr + ' 님, 이미 등록되어 있습니다. 반갑습니다! 🙌';
  tgSend_(chat.id, msg);
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── 밴드 소식 게시 공통 헬퍼 ────────────────────────────────
var BAND_CMDS_ = { '/밴드': 1, '/band': 1, '/밴드소식': 1 };
/** 캡션/텍스트 첫 토큰이 밴드 명령인지 */
function isBandCmd_(token) {
  return !!BAND_CMDS_[String(token || '').split('@')[0].toLowerCase()];
}
/** 첫 토큰(명령어) 제거 후 본문만 */
function stripBandCmd_(s) { return String(s || '').replace(/^\/\S+\s*/, '').trim(); }
/** 밴드 소식 헤더(구분선까지) */
function bandHeader_() { return '⚙️ <b>국제로타리 3700지구 · 밴드 소식</b>\n' + UI_LINE; }
/** 헤더 + 본문(HTML 이스케이프) */
function bandBody_(content) { return bandHeader_() + '\n' + escapeHtml_(content); }

/** (반자동) 관리자가 보낸 밴드 글을 단톡에 '3700지구 밴드 소식'으로 게시 */
function cmdBandPost_(chat, from, text) {
  if (!requireAdmin_(chat, from)) return;
  var content = stripBandCmd_(text);   // 명령어 토큰 제거
  if (!content) {
    tgSend_(chat.id, '사용법: <b>/밴드</b> 다음 줄에 밴드 글 내용·링크를 붙여넣어 보내주세요.\n예)\n/밴드\n[공지] 7월 지구 행사 안내\n…내용…\nhttps://band.us/...\n\n사진은 사진 <b>캡션</b> 칸에 /밴드 와 내용을 적어 보내면 됩니다(여러 장 앨범도 가능).');
    return;
  }
  tgSend_(getGroupChatId_(), bandBody_(content));
  if (String(chat.id) !== String(getGroupChatId_())) tgSend_(chat.id, '✅ 단톡에 밴드 소식을 게시했습니다.');
}

/** 관리자가 보낸 사진(단일/앨범)을 밴드 소식으로 단톡 게시 */
function handleBandPhoto_(msg, chat, from) {
  if (!isAdmin_(from.id)) return;                 // 관리자 외 사진은 조용히 무시
  var photo = msg.photo;
  var fileId = photo[photo.length - 1].file_id;   // 가장 큰 해상도
  var caption = (msg.caption || '').trim();

  if (msg.media_group_id) {                        // 앨범(여러 장) — 모았다가 한꺼번에 게시
    bufferBandAlbum_(String(msg.media_group_id), fileId, caption, chat.id);
    return;
  }
  // 단일 사진
  if (!isBandCmd_(caption.split(/\s+/)[0])) {
    tgSend_(chat.id, '사진을 단톡 밴드 소식으로 올리려면 사진 <b>캡션</b> 칸에 <b>/밴드</b> 와 내용을 함께 적어 보내주세요.');
    return;
  }
  postBandPhotos_([fileId], stripBandCmd_(caption), chat.id);
}

/** 사진 1장 이상 + 본문을 단톡에 게시(앨범은 sendMediaGroup) */
function postBandPhotos_(fileIds, content, srcChatId) {
  var groupId = getGroupChatId_();
  var caption = bandBody_(content);
  var overflow = caption.length > 1024;            // 사진 캡션 한도 초과 → 헤더만 달고 본문은 따로
  var capUse = overflow ? bandHeader_() : caption;
  if (fileIds.length === 1) {
    tgApi_('sendPhoto', { chat_id: groupId, photo: fileIds[0], caption: capUse, parse_mode: 'HTML' });
  } else {
    var media = fileIds.map(function (fid, i) {
      var m = { type: 'photo', media: fid };
      if (i === 0) { m.caption = capUse; m.parse_mode = 'HTML'; }
      return m;
    });
    tgApi_('sendMediaGroup', { chat_id: groupId, media: media });
  }
  if (overflow) tgSend_(groupId, escapeHtml_(content));   // 캡션 1024자 초과분은 본문 메시지로
  if (String(srcChatId) !== String(groupId)) {
    tgSend_(srcChatId, '✅ 단톡에 밴드 소식(사진 ' + fileIds.length + '장)을 게시했습니다.');
  }
}

/**
 * 앨범 버퍼링: 텔레그램은 앨범의 각 사진을 별도 업데이트로 보내고, 캡션은 보통
 * 첫 사진에만 붙는다. 그룹키(media_group_id)별로 file_id 를 모았다가, 잠시 후
 * 1회 트리거(flushBandAlbums)로 한꺼번에 게시한다.
 */
function bufferBandAlbum_(groupKey, fileId, caption, srcChatId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var p = PropertiesService.getScriptProperties();
    var key = 'BANDALBUM_' + groupKey;
    var data;
    try { data = JSON.parse(p.getProperty(key) || 'null'); } catch (e) { data = null; }
    if (!data) data = { fileIds: [], caption: '', srcChatId: srcChatId };
    data.fileIds.push(fileId);
    if (caption && !data.caption) data.caption = caption;
    p.setProperty(key, JSON.stringify(data));
    // 같은 앨범 사진들이 다 도착하도록 잠깐 기다렸다 게시 — 지연 트리거 1개만 유지
    if (!p.getProperty('BANDALBUM_PENDING')) {
      ScriptApp.newTrigger('flushBandAlbums').timeBased().after(10000).create();
      p.setProperty('BANDALBUM_PENDING', '1');
    }
  } finally {
    lock.releaseLock();
  }
}

/** 버퍼된 앨범들을 게시(지연 트리거에서 호출). 잔여 트리거도 정리 */
function flushBandAlbums() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'flushBandAlbums') ScriptApp.deleteTrigger(t);
  });
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty('BANDALBUM_PENDING');
  var props = p.getProperties();
  Object.keys(props).forEach(function (key) {
    if (key.indexOf('BANDALBUM_') !== 0 || key === 'BANDALBUM_PENDING') return;
    var data;
    try { data = JSON.parse(props[key]); } catch (e) { p.deleteProperty(key); return; }
    p.deleteProperty(key);
    if (!data || !data.fileIds || !data.fileIds.length) return;
    if (!isBandCmd_((data.caption || '').split(/\s+/)[0])) {   // /밴드 캡션 없는 앨범은 게시 안 함
      if (data.srcChatId) tgSend_(data.srcChatId, '사진 앨범을 밴드 소식으로 올리려면 <b>첫 사진 캡션</b>에 <b>/밴드</b> 와 내용을 적어 보내주세요.');
      return;
    }
    postBandPhotos_(data.fileIds.slice(0, 10), stripBandCmd_(data.caption), data.srcChatId);  // 앨범 최대 10장
  });
}

/** 임원방에 불참·미응답 실시간 보드를 띄움 */
function cmdBoard_(chat, from) {
  if (!getOfficerChatId_()) { tgSend_(chat.id, '임원 보고방(OFFICER_CHAT_ID)이 설정되지 않았습니다.'); return; }
  floatOfficerBoard_();
  if (String(chat.id) !== String(getOfficerChatId_())) tgSend_(chat.id, '임원방에 현황 보드를 띄웠습니다.');
}

/** 관리자: 명부 미매칭 회원 목록 */
function cmdUnmatched_(chat, from) {
  if (!requireAdmin_(chat, from)) return;
  var u = getUnmatchedMembers_();
  if (!u.length) { tgSend_(chat.id, '명부 미매칭 회원이 없습니다. 👍'); return; }
  var lines = u.map(function (m, i) {
    return (i + 1) + '. ' + displayName_(m.full_name, m.username) + (m.username ? ' (@' + m.username + ')' : '');
  });
  tgSend_(chat.id, '⚠️ <b>명부 미매칭 회원 ' + u.length + '명</b>\n' + lines.join('\n') +
    '\n\n→ 데이터시트 <b>members</b> 탭의 matched_aho/matched_name 열을 직접 채우거나, 본인이 /start 로 다시 확인하면 됩니다.');
}

function cmdHelp_(chat, from) {
  var common =
    '🤖 <b>AI사무장봇 도움말</b>\n대구금송로타리클럽 정기모임·봉사 출석을 도와드립니다.\n\n' +
    '• /start — 회원 등록\n• /check — 출석 버튼 다시 띄우기\n• /id — 이 대화방의 chat ID 확인\n• /help — 도움말\n';
  var admin =
    '\n<b>관리자 전용</b>\n' +
    '• /status — 다가오는 행사별 출석 현황\n' +
    '• /announce — 지금 즉시 출석조사 발송(전체 행사)\n' +
    '• /remind — 지금 즉시 미응답자 리마인더(전체 행사)\n' +
    '• /members — 등록 회원 목록(아호·성명순)\n' +
    '• /board — 임원방에 불참·미응답 실시간 현황 띄우기\n' +
    '• /밴드 — (다음 줄에 글·링크 붙여넣어) 3700지구 밴드 소식을 단톡에 게시\n' +
    '       └ 사진: 사진 캡션 칸에 /밴드+내용 (여러 장 앨범도 가능)\n' +
    '• /unmatched — 명부 미매칭 회원 확인\n';
  var recurring = recurringEvents_().map(function (e) { return '• ' + e.name + ': <b>' + eventDescribe_(e) + '</b>'; }).join('\n');
  var notices = noticeEvents_().map(function (e) { return '• ' + e.name + ': ' + eventDescribe_(e); }).join('\n');
  var schedule = '\n📅 정기 일정(출석 집계)\n' + recurring +
    (notices ? '\n\n🎟 동호회 행사(정기모임에서 익월 안내)\n' + notices : '');
  tgSend_(chat.id, common + (isAdmin_(from.id) ? admin : '') + schedule);
}

function cmdId_(chat, from) {
  var kind = ({ 'private': '개인 대화', 'group': '그룹', 'supergroup': '슈퍼그룹', 'channel': '채널' })[chat.type] || chat.type;
  tgSend_(chat.id,
    '🆔 <b>ID 정보</b>\n' +
    '• 이 대화방(chat) ID: <code>' + chat.id + '</code>  (' + kind + ')\n' +
    '• 당신의 user ID: <code>' + from.id + '</code>\n\n' +
    '※ 단톡 → GROUP_CHAT_ID, 임원방 → OFFICER_CHAT_ID,\n   본인 user ID → ADMIN_IDS (Script Properties)에 넣으세요.');
}

function cmdStatus_(chat, from) {
  if (!requireAdmin_(chat, from)) return;
  var blocks = recurringEvents_().map(function (ev) {
    var meeting = nextMeetingDate_(todayStr_(), ev.weekday, ev.nth);
    return summaryText_(ev, meeting, getAttendanceSummary_(ev.key, meeting));
  });
  tgSend_(chat.id, blocks.join('\n\n──────────\n\n'));
}

function cmdAnnounce_(chat, from) {
  if (!requireAdmin_(chat, from)) return;
  var sent = recurringEvents_().map(function (ev) {
    var meeting = sendAnnouncement_(ev);
    return ev.name + ' (' + formatMeetingDate_(meeting, ev.hour, ev.minute) + ')';
  });
  // 단톡에서 실행하면 공지가 이미 보이므로 확인 메시지 생략(군더더기 방지)
  if (String(chat.id) !== String(getGroupChatId_())) {
    tgSend_(chat.id, '✅ 출석조사를 단톡에 발송했습니다.\n• ' + sent.join('\n• '));
  }
}

function cmdRemind_(chat, from) {
  if (!requireAdmin_(chat, from)) return;
  var results = recurringEvents_().map(function (ev) {
    var n = sendReminder_(ev);
    return ev.name + ': ' + (n === 0 ? '미응답 없음' : n + '명에게 발송');
  });
  tgSend_(chat.id, '✅ 리마인더 처리 결과\n• ' + results.join('\n• '));
}

function cmdMembers_(chat, from) {
  if (!requireAdmin_(chat, from)) return;
  var members = getActiveMembers_().sort(memberSort_);     // 아호·성명순
  if (!members.length) { tgSend_(chat.id, '아직 등록된 회원이 없습니다.'); return; }
  var lines = members.map(function (m, i) {
    var tg = displayName_(m.full_name, m.username);
    return (i + 1) + '. ' + memberLabel_(m) + (m.name ? ' <i>(텔레그램: ' + tg + ')</i>' : '');
  });
  tgSend_(chat.id, '👥 <b>등록 회원 ' + members.length + '명</b>\n' + lines.join('\n'));
}

// ───────────────────────────────────── 버튼(콜백) 처리
function handleCallback_(cq) {
  var data = cq.data || '';
  if (data === 'refresh') { tgAnswerCallback_(cq.id, '현황을 새로 띄웠습니다.'); floatOfficerBoard_(); return; }
  if (data === 'view:attend') { handleView_(cq, 'attend'); return; }
  if (data === 'view:absent') { handleView_(cq, 'absent'); return; }
  if (data === 'view:noresp') { handleView_(cq, 'no_response'); return; }
  if (data.indexOf('att:') === 0) { handleAttendance_(cq); return; }
  tgAnswerCallback_(cq.id, '');
}

/** 보기 버튼: 누른 임원의 1:1(개인) 대화로 전체 명단 전송. 1:1 미개설이면 팝업(요약)+안내. */
function handleView_(cq, kind) {
  var from = cq.from;
  var res = tgApi_('sendMessage', {
    chat_id: from.id, text: buildViewFull_(kind), parse_mode: 'HTML', disable_web_page_preview: true
  });
  if (res && res.ok) {
    tgAnswerCallback_(cq.id, '📩 전체 명단을 1:1(개인) 대화로 보냈습니다. 확인해 주세요.');
  } else {
    // 1:1 미개설(봇 /start 안 함) → 팝업 요약 + 안내
    tgAnswerCallback_(cq.id, buildViewText_(kind) + '\n\n전체를 받으려면 @geumsong_secretary_bot 과 1:1에서 /start 후 다시 눌러주세요.', true);
  }
}

/** 전체 명단(개인 메시지용, 길이 제한 없음). kind: attend/absent/no_response */
function buildViewFull_(kind) {
  var today = todayStr_();
  var head = kind === 'attend' ? '✅ <b>참석 명단</b>' : (kind === 'absent' ? '❌ <b>불참 명단</b>' : '❔ <b>미응답 명단</b>');
  var lines = recurringEvents_().map(function (ev) {
    var meeting = nextMeetingDate_(today, ev.weekday, ev.nth);
    var s = getAttendanceSummary_(ev.key, meeting);
    var arr = kind === 'attend' ? s.attend : (kind === 'absent' ? s.absent : s.no_response);
    var names;
    if (kind === 'attend') {     // 참석은 누른 순서로 번호 표기
      var ordered = getAttendInPressOrder_(ev.key, meeting);
      names = ordered.length ? ordered.map(function (n, i) { return '  ' + (i + 1) + '. ' + n; }).join('\n') : '  (없음)';
    } else {
      names = arr.length ? arr.map(function (m) { return '  • ' + memberLabel_(m); }).join('\n') : '  (없음)';
    }
    return '📅 <b>' + ev.name + '</b>  <i>' + formatMeetingDate_(meeting, ev.hour, ev.minute) + '</i>  · ' + arr.length + '명\n' + names;
  });
  return '⚙️ <b>대구금송RC</b> · ' + head + '\n' + UI_LINE + '\n' + lines.join('\n\n');
}

/** 1:1 미개설 시 팝업 요약(200자 제한) */
function buildViewText_(kind) {
  var today = todayStr_();
  var lines = recurringEvents_().map(function (ev) {
    var meeting = nextMeetingDate_(today, ev.weekday, ev.nth);
    var s = getAttendanceSummary_(ev.key, meeting);
    var arr = kind === 'attend' ? s.attend : (kind === 'absent' ? s.absent : s.no_response);
    var names = arr.map(function (m) { return memberLabel_(m); });
    return ev.name + ' (' + names.length + '): ' + (names.length ? names.join(', ') : '없음');
  });
  var head = kind === 'attend' ? '✅ 참석\n' : (kind === 'absent' ? '❌ 불참\n' : '❔ 미응답\n');
  var text = head + lines.join('\n');
  if (text.length > 150) text = text.slice(0, 147) + '…';
  return text;
}

/** 출석 버튼 처리 (att:<eventKey>:<meetingDate>:<status>) */
function handleAttendance_(cq) {
  var from = cq.from;
  var parts = cq.data.split(':');        // att : eventKey : meetingDate : status
  if (parts.length !== 4) { tgAnswerCallback_(cq.id, '잘못된 요청입니다.'); return; }

  var eventKey = parts[1], meetingDate = parts[2], status = parts[3];
  var ev = getEventByKey_(eventKey);
  if (!ev) { tgAnswerCallback_(cq.id, '알 수 없는 행사입니다.'); return; }

  // 버튼에 박힌 회차 날짜가 지난 회차(옛 출석조사 버튼)면 현재 회차로 보정 →
  // 보드가 보여주는 회차와 항상 일치(이전 버튼 눌러 명단에 안 뜨던 문제 방지).
  var currentMeeting = nextMeetingDate_(todayStr_(), ev.weekday, ev.nth);
  if (meetingDate !== currentMeeting) meetingDate = currentMeeting;

  var statusKr = status === 'attend' ? '참석' : '불참';
  var fullName = ((from.first_name || '') + ' ' + (from.last_name || '')).trim();

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var rec;
  try {
    upsertMember_(from.id, from.username || '', fullName);   // 자동 등록 + 자동매칭
    rec = recordAttendance_(eventKey, meetingDate, from.id, status);
  } finally {
    lock.releaseLock();
  }
  var isFirst = rec.isFirst;

  var noChange = !rec.isFirst && rec.prevStatus === status;
  tgAnswerCallback_(cq.id, noChange
    ? ('이미 ' + statusKr + '(으)로 기록되어 있습니다 😊 맨 아래 명단에서 확인하실 수 있어요.')
    : (ev.name + ' ' + statusKr + '(으)로 기록했습니다. 감사합니다!'));

  // 시트에 저장된 매칭값을 우선 사용(수동 연결 포함) → 호칭·표기 일관
  var member = getMemberById_(from.id) || { full_name: fullName, username: from.username, aho: '', name: '' };
  var matched = !!member.name;
  var name = matched ? memberLabel_(member) : displayName_(fullName, from.username);  // 보고용 '아호 성명'
  var addr = matched ? (member.aho || member.name) : displayName_(fullName, from.username);  // 호칭(아호)

  // (b) 단톡 메시지 (아호로 호칭)
  if (SETTINGS.praiseInGroup) {
    var seed = parseInt(String(from.id).slice(-6), 10) || 0;
    var isPresident = matched && member.name === presidentName_();
    var pastTitle = matched ? pastPresidentTitle_(member.name) : null;
    var grp = getGroupChatId_();

    if (status === 'attend') {
      if (isFirst) {
        var isImmediatePast = matched && member.name === immediatePastPresidentName_();
        if (isPresident) {
          tgSend_(grp, presidentPraise_(addr, seed));                 // 현 회장 → 재미있는 특별 감사
        } else if (isImmediatePast) {
          tgSend_(grp, immediatePastPraise_(member, seed));           // 직전회장 → 가장 공손한 예우
        } else if (pastTitle) {
          tgSend_(grp, pastPresidentPraise_(member, pastTitle, seed)); // 그 외 역대 회장 → 예우 환영
        } else {
          // 직책/동호회장 있으면 명칭으로 예우, 아니면 아호 호칭
          var who = (clubRole_(member.name) || subTitle_(member.name)) ? memberHonorific_(member) : addr;
          tgSend_(grp, '[' + ev.name + '] ' + praiseMessage_(who, status, seed));
        }
      }
    } else { // 불참
      if (ev.key === 'event1') {
        if (isFirst || rec.prevStatus !== 'absent') {
          tgSend_(grp, isPresident
            ? '[정기모임] ' + addr + ' 회장님, 부득이 불참 알겠습니다. 회원들이 빈자리를 든든히 채우겠습니다! 🙌'
            : absentPresidentMsg_(addr));   // 일반 회원 → 회장님 명의 독려
        }
      } else if (isFirst) {
        tgSend_(grp, '[' + ev.name + '] ' + praiseMessage_(addr, status, seed));     // 봉사 불참 → 일반 회신 인사
      }
    }
  }

  // (c) 임원방 보고 — 실제 변경(신규/상태변경)일 때만: 한 줄 알림 + 불참·미응답 실시간 보드 갱신
  if (SETTINGS.reportToOfficers && getOfficerChatId_() && (isFirst || rec.prevStatus !== status)) {
    var s = getAttendanceSummary_(eventKey, meetingDate);
    tgSend_(getOfficerChatId_(),
      '🔔 ' + name + ' 님 → ' + ev.name + ' ' + statusKr + '\n' +
      '참석 ' + s.attend.length + ' · 불참 ' + s.absent.length + ' · 미응답 ' + s.no_response.length +
      '  (아래 현황 참고)');
    floatOfficerBoard_();
  }

  // (e) 명부 미매칭 응답자 → 임원방에 연결 요청 (최초 1회)
  if (isFirst && getOfficerChatId_() && !matched) {
    tgSend_(getOfficerChatId_(), '⚠️ <b>명부 미매칭 응답</b>: ' + displayName_(fullName, from.username) +
      ' (id <code>' + from.id + '</code>)\n→ members 시트의 matched_aho/matched_name 에 직접 입력해 연결해 주세요.');
  }

  // (d) 실시간 출석 보드를 단톡 최하단에 다시 띄움 — 회원이 본인 응답을 즉시 확인하도록 항상 갱신
  //     (이전 보드는 삭제 후 재게시하는 단일 보드라 도배되지 않음. 재클릭 시 무반응 혼란 방지)
  floatBoard_();
}

/** 회원 명칭: [현 직책 ]아호 이름[(역대회장/동호회장)] (예: 차기회장 찰수 서상일(골프회장)) */
function memberHonorific_(member) {
  var role = clubRole_(member.name);
  var sub = subTitle_(member.name);
  var base = (member.aho ? member.aho + ' ' : '') + member.name;
  return (role ? role + ' ' : '') + base + (sub ? '(' + sub + ')' : '');
}

/** 직전회장 참석 시 — 가장 공손한 예우의 환영 */
function immediatePastPraise_(member, seed) {
  var label = memberHonorific_(member);
  var pool = [
    '🙇‍♂️ <b>' + label + '</b> 님, 참석해 주셔서 진심으로 감사합니다.\n직전 회기를 빛내 주신 직전회장님의 발걸음에 깊이 고개 숙입니다.\n오늘도 변함없는 가르침과 사랑 부탁드립니다. 🙏',
    '🙏 <b>' + label + '</b> 님 참석!\n클럽을 한결같이 이끌어 주신 직전회장님을 정중히 모십니다.\nAI사무장, 두 손 모아 깊이 환영합니다 🙇‍♂️'
  ];
  return pool[Math.abs(seed || 0) % pool.length];
}

/** 역대 회장 참석 시 — 직책·아호·이름·역대직책으로 예우하는 환영 */
function pastPresidentPraise_(member, title, seed) {
  var label = memberHonorific_(member);
  var pool = [
    '🎖 <b>' + label + '</b> 님 참석!\n클럽의 역사를 만들어 주신 ' + title + '님을 AI사무장이 두 손 모아 환영합니다 🙇‍♂️\n회원 여러분, 선배 회장님께 감사의 박수 👏👏',
    '👏 <b>' + label + '</b> 님께서 함께해 주십니다!\n' + title + '님의 한 걸음이 후배들에게 큰 귀감입니다. AI사무장 깊이 감사드립니다 🙇‍♂️',
    '🌟 <b>' + label + '</b> 님 참석!\n오늘도 빛나는 ' + title + '님의 자리, 금송의 자랑입니다 ✨ 감사합니다!'
  ];
  return pool[Math.abs(seed || 0) % pool.length];
}

/** 회장님 참석 시 — 회원들이 보기에 재미있는 특별 감사 메시지 */
function presidentPraise_(addr, seed) {
  var pool = [
    '🎉🎊 <b>회장님 등장!</b> 🎊🎉\n' + addr + ' 회장님께서 친히 <b>참석</b> 버튼을 눌러주셨습니다! 👑\nAI사무장, 감격하여 90도로 인사 올립니다 🙇‍♂️\n회원 여러분~ 회장님께 우레와 같은 박수 👏👏👏',
    '🚨 <b>속보</b> 🚨\n' + addr + ' 회장님 참석 확정! 오늘 모임은 이미 절반의 성공입니다 ✨\nAI사무장이 가장 큰 절을 올립니다 🙇‍♂️🙇‍♂️🙇‍♂️',
    '👑 ' + addr + ' 회장님 참석이오!\n사무장봇, 기쁨에 겨워 폭죽을 터뜨립니다 🎆🎆\n“회장님 한 분이 백 명의 힘” — 회원 여러분도 박수 부탁드립니다 👏',
    '🎺 빠밤~ ' + addr + ' 회장님 납시오! 🎺\n참석 확인! AI사무장 무한 감사드리며 큰절 올립니다 🙇‍♂️\n오늘도 금송의 기운이 차오릅니다 🔥'
  ];
  return pool[Math.abs(seed || 0) % pool.length];
}

/** 정기모임 불참자에게 보내는 회장님 명의 독려문 */
function absentPresidentMsg_(addr) {
  return '[정기모임] ' + addr + ' 님, 회신 감사합니다. 🙏\n' +
    '부득이 본 회의 참석이 어려우시면 <b>2부 식사 자리</b>만이라도 함께해 주시면 큰 힘이 됩니다.\n' +
    '그마저 어려우시면 <b>다음 정기모임</b>에는 꼭 함께해 주시길 부탁드립니다. 🙇\n\n' +
    '— ' + presidentLabel_() + ' 드림';
}

// ── 공통 UI(고급 디자인) ──────────────────────────────────────
var UI_LINE = '━━━━━━━━━━━━━';
var UI_CLUB = '국제로타리 3700지구 · 대구금송RC';
var UI_THEME = '🌍 지속적인 영향력을 · CREATE LASTING IMPACT';
var UI_SLOGAN = '🤝 봉사는 팩트 · 기부는 임팩트 · 사랑은 퍼펙트';

// ───────────────────────────────────── 발송 빌더
function attendanceKeyboard_(eventKey, meetingDate) {
  var base = 'att:' + eventKey + ':' + meetingDate;
  return {
    inline_keyboard: [[
      { text: '✅ 참석', callback_data: base + ':attend' },
      { text: '❌ 불참', callback_data: base + ':absent' }
    ]]
  };
}

/**
 * 단톡 최하단에 '실시간 출석 보드'(현재 참석 명단 + 참석/불참 버튼)를 항상 띄워 둔다.
 * 이전 보드를 지우고 갱신된 내용을 맨 아래에 다시 올린다 → 메시지가 밀려 올라가도 늘 하단에서
 * 다음 사람이 현황을 보며 바로 선택 가능.
 */
function floatBoard_() {
  var chatId = getGroupChatId_();
  var today = todayStr_();
  var blocks = recurringEvents_().map(function (ev) {
    var meeting = nextMeetingDate_(today, ev.weekday, ev.nth);
    var s = getAttendanceSummary_(ev.key, meeting);
    var ordered = getAttendInPressOrder_(ev.key, meeting);   // 누른 순서
    var attendList = ordered.length
      ? ordered.map(function (n, i) { return '     ' + (i + 1) + '. ' + n; }).join('\n')
      : '     (아직 없음)';
    return '📅 <b>' + ev.name + '</b>  <i>' + formatMeetingDate_(meeting, ev.hour, ev.minute) + '</i>\n' +
      '   ✅ <b>참석 ' + ordered.length + '명</b>\n' + attendList + '\n' +
      '   ❌ 불참 ' + s.absent.length + '  ·  ❔ 미응답 ' + s.no_response.length;
  });
  var text = '⚙️ <b>실시간 출석 현황</b> · 대구금송RC\n' + UI_LINE + '\n' + blocks.join('\n\n') +
    '\n' + UI_LINE + '\n👇 아직이라면 아래에서 선택해 주세요';

  var key = 'FLOAT_BTN_MSG';
  var prev = props_().getProperty(key);
  if (prev) tgApi_('deleteMessage', { chat_id: chatId, message_id: parseInt(prev, 10) });
  var res = tgSend_(chatId, text, weeklyKeyboard_());
  if (res && res.ok && res.result) props_().setProperty(key, String(res.result.message_id));
}

/**
 * 임원방 최하단에 '불참·미응답 실시간 현황' 보드를 띄운다(이전 보드 삭제 후 재게시).
 * 🔄 새로고침 버튼으로 임원이 언제든 최신 명단을 맨 아래에서 바로 볼 수 있다.
 */
function floatOfficerBoard_() {
  var chatId = getOfficerChatId_();
  if (!chatId) return;
  var today = todayStr_();
  var blocks = recurringEvents_().map(function (ev) {
    var meeting = nextMeetingDate_(today, ev.weekday, ev.nth);
    var s = getAttendanceSummary_(ev.key, meeting);
    return '📅 <b>' + ev.name + '</b>  <i>' + formatMeetingDate_(meeting, ev.hour, ev.minute) + '</i>\n' +
      '   ✅ <b>' + s.attend.length + '</b>  ·  ❌ <b>' + s.absent.length + '</b>  ·  ❔ <b>' + s.no_response.length + '</b>';
  });
  var text = '⚙️ <b>임원용 실시간 현황</b>\n' + UI_LINE + '\n' + blocks.join('\n\n') +
    '\n' + UI_LINE + '\n🔎 <i>불참·미응답 명단은 버튼을 누른 분만 1:1로 받습니다</i>\n' + UI_SLOGAN;
  var kb = { inline_keyboard: [
    [ { text: '✅ 참석 보기', callback_data: 'view:attend' } ],
    [ { text: '❌ 불참 보기', callback_data: 'view:absent' }, { text: '❔ 미응답 보기', callback_data: 'view:noresp' } ],
    [ { text: '🔄 새로고침', callback_data: 'refresh' } ]
  ] };

  var key = 'OFFICER_BOARD_MSG';
  var prev = props_().getProperty(key);
  if (prev) tgApi_('deleteMessage', { chat_id: chatId, message_id: parseInt(prev, 10) });
  var res = tgSend_(chatId, text, kb);
  if (res && res.ok && res.result) props_().setProperty(key, String(res.result.message_id));
}

/** 로타리 회기 라벨: 7/1~익년 6/30 → 'YYYY-YY' (예: 2026-27) */
function termLabel_(meetingDate) {
  var a = ymd_(meetingDate);
  var startYear = a.m >= 7 ? a.y : a.y - 1;
  return startYear + '-' + pad2_((startYear + 1) % 100);
}

/** 정기모임 특례: 7월=정기총회, 12월=연차총회. 해당 없으면 null. */
function specialMeetingNote_(ev, meetingDate) {
  if (ev.key !== 'event1') return null;     // 정기모임에만 적용
  var m = ymd_(meetingDate).m;
  if (m === 7)  return '🏛 이번 모임은 <b>정기총회</b>입니다. (회기 첫 정기모임)';
  if (m === 12) return '🏛 이번 모임은 <b>연차총회</b>입니다. (차기 회장·임원 선출)';
  return null;
}

function buildAnnouncement_(ev, meetingDate) {
  var a = ymd_(meetingDate);
  var q = quoteForMonth_(a.y, a.m);
  var when = formatMeetingDate_(meetingDate, ev.hour, ev.minute);
  var note = specialMeetingNote_(ev, meetingDate);
  var text =
    '⚙️ <b>' + UI_CLUB + '</b>\n' + UI_THEME + '\n' + UI_LINE + '\n' +
    '💬 <i>이달의 한마디</i>\n<i>“' + q + '”</i>\n\n' +
    '📅 <b>' + ev.name + '</b>   <i>· ' + termLabel_(meetingDate) + ' 회기</i>\n' +
    '🗓 <b>' + when + '</b>\n' +
    (note ? note + '\n' : '');

  // 정기모임 공지에 '이번 달 + 다음 달' 동호회 행사 안내를 덧붙인다 (시각은 정기모임에서 별도 안내)
  if (ev.key === 'event1') {
    var nextMonth = a.m === 12 ? 1 : a.m + 1;
    var notice = clubNoticeForMonths_([a.m, nextMonth]);
    if (notice.length) {
      text += '\n📌 <b>동호회 행사</b>\n' + notice.join('\n') +
        '\n<i>(날짜·장소·시간은 정기모임에서 안내)</i>\n';
    }
  }
  text += UI_LINE + '\n' + UI_SLOGAN + '\n👇 <b>참석 여부</b>를 아래 버튼으로 알려주세요';
  return text;
}

function summaryText_(ev, meetingDate, s) {
  var when = formatMeetingDate_(meetingDate, ev.hour, ev.minute);
  var total = s.attend.length + s.absent.length + s.no_response.length;
  function names(arr) {
    if (!arr.length) return '  (없음)';
    return arr.map(function (m) { return '  • ' + memberLabel_(m); }).join('\n');
  }
  return '⚙️ <b>' + ev.name + ' 출석 현황</b>\n🗓 ' + when + '\n' + UI_LINE + '\n' +
    '전체 ' + total + '명 — ✅ ' + s.attend.length + ' · ❌ ' + s.absent.length + ' · ❔ ' + s.no_response.length + '\n\n' +
    '✅ <b>참석 (' + s.attend.length + ')</b>\n' + names(s.attend) + '\n\n' +
    '❌ <b>불참 (' + s.absent.length + ')</b>\n' + names(s.absent) + '\n\n' +
    '❔ <b>미응답 (' + s.no_response.length + ')</b>\n' + names(s.no_response);
}

function sendAnnouncement_(ev) {
  var meeting = nextMeetingDate_(todayStr_(), ev.weekday, ev.nth);
  tgSend_(getGroupChatId_(), buildAnnouncement_(ev, meeting), attendanceKeyboard_(ev.key, meeting));
  markAnnounced_(ev.key, meeting);
  if (SETTINGS.reportToOfficers && getOfficerChatId_()) {
    tgSend_(getOfficerChatId_(), '📣 ' + ev.name + ' (' + formatMeetingDate_(meeting, ev.hour, ev.minute) + ') 출석조사를 단톡에 발송했습니다.');
  }
  return meeting;
}

function sendReminder_(ev) {
  var meeting = nextMeetingDate_(todayStr_(), ev.weekday, ev.nth);
  var s = getAttendanceSummary_(ev.key, meeting);
  if (s.no_response.length === 0) return 0;
  var names = s.no_response.map(function (m) { return memberLabel_(m); }).join(', ');
  var text = '⏰ <b>' + ev.name + ' 참석 여부 회신 부탁드립니다</b>\n' +
    '🗓 ' + formatMeetingDate_(meeting, ev.hour, ev.minute) + ' 일정이 곧 다가옵니다.\n\n' +
    '아직 회신하지 않으신 ' + s.no_response.length + '분: ' + names + '\n\n' +
    '아래 버튼으로 참석 여부를 알려주세요. 🙏';
  tgSend_(getGroupChatId_(), text, attendanceKeyboard_(ev.key, meeting));
  markReminded_(ev.key, meeting);
  return s.no_response.length;
}

// ───────────────────────────────────── 주간 다이제스트 / 개인 독려
function epochDay_(dateStr) {
  var a = ymd_(dateStr);
  return Math.floor(Date.UTC(a.y, a.m - 1, a.d) / 86400000);
}

/** 매주 월요일: 단톡에 명언 + 행사별 참석 예정 명단 + 독려 + 참석 버튼 */
function sendWeeklyDigest_() {
  var today = todayStr_();
  var seed = epochDay_(today);
  var blocks = recurringEvents_().map(function (ev) {
    var meeting = nextMeetingDate_(today, ev.weekday, ev.nth);
    var s = getAttendanceSummary_(ev.key, meeting);
    var attendNames = s.attend.length
      ? s.attend.map(function (m) { return memberLabel_(m); }).join(', ')
      : '아직 없음';
    return '📅 <b>' + ev.name + '</b> — ' + formatMeetingDate_(meeting, ev.hour, ev.minute) +
      '  (D-' + daysUntil_(meeting, today) + ')\n' +
      '  ✅ 참석 예정 (' + s.attend.length + '): ' + attendNames + '\n' +
      '  ❔ 미응답 ' + s.no_response.length + '명';
  });
  var text = '🗓 <b>이번 주 클럽 안내</b> (월요일)\n💬 <i>' + quoteForDay_(seed) + '</i>\n\n' +
    blocks.join('\n\n') + '\n\n' + nudgeForDay_(seed) +
    '\n👇 아직 참석 여부를 안 정하셨다면 눌러주세요.';
  tgSend_(getGroupChatId_(), text, weeklyKeyboard_());
}

/** 정기 행사 전체에 대한 참석/불참 버튼(행사별 2개씩) */
function weeklyKeyboard_() {
  var today = todayStr_();
  var rows = recurringEvents_().map(function (ev) {
    var meeting = nextMeetingDate_(today, ev.weekday, ev.nth);
    var base = 'att:' + ev.key + ':' + meeting;
    return [
      { text: '✅ ' + ev.name + ' 참석', callback_data: base + ':attend' },
      { text: '❌ 불참', callback_data: base + ':absent' }
    ];
  });
  return { inline_keyboard: rows };
}

/** 말일~정기모임 당일(오전) 사이면, 미응답자에게 개인(1:1) 독려 발송 */
function personalNudgeIfWindow_() {
  var ev = getEventByKey_(SETTINGS.personalNudgeEventKey);
  if (!ev || ev.kind !== 'recurring') return;
  var today = todayStr_();
  var meeting = nextMeetingDate_(today, ev.weekday, ev.nth);
  var mm = ymd_(meeting);
  var prev = mm.m === 1 ? { y: mm.y - 1, m: 12 } : { y: mm.y, m: mm.m - 1 };
  var windowStart = lastDayOfMonthStr_(prev.y, prev.m);   // 직전 달 말일(=공지 시작일)
  if (today < windowStart || today > meeting) return;     // 창 밖이면 발송 안 함(당일 오전까지만)
  sendPersonalNudges_(ev, meeting);
}

/** 미응답자에게 1:1 개인 독려. 봇을 시작하지 않은 회원은 도달 불가 → 임원방에 명단 보고. */
function sendPersonalNudges_(ev, meeting) {
  var s = getAttendanceSummary_(ev.key, meeting);
  if (!s.no_response.length) return;
  var seed = epochDay_(todayStr_());
  var quote = quoteForDay_(seed);
  var nudge = nudgeForDay_(seed);
  var when = formatMeetingDate_(meeting, ev.hour, ev.minute);
  var kb = attendanceKeyboard_(ev.key, meeting);

  var sent = 0, failed = [];
  s.no_response.forEach(function (m) {
    if (!m.user_id) return;        // 텔레그램 미등록자(명부만 존재) → 개인 DM 불가, 조용히 건너뜀
    var name = memberLabel_(m);
    var text = '🙏 ' + name + ' 님, 개인 안내드립니다.\n💬 <i>' + quote + '</i>\n\n' +
      '📅 <b>' + ev.name + '</b> ' + when + ' 참석 여부를 아직 받지 못했습니다.\n' +
      nudge + '\n아래 버튼으로 알려주시면 더 이상 보내드리지 않습니다. 😊';
    var res = tgApi_('sendMessage', {
      chat_id: m.user_id, text: text, parse_mode: 'HTML',
      disable_web_page_preview: true, reply_markup: kb
    });
    if (res && res.ok) sent++; else failed.push(name);
  });
  Logger.log('개인 독려: 성공 ' + sent + ', 미도달 ' + failed.length + ' → ' + failed.join(', '));

  // 미도달(봇 미시작) 명단은 월요일에 한 번 임원방에 보고
  var t = ymd_(todayStr_());
  if (failed.length && getOfficerChatId_() && weekdayOf_(t.y, t.m, t.d) === 1) {
    tgSend_(getOfficerChatId_(),
      '⚠️ <b>개인 독려 미도달</b> ' + failed.length + '명 (봇 1:1 미시작):\n' + failed.join(', ') +
      '\n→ 해당 회원께 @geumsong_secretary_bot 과 1:1 대화에서 /start 1회를 부탁드리세요.');
  }
}

// ───────────────────────────────────── 시간 트리거(매일 점검)
function dailyCheck() {
  var today = todayStr_();
  var monthEnd = isLastDayOfMonth_(today);
  recurringEvents_().forEach(function (ev) {
    var meeting = nextMeetingDate_(today, ev.weekday, ev.nth);
    if (monthEnd && !isAnnounced_(ev.key, meeting)) {
      Logger.log('월말 감지 → ' + ev.name + ' 출석조사');
      sendAnnouncement_(ev);
    }
    if (daysUntil_(meeting, today) === SETTINGS.reminderDaysBefore && !isReminded_(ev.key, meeting)) {
      Logger.log('D-' + SETTINGS.reminderDaysBefore + ' 감지 → ' + ev.name + ' 리마인더');
      sendReminder_(ev);
    }
  });

  // 매주 월요일 단톡 다이제스트
  var t = ymd_(today);
  if (SETTINGS.weeklyDigest && weekdayOf_(t.y, t.m, t.d) === 1) {
    Logger.log('월요일 → 주간 다이제스트');
    sendWeeklyDigest_();
  }
  // 정기모임 미응답자 개인 독려 (말일~당일 오전)
  if (SETTINGS.personalNudge) personalNudgeIfWindow_();
}

// ───────────────────────────────────── 설치/운영 함수 (에디터에서 1회 실행)
/**
 * 최초 1회 실행:
 *  1) 데이터 스프레드시트 생성(없으면) + 시트 3종 준비, SHEET_ID 저장
 *     (Script Property DRIVE_FOLDER_ID 가 있으면 그 폴더로 이동 — 공유드라이브 가능)
 *  2) dailyCheck 일일 트리거 생성
 */
function setup() {
  var id = props_().getProperty('SHEET_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('AI사무장봇 데이터');
    props_().setProperty('SHEET_ID', ss.getId());
    var folderId = props_().getProperty('DRIVE_FOLDER_ID');
    if (folderId) {
      try {
        var file = DriveApp.getFileById(ss.getId());
        DriveApp.getFolderById(folderId).addFile(file);
        DriveApp.getRootFolder().removeFile(file);   // 내 드라이브에서 제거
      } catch (e) {
        Logger.log('폴더 이동 실패(무시 가능): ' + e);
      }
    }
  }
  getOrCreateSheet_(ss, SHEET_MEMBERS, HEADERS_MEMBERS);
  getOrCreateSheet_(ss, SHEET_ATTENDANCE, HEADERS_ATTENDANCE);
  getOrCreateSheet_(ss, SHEET_MEETINGS, HEADERS_MEETINGS);
  ensureMemberMatchHeaders_();
  seedRoster_();                       // 명부 시트 채우기 + 기존 회원 재매칭
  // 기본 시트('시트1') 정리
  var def = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  createDailyTrigger_();

  var url = ss.getUrl();
  Logger.log('✅ setup 완료\n  SHEET_ID = ' + props_().getProperty('SHEET_ID') + '\n  시트 URL = ' + url);
  return url;
}

function createDailyTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailyCheck') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('dailyCheck')
    .timeBased().atHour(SETTINGS.announceHour).everyDays(1)
    .inTimezone(TZ).create();
  Logger.log('일일 트리거 생성: 매일 ' + SETTINGS.announceHour + '시 (' + TZ + ')');
}

/** 일정 계산 자체 점검 (에디터에서 실행 → 로그 확인) */
function testScheduling_() {
  var checks = [];
  checks.push(['정기모임 2026-07 첫째 화', nthWeekdayOfMonth_(2026, 7, 2, 1), '2026-07-07']);
  checks.push(['봉사 2026-07 셋째 토',     nthWeekdayOfMonth_(2026, 7, 6, 3), '2026-07-18']);
  checks.push(['다음 정기모임(6/26 기준)', nextMeetingDate_('2026-06-26', 2, 1), '2026-07-07']);
  checks.push(['다음 봉사(6/26 기준)',     nextMeetingDate_('2026-06-26', 6, 3), '2026-07-18']);
  checks.push(['월말 판정 6/30',           String(isLastDayOfMonth_('2026-06-30')), 'true']);
  checks.push(['D-N 6/15→봉사 7/18 남은일', String(daysUntil_('2026-07-18', '2026-07-15')), '3']);
  var ok = true;
  checks.forEach(function (c) {
    var pass = String(c[1]) === String(c[2]);
    ok = ok && pass;
    Logger.log((pass ? '[OK] ' : '[FAIL] ') + c[0] + ' = ' + c[1] + (pass ? '' : ' (기대: ' + c[2] + ')'));
  });
  Logger.log(ok ? '=== 전체 통과 ===' : '=== 실패 있음 ===');
  return ok;
}
