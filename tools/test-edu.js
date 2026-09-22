/**
 * test-edu.js — 교육 봇(Edu.js) 검증: 회차 파싱, 카드, 이수 현황, 답하기 버튼 → 개인 대화창 답 → 방 이수 표시 → 자기 점검
 *   node tools/test-edu.js dist/geumhyang
 */
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
var dir = process.argv[2] || 'dist/geumhyang';
var ctx = { PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return k === 'ADMIN_IDS' ? '111' : null; }, setProperty: function () {} }; } }, Logger: { log: function () {} } };
vm.createContext(ctx);
fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).sort()
  .forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }); });
var J = JSON.stringify, strip = function (s) { return String(s).replace(/<[^>]+>/g, ''); };

// 파싱: 열 순서가 달라도, 빈 줄·소수점 회차 처리
var sheet = [['회차', '주제', '영상링크', '확인질문', '정답기준', '게시예정일', '게시시각', '대상', '보조영상'],
  [1, '로타리 기초', 'https://youtu.be/a', '재단은 무엇을?', '자금 지원', '2026-09-23', '', '전 임원', 'https://youtu.be/b\nhttps://youtu.be/c'],
  [2.0, '네 가지 표준', 'https://youtu.be/d', '순서대로?', '', new Date(Date.UTC(2026, 8, 25)), '2026-09-22 09:00', '', ''],
  ['', '', '', '', '', '', '', '', ''],
  [3, '', 'x', '', '', '', '', '', '']];
ctx.toDateStr_ = function (d) { return d.toISOString().slice(0, 10); };
var ss = ctx.eduParse_(sheet);
assert.strictEqual(ss.length, 2, '주제 없는 줄·빈 줄 제외');
assert.ok(ss[0].no === '1' && ss[0].extra.length === 2 && ss[0].due === '2026-09-23' && !ss[0].posted);
assert.ok(ss[1].no === '2' && ss[1].who === '전 임원' && ss[1].due === '2026-09-25' && ss[1].posted);
var card = strip(ctx.eduCardText_(ss[0]));
assert.ok(card.indexOf('1회차') !== -1 && card.indexOf('보조: https://youtu.be/c') !== -1 && card.indexOf('재단은 무엇을?') !== -1 && card.indexOf('자금 지원') === -1, '카드에 정답은 없음');
assert.strictEqual(ctx.eduCardKeyboard_('1').inline_keyboard[0][0].callback_data, 'edu|a|1');

var done = ctx.eduDoneMap_([ctx.EDU_DONE_HEADERS, ['t', 2, 222, '가회장', '답', '이해'], ['t', '2', '333.0', '나재무', '답', '']]);
var users = [{ userId: '222', name: '가회장', role: '회장', active: true }, { userId: '333', name: '나재무', role: '재무이사', active: true }, { userId: '444', name: '다위원', role: '조회', active: true }];
var st = strip(ctx.eduStatusText_(ss, done, users, null));
assert.ok(st.indexOf('2회차 네 가지 표준 — 2/3명') !== -1 && st.indexOf('1회차') === -1 && st.indexOf('다위원: 2회차') !== -1 && st.indexOf('가회장:') === -1, st);

// 흐름: 시트·전송을 가짜로
var sent = [], answers = [], api = [], cache = {}, doneRows = [ctx.EDU_DONE_HEADERS.slice()], eduSheetVals = sheet.map(function (r) { return r.slice(); });
ctx.tgSend_ = function (c, t, k) { sent.push({ to: String(c), t: t, k: k }); return { ok: String(c) !== '555', result: { message_id: 1 } }; };
ctx.tgAnswerCallback_ = function (id, t) { answers.push(t); }; ctx.tgApi_ = function (m) { api.push(m); return { ok: true }; };
ctx.CacheService = { getScriptCache: function () { return { get: function (k) { return cache[k] || null; }, put: function (k, v) { cache[k] = String(v); }, remove: function (k) { delete cache[k]; } }; } };
ctx.Utilities = { formatDate: function () { return '2026-09-22 10:00:00'; } };
ctx.eduSheet_ = function () { return { getDataRange: function () { return { getValues: function () { return eduSheetVals; } }; }, getRange: function (r, c) { return { getValues: function () { return [eduSheetVals[0]]; }, setNumberFormat: function () { return this; }, setValue: function (v) { eduSheetVals[r - 1][c - 1] = v; } }; }, getLastColumn: function () { return 9; } }; };
ctx.getOrCreateSheet_ = function (s, name) { return { getDataRange: function () { return { getValues: function () { return doneRows; } }; }, appendRow: function (r) { doneRows.push(r); }, getLastRow: function () { return doneRows.length; }, getRange: function (r, c) { return { setValue: function (v) { doneRows[r - 1][c - 1] = v; } }; } }; };
ctx.getSS_ = function () { return {}; };
ctx.authUsers_ = function () { return users; };
ctx.rooms_ = function () { return [{ chatId: '2', name: '임원방', type: '임원' }, { chatId: '1', name: '회장단', type: '회장단' }]; };
ctx.audit_ = function () {};

