/**
 * Office.js — 임원방(사무국) 모드: Club.js 의 CLUB.accessControl = true 인 클럽 전용
 *
 * 이 모드에서는
 *  - 등록된 user_id(회원 탭·ADMIN_IDS)의 명령만 처리하고 나머지는 무시한다. (/id 만 예외 — 등록에 필요)
 *  - 출석·구 재무 명령(/납부 /지출 …)은 열려 있지 않다. 재무는 승인 절차가 있는 새 모듈로만 다룬다.
 *  - 단계: ①교육 ②일정 ③회비·지출(설정 FINANCE_LIVE=TRUE 전에는 테스트 모드)
 */
function officeMode_() { return typeof CLUB !== 'undefined' && !!CLUB.accessControl; }

// 기획서의 탭 구조(설정·회원·로그는 각 모듈에 정의)
var OFFICE_TABS = [
  ['임원', ['직책', '구분', '성명', '상태', '비고']],
  ['교육과정', ['회차', '주제', '영상링크', '확인질문', '정답기준', '게시예정일', '게시시각']],
  ['교육이수', ['시각', '회차', 'user_id', '성명', '응답', '판정']],
  ['일정', ['날짜', '시간', '구분', '제목', '장소', '알림(며칠 전, 쉼표)', '비고']],
  ['회비청구', ['청구ID', '회기', '분납차수', '성명', '항목', '금액', '납기', '상태', '적용환율', '생성시각', '정정대상']],
  ['입금', ['입금ID', '입금일', '성명', '금액', '청구ID', '확인자', '입력시각', '정정대상']],
  ['지출결의', ['결의ID', '기안일', '계정(운영/봉사프로젝트)', '적요', '금액', '기안자', '상태', '승인자', '승인시각', '집행일', '집행자', '증빙', '정정대상']],
  ['월보고', ['연월', '게시시각', '수입', '지출', '미납', '본문']]
];
var OFFICE_BOARD_SEATS = [   // 임원 13석 — 직책명은 개인정보 아님. 성명은 시트에서 입력
  ['회장', '회장단'], ['차기회장', '회장단'], ['부회장', '회장단'],
  ['총무이사', '직무이사'], ['재무이사', '직무이사'], ['사찰이사', '직무이사'],
  ['클럽관리위원장', '상임위원장'], ['회원위원장', '상임위원장'], ['공공이미지위원장', '상임위원장'],
  ['로타리재단위원장', '상임위원장'], ['봉사프로젝트위원장', '상임위원장'],
  ['분과6 위원장(명칭 미정)', '상임위원장'], ['분과7 위원장(명칭 미정)', '상임위원장']
];

// ── 메시지·버튼 진입점 (Code.js handleMessage_/handleCallback_ 에서 위임) ──
/**
 * 명령 표. 실행 조건 = 사용자 권한(cap) AND 그 방에 열린 기능(feat, Rooms.js). feat 없는 명령은 등록된 방·1:1 어디서나.
 * help 가 있는 명령만 /help 에 나온다 — 그 사람이, 그 방에서, 실제로 쓸 수 있는 것만 보여 준다.
 */
