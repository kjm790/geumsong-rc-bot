/**
 * test-office.js — 설정·권한·로그·임원방 라우터 검증 (가짜 데이터)
 *   node tools/test-office.js dist/geumhyang
 */
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
var dir = process.argv[2] || 'dist/geumhyang';
var PROPS = { ADMIN_IDS: '111' };
var ctx = {
  PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return PROPS[k] === undefined ? null : PROPS[k]; }, setProperty: function (k, v) { PROPS[k] = v; } }; } },
  Logger: { log: function () {} }
};
vm.createContext(ctx);
fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).sort()
  .forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }); });
var J = JSON.stringify;

// ── 설정
var map = ctx.settingsParse_([['키', '값', '설명'], ['창립일', '2026-__-__', ''], ['연회비', '300,000', ''], ['주회식대', '12만', ''], ['FINANCE_LIVE', 'FALSE', ''], ['창립회기_일할', '', ''], [' 목표인원 ', 20, '']]);
assert.strictEqual(ctx.settingDateOf_(map['창립일']), '', "자리표시 '2026-__-__' 는 미정");
assert.strictEqual(ctx.settingDateOf_('2026.10.26'), '2026-10-26');
assert.strictEqual(ctx.settingDateOf_('2026-13-40'), '');
assert.strictEqual(ctx.settingNumOf_(map['연회비'], 0), 300000);
assert.strictEqual(ctx.settingNumOf_(map['주회식대'], 0), 120000);
assert.strictEqual(ctx.settingNumOf_('', 7), 7);
assert.strictEqual(ctx.settingBoolOf_(map['FINANCE_LIVE'], true), false);
assert.strictEqual(ctx.settingBoolOf_(map['창립회기_일할'], null), null, '미정은 기본값(null) 그대로 — 추측하지 않음');
assert.strictEqual(map['목표인원'], 20, '키 앞뒤 공백 정리');
assert.ok(ctx.settingsBlankKeys_(map).indexOf('창립일') === -1 && ctx.settingsBlankKeys_(map).indexOf('입회비') !== -1);
var st = ctx.officeSettingsText_(map);
assert.ok(st.indexOf('테스트 모드') !== -1 && st.indexOf('미정') !== -1);

// ── 권한
var users = ctx.authParse_([
  ['번호', '성명', '직책', '연락처', 'user_id', '권한', '상태'],
  [1, '가회장', '회장', '010-0000-0000', 222, '회장', ''],
  [2, '나재무', '재무이사', '010-0000-0001', '333.0', '재무이사', ''],
  [3, '다총무', '총무이사', '', '444', '총무이사', '정지'],
  [4, '라참관', '추진위원장', '', '555', '참관', ''],
  [5, '마해커', '', '', '666', '슈퍼관리자', ''],      // 표에 없는 권한 이름
  [6, '바미등록', '부회장', '', '', '부회장', '']
]);
assert.strictEqual(users.length, 4);
assert.ok(!J(users).match(/010-/), '연락처 열은 읽지 않음');
var R = function (id) { return ctx.authResolve_(users, ['111'], id); };
assert.strictEqual(R(111).role, '관리자'); assert.strictEqual(R(222).role, '회장'); assert.strictEqual(R('333').role, '재무이사');
assert.strictEqual(R(444), null, '정지'); assert.strictEqual(R(666), null, '없는 권한명'); assert.strictEqual(R(999), null, '미등록');
var can = ctx.can_;
assert.ok(can(R(111), 'expense.approve') && can(R(111), '*'));
assert.ok(can(R(222), 'expense.approve') && !can(R(222), 'expense.draft') && !can(R(222), 'expense.execute'), '회장은 승인만');
assert.ok(can(R(333), 'expense.draft') && can(R(333), 'expense.execute') && !can(R(333), 'expense.approve'), '재무는 기안·집행만(승인 불가)');
assert.ok(can(R(555), 'view') && !can(R(555), 'finance.view'), '참관은 재무 조회 불가');
assert.ok(!can(null, 'view'));