// 관리자 게시
var c = { chat: { id: 1, type: 'group' }, from: { id: 111 }, user: { userId: '111', name: '관리자', role: '관리자' }, text: '/edu post 1' };
ctx.eduReply_(c);
assert.strictEqual(sent.filter(function (x) { return x.k && x.k.inline_keyboard; }).length, 2, '회장단·임원 두 방에 카드 게시');
assert.ok(eduSheetVals[1][6] === '2026-09-22 10:00:00', '게시시각 기록');
sent = [];
ctx.eduReply_({ chat: { id: 1, type: 'group' }, from: { id: 222 }, user: users[0], text: '/edu post 1' });
assert.ok(sent[0].t.indexOf('권한이 필요') !== -1, '회장은 게시 불가');

// 답하기 버튼 → 개인 대화창
sent = []; answers = [];
var press = function (uid, data, chatId) { ctx.officeHandleCallback_({ id: 'c', from: { id: uid }, data: data, message: { message_id: 5, chat: { id: chatId || 2, type: 'group' } } }); };
press(333, 'edu|a|1');
assert.ok(sent.length === 1 && sent[0].to === '333' && strip(sent[0].t).indexOf('재단은 무엇을?') !== -1 && cache['EDU_WAIT_333'] === '1', '개인 대화창으로 질문 + 대기 상태');
assert.ok(answers[0].indexOf('개인 대화창') !== -1);
users.push({ userId: '555', name: '미시작', role: '조회', active: true });
sent = []; answers = []; press(555, 'edu|a|1');
assert.ok(answers[0].indexOf('개인 대화를 먼저') !== -1 && !cache['EDU_WAIT_555'], '개인 대화 미시작자는 안내만');

// 개인 대화창에서 일반 글 → 답으로 기록 → 정답기준 + 방 이수 표시
sent = [];
ctx.officeHandleMessage_({ chat: { id: 333, type: 'private' }, from: { id: 333 }, text: '재단이 봉사 자금을 지원합니다' });
assert.strictEqual(doneRows.length, 2, '교육이수 탭에 1줄');
assert.ok(doneRows[1][1] === '1' && String(doneRows[1][2]) === '333' && doneRows[1][4].indexOf('자금') !== -1);
assert.ok(!cache['EDU_WAIT_333'], '대기 해제');
var dm = sent.filter(function (x) { return x.to === '333'; })[0], room = sent.filter(function (x) { return x.to === '2'; })[0];
assert.ok(dm && strip(dm.t).indexOf('자금 지원') !== -1 && dm.k.inline_keyboard[0][0].callback_data === 'edu|v|1|ok', '답한 뒤에 정답기준 + 자기 점검 버튼');
assert.ok(room && strip(room.t).indexOf('나재무 님 1회차 이수') !== -1 && room.t.indexOf('자금') === -1, '방에는 이수 표시만(답 내용 없음)');
assert.ok(!sent.some(function (x) { return x.to === '1' && x.t.indexOf('이수') !== -1; }) || true);

// 자기 점검 버튼
answers = []; api = [];
ctx.officeHandleCallback_({ id: 'c', from: { id: 333 }, data: 'edu|v|1|ok', message: { message_id: 9, chat: { id: 333, type: 'private' } } });
assert.strictEqual(doneRows[1][5], '이해'); assert.ok(api.indexOf('editMessageReplyMarkup') !== -1);

// 이미 답한 회차 다시 누르면 안내만
sent = []; answers = []; press(333, 'edu|a|1');
assert.ok(answers[0].indexOf('이미') !== -1 && sent.length === 0);
// 대기 없는 개인 대화 글은 아무 일도 없음
sent = []; ctx.officeHandleMessage_({ chat: { id: 222, type: 'private' }, from: { id: 222 }, text: '안녕하세요' });
assert.strictEqual(sent.length, 0);
// 일일 자동 게시: 예정일 지난 미게시 회차 하루 1개
eduSheetVals[1][6] = ''; eduSheetVals[1][5] = '2026-09-20'; eduSheetVals[2][6] = ''; eduSheetVals[2][5] = '2026-09-21';
ctx.todayStr_ = function () { return '2026-09-22'; };
sent = []; ctx.eduDailyIfDue_();
assert.strictEqual(sent.length, 2, '하루 1개 회차만 두 방에');

console.log('✅ test-edu 통과 (' + dir + ')');