var OFFICE_COMMANDS = [
  { n: ['/form', '/양식'], cap: 'roster.add', feat: 'intake', help: '예비회원 추천 양식 — 복사해 채워 올리면 명단에 자동 기재',
    run: function (c) { tgSend_(c.chat.id, '<code>' + escapeHtml_(intakeFormText_()) + '</code>\n\n↑ 눌러서 복사 → 내용을 채워 이 방에 올리면 명단에 자동 기재됩니다. (여러 명은 양식을 이어 붙이세요)'); } },
  { n: ['/save', '/보관'], cap: 'docs.upload', feat: 'docs', help: '파일 보관 — 봇 1:1 에 파일을 보내거나, 방에서 파일에 답장으로 /보관',
    run: function (c) { tgSend_(c.chat.id, '📁 <b>파일 보관 방법</b>\n① 봇과의 1:1 대화창에 파일을 보내세요(다른 방의 파일을 \'전달\'해도 됩니다).\n② 이 방에서는 파일 설명글에 <code>/보관</code> 을 적어 올리거나, 이미 올라온 파일에 <b>답장</b>으로 <code>/보관</code>.\n→ 폴더 버튼을 누르면 드라이브에 저장되고 링크를 알려 드립니다. (20MB 이하)'); } },
  { n: ['/recruit', '/모집현황'], cap: 'view', feat: 'recruit.summary', help: '창립회원 모집 현황', run: function (c) { recruitReply_(c.chat, 'summary'); } },
  { n: ['/confirm', '/확약'], cap: 'roster.add', feat: 'intake', help: '/확약 이름 [이름…] — 확약으로 변경 (같은 방식: /검토중 · /보류)', run: function (c) { recruitSetStatusReply_(c.chat, c.user, c.text, '확약'); } },
  { n: ['/aho', '/아호'], cap: 'roster.add', feat: 'intake', help: '/아호 이름 아호, 이름 아호 … — 아호 기재', run: function (c) { recruitSetAhoReply_(c.chat, c.user, c.text); } },
  { n: ['/role', '/직책'], cap: 'roster.add', feat: 'intake', help: '/직책 이름 직책 — 창립회기 직책 지정 (해제: 없음)', run: function (c) { recruitSetRoleReply_(c.chat, c.user, c.text); } },
  { n: ['/pending', '/검토중'], cap: 'roster.add', feat: 'intake', run: function (c) { recruitSetStatusReply_(c.chat, c.user, c.text, '검토중'); } },
  { n: ['/hold', '/보류'], cap: 'roster.add', feat: 'intake', run: function (c) { recruitSetStatusReply_(c.chat, c.user, c.text, '보류'); } },
  { n: ['/recruitlist', '/모집명단'], cap: 'view', feat: 'recruit.names', help: '예비회원 명단(상태별 이름)', run: function (c) { recruitReply_(c.chat, 'list'); } },
  { n: ['/edu', '/교육', '/이수현황'], cap: 'view', feat: 'edu', help: '교육 (1단계 · 준비 중)', run: function (c) { officeNotYet_(c.chat, 1, '교육'); } },
  { n: ['/schedule', '/일정'], cap: 'view', feat: 'schedule', help: '일정 (2단계 · 준비 중)', run: function (c) { officeNotYet_(c.chat, 2, '일정 알림'); } },
  { n: ['/회비현황', '/미납', '/지출기안', '/승인대기'], cap: 'finance.view', feat: 'finance', help: '회비·지출 (3단계 · 준비 중)', run: function (c) { officeNotYet_(c.chat, 3, '회비·지출'); } },
  { n: ['/월보고'], cap: 'finance.view', feat: 'finance.report', run: function (c) { officeNotYet_(c.chat, 3, '월 보고'); } },
  { n: ['/guide', '/사용법', '/안내'], cap: 'view', help: '이 방 사용 설명서', run: function (c) { officeCmdGuide_(c); } },
  { n: ['/whoami', '/내권한'], cap: 'view', help: '내 등록 정보',
    run: function (c) { tgSend_(c.chat.id, '👤 ' + escapeHtml_(c.user.name) + (c.user.title ? ' · ' + escapeHtml_(c.user.title) : '') + '\n권한: <b>' + escapeHtml_(c.user.role) + '</b>'); } },
  { n: ['/adduser', '/등록'], cap: '*', help: '(등록할 분의 메시지에 답장으로) /adduser — 사용자 등록, 권한은 버튼 선택', run: function (c) { officeCmdAddUser_(c.msg, c.chat, c.user, c.text); } },
  { n: ['/recruitcheck', '/모집점검'], cap: 'roster.add', feat: 'recruit.names', help: '명단 입력 누락 점검', run: function (c) { recruitReply_(c.chat, 'check'); } },
  { n: ['/linkroster', '/명단연결'], cap: '*', feat: 'admin', help: '/linkroster 주소 — 명단 파일 연결(엑셀이면 구글시트로 변환)', run: function (c) { recruitLinkReply_(c.chat, c.user, c.text); } },
  { n: ['/settings', '/설정'], cap: '*', feat: 'admin', help: '설정값·미정 항목', run: function (c) { officeCmdSettings_(c.chat); } },
  { n: ['/set', '/설정변경'], cap: '*', feat: 'admin', help: '/set 키 값 — 설정 변경 (예: /set 창립일 2026-10-14)', run: function (c) { officeCmdSet_(c.chat, c.user, c.text); } },
  { n: ['/log', '/로그'], cap: '*', feat: 'admin', help: '최근 변경 기록', run: function (c) { officeCmdLog_(c.chat); } },
  { n: ['/rooms', '/방목록'], cap: '*', feat: 'admin', help: '등록된 방 목록', run: function (c) { officeCmdRooms_(c.chat); } },
  { n: ['/diag'], cap: '*', feat: 'admin', run: function (c) { cmdDiag_(c.chat, c.from); } },
  { n: ['/flush'], cap: '*', feat: 'admin', run: function (c) { cmdFlush_(c.chat, c.from); } }
];
function officeFindCommand_(cmd) {
  for (var i = 0; i < OFFICE_COMMANDS.length; i++) if (OFFICE_COMMANDS[i].n.indexOf(cmd) !== -1) return OFFICE_COMMANDS[i];
  return null;
}