// ── 로그
var row = ctx.auditRow_('2026-09-19 10:00:00', R(222), '지출 승인', 'E-001', '대기', '승인', '');
assert.strictEqual(J(row), J(['2026-09-19 10:00:00', '222', '가회장', '회장', '지출 승인', 'E-001', '대기', '승인', '']));
var tail = ctx.auditTailLines_([ctx.AUDIT_HEADERS, row, ctx.auditRow_('t2', null, '설치', '<x>', '', '', '')], 10);
assert.ok(tail.length === 2 && tail[0].indexOf('&lt;x&gt;') !== -1 && tail[1].indexOf('대기 → 승인') !== -1, '최신순 + 이스케이프');

// ── 라우터: 미등록 무시, /id 예외, 권한 검사
var sent = [];
ctx.tgSend_ = function (c, t) { sent.push(t); return { ok: true }; };
ctx.authUsers_ = function () { return users; };
ctx.recruitReply_ = function (c, mode) { sent.push('RECRUIT:' + mode); };
var ROOMS = [{ chatId: '1', name: '회장단방', type: '회장단' }, { chatId: '2', name: '임원방', type: '임원' }, { chatId: '3', name: '문화레저', type: '동호회' }];
ctx.rooms_ = function () { return ROOMS; };
// 방 번호: 1=회장단 2=임원 3=동호회 9=미등록 그룹 0=1:1
var sayIn = function (room, uid, text) { sent = []; ctx.officeHandleMessage_({ chat: room === 0 ? { id: uid, type: 'private' } : { id: room, type: 'group', title: 't' }, from: { id: uid }, text: text }); return sent; };
var say = function (uid, text) { return sayIn(1, uid, text); };
assert.strictEqual(say(999, '/help').length, 0, '미등록 → 무시');
assert.strictEqual(say(999, '/recruit').length, 0);
assert.strictEqual(say(444, '/help').length, 0, '정지 → 무시');
assert.ok(say(999, '/id')[0].indexOf('999') !== -1, '/id 는 누구나');
assert.ok(say(222, '/help@geumhyang_office_bot')[0].indexOf('가회장') !== -1);
assert.strictEqual(say(222, '/모집현황')[0], 'RECRUIT:summary');
assert.ok(say(222, '/recruitcheck')[0].indexOf('권한이 필요') !== -1, '회장은 관리자 명령 불가');
assert.strictEqual(say(111, '/recruitcheck')[0], 'RECRUIT:check');
assert.ok(say(555, '/회비현황')[0].indexOf('권한이 필요') !== -1, '참관은 재무 조회 불가');
assert.ok(say(222, '/회비현황')[0].indexOf('3단계') !== -1);
assert.strictEqual(say(222, '그냥 대화').length, 0);
assert.strictEqual(say(222, '/납부 홍길동 100').length, 0, '구 재무 명령은 임원방 모드에서 닫힘');