function officeHandleMessage_(msg) {
  var chat = msg.chat, from = msg.from, text = (msg.text || '').trim();
  var trig = docsTrigger_(msg);                             // 파일 보관 요청(1:1 의 파일 · 캡션 /보관 · 파일에 답장 /보관)
  if (trig) {
    var du = authUser_(from.id);
    if (!du) return;                                        // 미등록 user_id → 무시
    var dr = []; try { dr = rooms_(); } catch (e) {}
    docsBegin_(chat, du, dr, trig);
    return;
  }
  if (!text) return;
  var isCmd = text.charAt(0) === '/', cmd = isCmd ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';
  if (cmd === '/id') { officeCmdId_(chat, from); return; }  // 예외: 등록에 필요한 본인 id 확인은 누구나
  if (!isCmd && !intakeLooksLikeForm_(text)) return;        // 일반 대화 — 시트를 읽지 않고 바로 끝(자유 질문은 1단계 교육 모듈에서 연결)

  var user = authUser_(from.id);
  if (!user) return;                                        // 미등록 user_id → 무시
  var rooms = []; try { rooms = rooms_(); } catch (e) { Logger.log('방 탭 읽기 실패: ' + e); }
  var c = { msg: msg, chat: chat, from: from, user: user, text: text };

  if (!isCmd) {                                             // 예비회원 추천 양식 글 → 명단 자동 기재(접수 기능이 열린 방·1:1 에서만)
    if (can_(user, 'roster.add') && roomAllows_(rooms, chat, 'intake')) intakeHandle_(chat, user, text);
    return;
  }
  if (cmd === '/setroom' || cmd === '/방등록') { if (requireCap_(chat, user, '*')) officeCmdSetRoom_(chat, user, text); return; }
  if (chat.type !== 'private' && !roomFind_(rooms, chat.id)) return;   // 등록 안 된 방 → 조용히
  if (cmd === '/start' || cmd === '/help' || cmd === '/도움말') { tgSend_(chat.id, officeHelpText_(user, rooms, chat)); return; }

  var def = officeFindCommand_(cmd);
  if (!def) return;
  if (!requireCap_(chat, user, def.cap)) return;
  if (def.feat && !roomAllows_(rooms, chat, def.feat)) {
    tgSend_(chat.id, '🚪 이 명령은 이 방에서는 쓸 수 없습니다. ' + (roomsWithFeature_(rooms, def.feat).map(function (r) { return '「' + escapeHtml_(r.name || r.type) + '」'; }).join(' · ') || '해당 방') + ' 또는 봇과의 1:1 대화에서 이용해 주세요.');
    return;
  }
  def.run(c);
}