// ── 방별 기능: 같은 사람·같은 명령이라도 방에 따라 다르다
assert.strictEqual(sayIn(2, 222, '/recruit')[0], 'RECRUIT:summary', '임원방: 모집 현황(숫자)은 가능');
assert.ok(sayIn(2, 222, '/recruitlist')[0].indexOf('이 방에서는 쓸 수 없습니다') !== -1 && sent[0].indexOf('회장단방') !== -1, '임원방: 이름 명단은 불가 + 어느 방에서 되는지 안내');
assert.ok(sayIn(3, 222, '/recruit')[0].indexOf('이 방에서는') !== -1, '동호회방: 모집 현황 불가');
assert.strictEqual(sayIn(0, 222, '/recruitlist')[0], 'RECRUIT:list', '1:1 은 방 제한 없음');
assert.strictEqual(sayIn(9, 222, '/recruit').length, 0, '미등록 방에서는 조용히');
assert.strictEqual(sayIn(9, 222, '/help').length, 0);
assert.ok(sayIn(9, 999, '/id').length === 1, '미등록 방에서도 /id 는 가능');
var setroomCalls = []; ctx.officeCmdSetRoom_ = function (c, u, t) { setroomCalls.push(t); };
sayIn(9, 222, '/setroom 임원'); assert.strictEqual(setroomCalls.length, 0, '회장은 방 등록 불가'); assert.ok(sent[0].indexOf('권한이 필요') !== -1);
sayIn(9, 111, '/setroom 임원'); assert.strictEqual(setroomCalls.length, 1, '관리자는 미등록 방에서도 /setroom 가능');
var h1 = sayIn(1, 222, '/help')[0], h2 = sayIn(2, 222, '/help')[0], h3 = sayIn(3, 222, '/help')[0], hA = sayIn(1, 111, '/help')[0];
assert.ok(h1.indexOf('/recruitlist') !== -1 && h1.indexOf('/form') !== -1 && h1.indexOf('/settings') === -1, '회장단방 도움말(회장)');
assert.ok(h2.indexOf('/recruit ') !== -1 && h2.indexOf('/recruitlist') === -1 && h2.indexOf('/form') === -1, '임원방 도움말엔 명단·양식 없음');
assert.ok(h3.indexOf('/recruit') === -1 && h3.indexOf('/schedule') !== -1, '동호회방 도움말은 일정만');
assert.ok(hA.indexOf('/settings') !== -1 && hA.indexOf('/setroom') !== -1, '관리자 도움말');
var parsedRooms = ctx.roomsParse_([ctx.ROOMS_HEADERS, ['-100123', '회장단', '회장단', '', ''], [-5001.0, '임원', '임원', '', ''], ['-7', 'x', '없는유형', '', ''], ['abc', 'y', '임원', '', '']]);
assert.strictEqual(J(parsedRooms.map(function (r) { return r.chatId + ':' + r.type; })), J(['-100123:회장단', '-5001:임원']));

// ── 버튼: 방 유형·사용자 권한 선택은 관리자만
var reg = [], add = [], answers = [];
ctx.roomRegister_ = function (c, u, t) { reg.push(t); }; ctx.officeAddUserApply_ = function (c, u, uid, n, r) { add.push(uid + ':' + r + ':' + n); };
ctx.tgAnswerCallback_ = function (id, t) { answers.push(t); }; ctx.tgApi_ = function () { return { ok: true }; };
ctx.CacheService = { getScriptCache: function () { return { get: function (k) { return k === 'AU_NAME_777' ? '새 임원' : null; }, put: function () {} }; } };
var press = function (uid, data) { ctx.officeHandleCallback_({ id: 'c', from: { id: uid }, data: data, message: { message_id: 5, chat: { id: 9, type: 'group', title: '새 방' } } }); };
press(222, 'room:회장단'); assert.strictEqual(reg.length, 0, '회장이 눌러도 방 등록 안 됨');
press(999, 'room:회장단'); assert.strictEqual(reg.length, 0, '미등록자가 눌러도 안 됨');
press(111, 'room:없는유형'); assert.strictEqual(reg.length, 0);
press(111, 'room:회장단'); assert.strictEqual(J(reg), J(['회장단']));
press(222, 'au:777:회장'); assert.strictEqual(add.length, 0);
press(111, 'au:777:관리자'); assert.strictEqual(add.length, 0, '버튼으로 관리자 권한은 못 줌');
press(111, 'au:777:회장'); assert.strictEqual(J(add), J(['777:회장:새 임원']));

// ── 이름 오타 제안 버튼: 명단 수정 권한자가, 접수가 열린 방에서만
var ahoCalls = [], stCalls = [];
ctx.recruitSetAhoReply_ = function (c, u, t) { ahoCalls.push(t); }; ctx.recruitSetStatusReply_ = function (c, u, t, s) { stCalls.push(t + '=' + s); };
var pressIn = function (room, uid, data) { ctx.officeHandleCallback_({ id: 'c', from: { id: uid }, data: data, message: { message_id: 5, chat: { id: room, type: 'group' } } }); };
pressIn(1, 555, 'aho|한소연|다솜'); assert.strictEqual(ahoCalls.length, 0, '참관은 불가');
pressIn(2, 222, 'aho|한소연|다솜'); assert.strictEqual(ahoCalls.length, 0, '임원방에서는 불가');
pressIn(1, 222, 'aho|한소연|다솜'); assert.strictEqual(J(ahoCalls), J(['/아호 한소연 다솜']));
pressIn(1, 222, 'st|한소연|해킹'); assert.strictEqual(stCalls.length, 0, '목록 밖 상태값 거부');
pressIn(1, 222, 'st|한소연|확약'); assert.strictEqual(J(stCalls), J(['/확약 한소연=확약']));

// ── /set 계획 · 오류 요약
var SV = [['키', '값', '설명'], ['창립일', '', ''], ['목표인원', 20, '']];
assert.strictEqual(J(ctx.settingsSetPlan_(SV, '창립일', '2026.10.14')), J({ row: 2, before: '', value: '2026-10-14' }));
assert.ok(/날짜는/.test(ctx.settingsSetPlan_(SV, '창립일', '시월 십사일').error));
assert.strictEqual(ctx.settingsSetPlan_(SV, '목표인원', '25').before, '20');
assert.strictEqual(ctx.settingsSetPlan_(SV, '입회비', '없음').value, '', "'없음' → 비움, 시트에 없는 키는 row 0(새 줄)");
var bad = ctx.settingsSetPlan_(SV, '창립', 'x');
assert.ok(bad.error && bad.suggest.indexOf('창립일') !== -1, '없는 키는 거부 + 비슷한 키 제안');
var ec = ctx.officeErrorContext_({ message: { text: '/recruit@bot 홍길동 010-0000-0000', from: { id: 7 }, chat: { id: 1, type: 'group' } } });
assert.ok(ec.what === '명령 /recruit' && !J(ec).match(/홍길동|010/), '오류 기록에 본문·이름·연락처는 남기지 않음');
assert.strictEqual(ctx.officeErrorContext_({ callback_query: { data: 'doc|abc|1', from: { id: 7 }, message: { chat: { id: 1 } } } }).what, '버튼 doc');

// ── 드라이브 주소 → 파일 ID
var FID = '1aBcDeFgHiJkLmNoPqRsTuVwXyZ_0123-45';
assert.strictEqual(ctx.driveIdFromText_('https://drive.google.com/file/d/' + FID + '/view?usp=drivesdk'), FID);
assert.strictEqual(ctx.driveIdFromText_('https://docs.google.com/spreadsheets/d/' + FID + '/edit#gid=0'), FID);
assert.strictEqual(ctx.driveIdFromText_('https://drive.google.com/open?id=' + FID), FID);
assert.strictEqual(ctx.driveIdFromText_(' ' + FID + ' '), FID);
assert.strictEqual(ctx.driveIdFromText_('명단'), '');
var linked = []; ctx.recruitLinkReply_ = function (c, u, t) { linked.push(t); };
say(222, '/linkroster ' + FID); assert.strictEqual(linked.length, 0, '회장은 명단 연결 불가');
say(111, '/linkroster ' + FID); assert.strictEqual(linked.length, 1);

// ── 웹훅 비밀값: 속성이 있으면 ?k 불일치 요청은 처리 안 함
var handled = 0; ctx.handleUpdate_ = function () { handled++; };
ctx.ContentService = { createTextOutput: function (t) { return t; } };
var post = function (k) { ctx.doPost({ parameter: k === null ? {} : { k: k }, postData: { contents: '{"update_id":1}' } }); };
post(null); assert.strictEqual(handled, 1, '비밀값 미설정 클럽은 기존대로 처리');
PROPS.WEBHOOK_SECRET = 'S3cret'; post(null); post('wrong'); assert.strictEqual(handled, 1, '불일치 → 버림');
post('S3cret'); assert.strictEqual(handled, 2);

console.log('✅ test-office 통과 (' + dir + ')');