function officeHandleCallback_(cq) {
  var user = authUser_(cq.from.id);
  if (!user) { tgAnswerCallback_(cq.id, '아직 등록 전이라 누를 수 없습니다. 이 버튼은 관리자가 눌러야 합니다.', true); return; }
  var data = String(cq.data || ''), chat = cq.message && cq.message.chat, m;
  if (!chat) { tgAnswerCallback_(cq.id, ''); return; }
  if ((m = /^room:(.+)$/.exec(data)) || (m = /^au:(\d+):(.+)$/.exec(data))) {
    if (!can_(user, '*')) { tgAnswerCallback_(cq.id, '이 버튼은 관리자가 눌러야 합니다.', true); return; }
    tgAnswerCallback_(cq.id, '처리 중…');
    tgApi_('editMessageReplyMarkup', { chat_id: chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });   // 버튼 제거(중복 클릭 방지)
    if (data.charAt(0) === 'r') { if (ROOM_TYPES[m[1]]) roomRegister_(chat, user, m[1]); return; }
    if (!ROLE_CAPS[m[2]] || m[2] === '관리자') return;
    var nm = ''; try { nm = CacheService.getScriptCache().get('AU_NAME_' + m[1]) || ''; } catch (e) {}
    officeAddUserApply_(chat, user, m[1], nm || ('user ' + m[1]), m[2]);
    return;
  }
  if ((m = /^doc\|([A-Za-z0-9]+)\|(\d+|x)$/.exec(data))) { docsHandleCallback_(cq, user, chat, m[1], m[2]); return; }
  if ((m = /^(aho|st)\|([^|]+)\|(.+)$/.exec(data))) {        // 이름 오타 제안 버튼: 명단을 고칠 수 있는 사람이, 접수가 열린 방·1:1 에서만
    var rooms = []; try { rooms = rooms_(); } catch (e) {}
    if (!can_(user, 'roster.add') || !roomAllows_(rooms, chat, 'intake')) { tgAnswerCallback_(cq.id, '이 버튼을 누를 권한이 없습니다.', true); return; }
    if (m[1] === 'st' && RECRUIT_STATUS_ORDER.indexOf(m[3]) === -1) { tgAnswerCallback_(cq.id, ''); return; }
    tgAnswerCallback_(cq.id, '처리 중…');
    tgApi_('editMessageReplyMarkup', { chat_id: chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
    if (m[1] === 'aho') recruitSetAhoReply_(chat, user, '/아호 ' + m[2] + ' ' + m[3]);
    else recruitSetStatusReply_(chat, user, '/' + m[3] + ' ' + m[2], m[3]);
    return;
  }
  tgAnswerCallback_(cq.id, '준비 중인 기능입니다.');
}

function officeNotYet_(chat, phase, label) {
  tgSend_(chat.id, '🛠 <b>' + label + '</b> 기능은 ' + phase + '단계에서 열립니다. (현재 준비 중)');
}

function officeCmdId_(chat, from) {
  var kind = ({ 'private': '개인 대화', 'group': '그룹', 'supergroup': '슈퍼그룹' })[chat.type] || chat.type;
  tgSend_(chat.id, '🆔 이 대화방 ID: <code>' + chat.id + '</code> (' + kind + ')\n당신의 user ID: <code>' + from.id + '</code>\n\n→ user ID 를 관리자에게 알려주시면 등록해 드립니다.');
}

/** 도움말(순수): 이 사용자가 이 방에서 실제로 쓸 수 있는 명령만 */
function officeHelpText_(user, rooms, chat) {
  var room = chat.type === 'private' ? null : roomFind_(rooms, chat.id);
  var L = ['🤖 <b>' + CLUB.short + ' AI 사무장</b>' + (room ? '  ·  ' + escapeHtml_(room.type) + ' 방' : '  ·  1:1'), UI_LINE,
    escapeHtml_(user.name) + ' 님 (권한: ' + escapeHtml_(user.role) + ')', ''];
  var mine = [], admin = [];
  OFFICE_COMMANDS.forEach(function (d) {
    if (!d.help || !can_(user, d.cap) || (d.feat && !roomAllows_(rooms, chat, d.feat))) return;
    (d.cap === '*' ? admin : mine).push('• ' + (d.help.charAt(0) === '/' || d.help.charAt(0) === '(' ? d.help : d.n[0] + (d.n[1] ? ' (' + d.n[1] + ')' : '') + ' — ' + d.help));
  });
  L = L.concat(mine, ['• /id — 대화방·본인 ID', '• /help (/도움말)']);
  if (admin.length) L = L.concat(['', '<b>관리자</b>'], admin, ['• /setroom 유형 — (그룹방에서) 이 방 등록: ' + Object.keys(ROOM_TYPES).join(' · ')]);
  return L.join('\n');
}

function officeCmdRooms_(chat) {
  invalidateRooms_();
  var rs = rooms_();
  tgSend_(chat.id, '🚪 <b>등록된 방</b>\n' + UI_LINE + '\n' + (rs.length ? rs.map(function (r) { return '• <b>' + escapeHtml_(r.type) + '</b> — ' + escapeHtml_(r.name || r.chatId); }).join('\n') : '(없음) 각 방에서 /setroom 유형'));
}

/** 설정 요약 텍스트(순수): 값 있는 항목 + 미정 항목 */
function officeSettingsText_(map) {
  var blank = settingsBlankKeys_(map);
  var L = ['⚙️ <b>설정</b> (시트 「설정」 탭에서 수정)', UI_LINE];
  SETTINGS_DEFAULTS.forEach(function (r) {
    var v = map[r[0]];
    if (settingIsBlank_(v)) return;
    var shown = Object.prototype.toString.call(v) === '[object Date]' ? settingDateOf_(v) : String(v);
    L.push('• ' + escapeHtml_(r[0]) + ': <b>' + escapeHtml_(shown) + '</b>');
  });
  L.push('', blank.length ? '❔ <b>미정 ' + blank.length + '개</b>: ' + blank.map(escapeHtml_).join(', ') : '✅ 미정 항목 없음');
  L.push('', '💰 재무 기능: ' + (settingBoolOf_(map['FINANCE_LIVE'], false) ? '<b>실가동</b>' : '테스트 모드 (FINANCE_LIVE=FALSE)'));
  return L.join('\n');
}
function officeCmdSettings_(chat) { try { seedSettings_(); } catch (e) {} invalidateSettings_(); tgSend_(chat.id, officeSettingsText_(settingsMap_())); }

function officeCmdLog_(chat) {
  var lines = auditTailLines_(getOrCreateSheet_(getSS_(), AUDIT_SHEET, AUDIT_HEADERS).getDataRange().getValues(), 10);
  tgSend_(chat.id, '🧾 <b>최근 변경 기록</b>\n' + UI_LINE + '\n' + (lines.length ? lines.join('\n') : '(기록 없음)'));
}

// ── 일일 작업 (dailyCheck 에서 위임) ─────────────────────────
function officeDaily_() {
  try { postWeeklyRecruitIfDue_(); } catch (e) { Logger.log('모집 현황 보고 실패: ' + e); }
  // 2단계: 일정 D-day 알림 / 3단계: 납기 알림·월 보고 — 모듈 추가 시 여기에 연결
}

// ── 시트 직접 편집 기록 (설치형 onEdit 트리거) ────────────────
/** 사람이 설정·회원 등 주요 탭을 시트에서 직접 고치면 로그 탭에 변경 전후를 남긴다. */
function officeOnEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet(), name = sh.getName();
    if (name === AUDIT_SHEET || ['설정', '회원', '방', '임원', '회비청구', '입금', '지출결의'].indexOf(name) === -1) return;
    var who = '(시트 편집)' + (e.user && e.user.getEmail && e.user.getEmail() ? ' ' + e.user.getEmail() : '');
    var multi = e.range.getNumRows() * e.range.getNumColumns() > 1;
    // 회원 탭은 개인정보가 섞일 수 있어 값은 남기지 않고 '어느 칸이 바뀌었는지'만 기록
    var hide = name === '회원' || multi;
    audit_({ userId: '', name: who, role: '' }, '시트 직접 편집', name + '!' + e.range.getA1Notation(),
      hide ? '' : (e.oldValue === undefined ? '' : e.oldValue), hide ? '' : (e.value === undefined ? '' : e.value),
      multi ? '여러 칸 동시 편집' : '');
  } catch (err) { Logger.log('officeOnEdit 오류: ' + err); }
}

// ── 설치 (에디터에서 1회 실행. 여러 번 실행해도 안전) ─────────
function setupOffice() {
  if (!officeMode_()) throw new Error('이 클럽은 임원방 모드가 아닙니다(Club.js CLUB.accessControl).');
  var p = props_(), id = p.getProperty('SHEET_ID'), ss, folderId = p.getProperty('DRIVE_FOLDER_ID');
  if (folderId) setupDriveFolders();
  if (id) { ss = SpreadsheetApp.openById(id); }
  else {
    ss = SpreadsheetApp.create(CLUB.dataSheetName);
    p.setProperty('SHEET_ID', ss.getId());
  }
  // 데이터시트를 '99_봇데이터' 폴더로(이미 그 안이면 그대로). 폴더를 만든 직후엔 검색에 안 잡힐 수 있어
  // 최초 실행 땐 최상위에 놓일 수 있다 → 다시 실행하면 제자리로 들어간다(멱등).
  if (folderId) {
    try {
      var rootF = DriveApp.getFolderById(folderId), sub = rootF.getFoldersByName('99_봇데이터');
      var dest = sub.hasNext() ? sub.next() : rootF, file = DriveApp.getFileById(ss.getId()), parents = file.getParents();
      if (!parents.hasNext() || parents.next().getId() !== dest.getId()) file.moveTo(dest);
    } catch (e) { Logger.log('데이터시트 폴더 이동 실패(무시 가능): ' + e); }
  }
  getOrCreateSheet_(ss, SETTINGS_SHEET, SETTINGS_HEADERS);
  getOrCreateSheet_(ss, AUTH_SHEET, AUTH_HEADERS);
  getOrCreateSheet_(ss, ROOMS_SHEET, ROOMS_HEADERS);
  OFFICE_TABS.forEach(function (t) { getOrCreateSheet_(ss, t[0], t[1]); });
  var logSh = getOrCreateSheet_(ss, AUDIT_SHEET, AUDIT_HEADERS);
  var added = seedSettings_();

  var board = ss.getSheetByName('임원');
  if (board.getLastRow() < 2) {
    board.getRange(2, 1, OFFICE_BOARD_SEATS.length, 4).setValues(OFFICE_BOARD_SEATS.map(function (s) { return [s[0], s[1], '', '미정']; }));
  }
  var def = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  // 로그 탭은 봇(=스크립트 소유자)만 쓰도록 보호
  try {
    if (!logSh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
      var pr = logSh.protect().setDescription('로그 — 추가 전용(봇만 기록)');
      pr.removeEditors(pr.getEditors());
      if (pr.canDomainEdit()) pr.setDomainEdit(false);
    }
  } catch (e) { Logger.log('로그 탭 보호 실패(무시 가능): ' + e); }

  // 트리거: 일일 작업 + 시트 직접 편집 기록
  createDailyTrigger_();
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'officeOnEdit'; });
  if (!has) ScriptApp.newTrigger('officeOnEdit').forSpreadsheet(ss).onEdit().create();

  audit_({ userId: '', name: '(setupOffice)', role: '' }, '설치', CLUB.short, '', '탭 ' + ss.getSheets().length + '개 · 설정 키 추가 ' + added + '개', '');
  Logger.log('✅ setupOffice 완료\n  시트 = ' + ss.getUrl());
  return ss.getUrl();
}

/**
 * 웹훅 비밀값 생성(에디터에서 1회). 이 값을 Cloudflare Worker 의 TG_SECRET 변수에 그대로 넣는다.
 * 텔레그램→Worker 는 비밀 헤더로, Worker→GAS 는 ?k= 로 확인 → 주소를 아는 제3자가 가짜 명령을 넣을 수 없다.
 */
function genWebhookSecret() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', s = '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + new Date().getTime());
  for (var i = 0; i < bytes.length; i++) s += chars.charAt((bytes[i] + 256) % chars.length);
  props_().setProperty('WEBHOOK_SECRET', s);
  Logger.log('WEBHOOK_SECRET (Cloudflare Worker 의 TG_SECRET 에 넣으세요):\n' + s);
  return s;
}

/**
 * 한 번에 설치: 폴더·데이터시트·트리거(setupOffice) + (WEBHOOK_URL·WEBHOOK_SECRET 속성이 있으면) 텔레그램 연결.
 * 에디터에서 이 함수 하나만 실행하면 된다. 여러 번 실행해도 안전.
 */
function installAll() {
  var out = ['시트: ' + setupOffice()];
  if (getProp_('WEBHOOK_URL', false) && getProp_('WEBHOOK_SECRET', false)) {
    var r = setWebhook();
    out.push('웹훅: ' + (r && r.ok ? '연결됨' : '실패 ' + JSON.stringify(r)));
    var c = setOfficeCommands();
    out.push('명령 메뉴: ' + (c && c.ok ? '등록됨' : '실패 ' + JSON.stringify(c)));
  } else {
    out.push('웹훅: WEBHOOK_URL / WEBHOOK_SECRET 속성이 없어 연결 생략');
  }
  Logger.log('✅ installAll\n  ' + out.join('\n  '));
  return out.join('\n');
}

function setOfficeCommands() {
  return tgApi_('setMyCommands', { commands: [
    { command: 'help', description: '도움말' }, { command: 'save', description: '파일 보관 방법(드라이브 자동 저장)' }, { command: 'form', description: '예비회원 추천 양식' }, { command: 'recruit', description: '창립회원 모집 현황' },
    { command: 'recruitlist', description: '예비회원 명단(상태별)' }, { command: 'guide', description: '이 방 사용 설명서' }, { command: 'whoami', description: '내 등록 정보' }, { command: 'setroom', description: '(관리자) 이 방 등록: 회장단·임원·동호회' },
    { command: 'id', description: '대화방·본인 ID' }
  ] });
}

// ── 원격 실행(clasp run) 점검용 — 비밀값은 반환하지 않고 '설정 여부'만 알려준다 ──
function remotePing() {
  var has = function (k) { return !!getProp_(k, false); };
  return {
    club: CLUB.short, officeMode: officeMode_(), time: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'),
    set: { BOT_TOKEN: has('BOT_TOKEN'), ADMIN_IDS: has('ADMIN_IDS'), SHEET_ID: has('SHEET_ID'), DRIVE_FOLDER_ID: has('DRIVE_FOLDER_ID'),
      WEBHOOK_URL: has('WEBHOOK_URL'), WEBHOOK_SECRET: has('WEBHOOK_SECRET'), OFFICER_CHAT_ID: has('OFFICER_CHAT_ID'), RECRUIT_SHEET_ID: has('RECRUIT_SHEET_ID') },
    triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); })
  };
}

/** /set 키 값 — 설정 탭의 값을 텔레그램에서 변경(관리자). 값은 문자로 저장해 시트가 날짜·숫자로 멋대로 바꾸지 않게 한다 */
function officeCmdSet_(chat, user, text) {
  var args = String(text || '').replace(/^\/\S+\s*/, '').trim().split(/\s+/), key = args.shift() || '', value = args.join(' ');
  if (!key) { tgSend_(chat.id, '사용법: <code>/set 키 값</code>\n예) <code>/set 창립일 2026-10-14</code> · <code>/set 정기모임_요일 화</code> · 비우기: <code>/set 입회비 없음</code>\n키 목록은 /settings'); return; }
  try { seedSettings_(); } catch (e) {}
  var sh = getOrCreateSheet_(getSS_(), SETTINGS_SHEET, SETTINGS_HEADERS), plan = settingsSetPlan_(sh.getDataRange().getValues(), key, value);
  if (plan.error) { tgSend_(chat.id, '⚠️ ' + escapeHtml_(plan.error) + (plan.suggest && plan.suggest.length ? '\n혹시: ' + plan.suggest.map(function (s) { return '<code>' + escapeHtml_(s) + '</code>'; }).join(' · ') : '')); return; }
  if (plan.before === plan.value) { tgSend_(chat.id, '➖ ' + escapeHtml_(key) + ': 이미 ' + escapeHtml_(plan.value || '(미정)')); return; }
  if (plan.row) sh.getRange(plan.row, 2).setNumberFormat('@').setValue(plan.value);
  else sh.appendRow([key, plan.value, '']);
  invalidateSettings_();
  audit_(user, '설정 변경', key, plan.before, plan.value, '');
  var extra = '';
  if (key === '창립일' && plan.value) { var d = recruitDayDiff_(todayStr_(), plan.value); extra = '\n🗓 창립행사까지 <b>' + (d > 0 ? 'D-' + d : d === 0 ? 'D-DAY' : 'D+' + (-d)) + '</b>'; }
  tgSend_(chat.id, '✅ <b>' + escapeHtml_(key) + '</b>: ' + escapeHtml_(plan.before || '(미정)') + ' → <b>' + escapeHtml_(plan.value || '(미정)') + '</b>' + extra);
}

// ── 오류 기록: '오류' 탭에 남겨 개발자가 시트만 읽고 원인을 찾을 수 있게 한다(개인정보·메시지 본문은 남기지 않음) ──
var ERRORS_SHEET = '오류', ERRORS_HEADERS = ['시각', '무엇을 하다가', '오류', '위치(stack)', 'user_id', '방 유형'];
/** 업데이트에서 '무엇을 하다가'만 요약(순수): 명령어 이름·버튼 종류·파일 여부. 본문·캡션·이름은 버린다 */
function officeErrorContext_(update) {
  var m = update && update.message, cq = update && update.callback_query;
  if (cq) return { what: '버튼 ' + String(cq.data || '').split('|')[0].split(':')[0], uid: cq.from && cq.from.id, chat: cq.message && cq.message.chat };
  if (!m) return { what: '(알 수 없음)', uid: '', chat: null };
  var t = String(m.text || m.caption || '').trim(), what = t.charAt(0) === '/' ? '명령 ' + t.split(/\s+/)[0].split('@')[0] : (docsPickFile_(m) ? '파일' : (intakeLooksLikeForm_(t) ? '추천 양식' : '글'));
  return { what: what + (m.reply_to_message ? ' (답장)' : ''), uid: m.from && m.from.id, chat: m.chat };
}
function officeLogError_(err, update) {
  try {
    var c = officeErrorContext_(update), roomType = '';
    try { roomType = !c.chat ? '' : (c.chat.type === 'private' ? '1:1' : ((roomFind_(rooms_(), c.chat.id) || {}).type || '미등록 방')); } catch (e) {}
    getOrCreateSheet_(getSS_(), ERRORS_SHEET, ERRORS_HEADERS).appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), c.what,
      String(err && err.message || err).slice(0, 500), String(err && err.stack || '').slice(0, 800), String(c.uid || ''), roomType]);
  } catch (e2) { Logger.log('오류 기록 실패: ' + e2); }
}
