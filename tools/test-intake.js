/**
 * test-intake.js — 예비회원 추천 양식 인식·기재 계획 검증 (가짜 데이터)
 *   node tools/test-intake.js dist/geumhyang
 */
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
var dir = process.argv[2] || 'dist/geumhyang';
var ctx = { PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return null; }, setProperty: function () {} }; } }, Logger: { log: function () {} } };
vm.createContext(ctx);
fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).sort()
  .forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }); });
var J = JSON.stringify;

var blank = ctx.intakeFormText_();
assert.ok(ctx.intakeLooksLikeForm_(blank), '빈 양식도 양식으로는 인식');
assert.strictEqual(ctx.intakeParse_(blank).length, 0, '빈 양식은 기재 대상 0명');
assert.ok(!ctx.intakeLooksLikeForm_('오늘 회의 몇 시죠?\n장소 : 미정'));
assert.ok(!ctx.intakeLooksLikeForm_('성명 : 홍길동'), '항목 3개 미만은 양식 아님');

var filled = '■ 금향 예비회원 추천 양식\n(1명당 아래 내용을 복사해서 옆에 적어 주세요)\n\n' +
  '1. 성명 : 홍 길순\n2. 성별 : 여성\n3. 생년월일(예 1992-03-05) : 82.3.5\n4. 직업(업종) : 요식업\n5. 회사명 / 직위 : 가짜식당 / 대표\n6. 추천인 : 가나다\n' +
  '7. 연락처 : 01012345678\n8. 이메일 : fake@example.com\n9. 영문명(여권 표기) : hong gil soon\n10. 사업장 주소 : 대구 가짜구 가짜로 1\n11. 자택 주소 : -\n12. 아호(있으면) : 없음\n13. 비고(특이사항) : 10월 초 확답 예정\n\n' +
  '1. 성명：김둘째\n2. 성별： 여\n3. 생년월일： 1979\n4. 직업(업종)： 교육\n7. 연락처： 010-2222-3333\n주소 : 대구 가짜구 집길 2\n10. 아호(있으면)： 청향\n';
var ps = ctx.intakeParse_(filled);
assert.strictEqual(ps.length, 2, '한 메시지에 2명');
assert.strictEqual(J([ps[0].name, ps[0].gender, ps[0].birth, ps[0].phone, ps[0].eng, ps[0].aho]), J(['홍길순', '여', '1982', '010-1234-5678', 'HONG GIL SOON', '']));
assert.strictEqual(ps[0].birthDate, '1982-03-05', '두 자리 연도 생년월일');
assert.strictEqual(J([ps[0].addrWork, ps[0].addrHome, ps[1].addrWork, ps[1].addrHome]), J(['대구 가짜구 가짜로 1', '', '', '대구 가짜구 집길 2']), "주소: '-'는 빈 값, '주소'만 적으면 자택");
assert.strictEqual(ctx.intakeLabelKey_('회사 주소'), 'addrWork', "'회사 주소'는 회사명이 아니라 사업장 주소");
assert.strictEqual(ps[1].birthDate, '', '연도만 적으면 생년월일은 비움');
[['1992-03-05', '1992', '1992-03-05'], ['1992.3.5', '1992', '1992-03-05'], ['1992년 3월 5일', '1992', '1992-03-05'], ['19920305', '1992', '1992-03-05'], ['920305', '1992', '1992-03-05'],
 ['1992', '1992', ''], ['82년생', '1982', ''], ['1992-13-05', '1992', ''], ['', '', ''], ['-', '', '']].forEach(function (c) {
  var b = ctx.intakeBirth_(c[0]); assert.strictEqual(J([b.year, b.date]), J([c[1], c[2]]), '생년월일 해석: ' + c[0]);
});
assert.strictEqual(J([ps[1].name, ps[1].birth, ps[1].aho, ps[1].phone]), J(['김둘째', '1979', '청향', '010-2222-3333']), '전각 콜론(：)도 인식');
assert.strictEqual(ctx.intakeMaskPhone_('010-1234-5678'), '010-****-5678');

// 실제 시트와 같은 모양: 안내 줄 + 6행 제목 + 번호만 있는 빈 자리
var H = ['번호', '성명', '성별', '출생년도', '생년월일', '직업분류', '회사 / 직위', '추천인', '연락처', '이메일', '사업장 주소', '자택 주소', '영문명', '가입일', '확약여부', '창립회기 직책', '담당 관리위원', '예비모임 참석', '비고'];
var sheet = [['예비회원 명단'], ['안내'], ['총 인원'], [2], ['창립 목표일'], H,
  [1, '가나다', '여', 1980, '1980-01-02', '의료', '', '', '010-1111-2222', '', '', '', '', '', '확약', '회장', '', '', ''],
  [2, '홍길순', '여', 1982, '', '요식업', '', '', '010-9999-0000', '', '', '', '', '', '검토중', '', '', '', ''],
  [3, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], [4], [5]];
var plan = ctx.intakePlan_(sheet, ps[1], '2026-09-19');
assert.strictEqual(plan.dupRow, null); assert.strictEqual(plan.targetRow, 9, '번호 3의 빈 줄(9행)에 기재');
assert.ok(plan.needAhoCol && plan.ahoCol === 20, '아호 열이 없으면 맨 오른쪽(20열)에 추가');
var w = {}; plan.writes.forEach(function (x) { w[x[0]] = x[1]; });
assert.strictEqual(w[2], '김둘째'); assert.strictEqual(w[4], 1979); assert.ok(!(5 in w), '연도만 적으면 생년월일 칸은 비워 둠'); assert.strictEqual(w[9], '010-2222-3333');
assert.strictEqual(w[12], '대구 가짜구 집길 2', '자택 주소 칸'); assert.ok(!(11 in w), '사업장 주소 없으면 비움');
assert.strictEqual(w[14], '2026-09-19', '가입일(호출한 쪽이 넘긴 날짜)');
assert.strictEqual(ctx.recruitJoinDateOf_('2026-09-21', '2026-10-14'), '2026-10-14', '창립행사 전 접수 → 창립행사일');
assert.strictEqual(ctx.recruitJoinDateOf_('2026-11-02', '2026-10-14'), '2026-11-02', '창립행사 뒤 접수 → 접수일');
assert.strictEqual(ctx.recruitJoinDateOf_('2026-09-21', ''), '', '창립행사일 미정이면 비워 둠');
assert.ok(!ctx.intakePlan_(sheet, ps[1], '').writes.some(function (x) { return x[0] === 14; }), '가입일이 빈 값이면 그 칸은 쓰지 않음'); assert.strictEqual(w[15], '검토중'); assert.strictEqual(w[20], '청향');
assert.ok(!(16 in w) && !(17 in w), '직책·담당 관리위원은 건드리지 않음');

var homo = ctx.intakePlan_(sheet, ps[0], '2026-09-19');     // 같은 이름, 다른 연락처
assert.ok(homo.dupRow === null && homo.homonym, '이름만 같으면 동명이인으로 기재');
assert.ok(homo.writes.some(function (x) { return x[0] === 19 && String(x[1]).indexOf('동명이인 확인') !== -1; }));
assert.ok(homo.writes.some(function (x) { return x[0] === 5 && x[1] === '1982-03-05'; }), '생년월일 칸에 날짜 전체 기재');
var dup = ctx.intakePlan_(sheet, ctx.intakeNormalize_({ name: '홍길순', phone: '010 9999 0000' }), '2026-09-19');
assert.strictEqual(dup.dupRow, 8, '이름+연락처 같으면 중복(8행)');
var dup2 = ctx.intakePlan_(sheet, ctx.intakeNormalize_({ name: '가나다' }), '2026-09-19');
assert.strictEqual(dup2.dupRow, 7, '연락처 없이 같은 이름이면 중복으로 보고 기재 안 함');

var full = sheet.slice(0, 8);                                  // 빈 자리 없음 → 마지막 번호 아래에 줄 추가
var ins = ctx.intakePlan_(full, ps[1], '2026-09-19');
assert.ok(ins.targetRow === null && ins.insertAfterRow === 8 && ins.no === 3);

var line = ctx.intakeConfirmLine_(3, ps[0], { homonym: true });
assert.ok(line.indexOf('010-****-5678') !== -1 && line.indexOf('01012345678') === -1 && line.indexOf('fake@example.com') === -1, '답장에 연락처 원문·이메일 주소 없음');
assert.ok(line.indexOf('1982년생 · 생년월일 ✓') !== -1 && line.indexOf('1982-03-05') === -1, '답장에는 연도만(생년월일 원문 없음)');
assert.ok(line.indexOf('주소 ✓') !== -1 && line.indexOf('가짜로') === -1, '답장에 주소 원문 없음');
assert.ok(ctx.intakeConfirmLine_(4, ps[1], {}).indexOf('생년월일(연도만 있음)') !== -1, '연도만 있으면 미입력 안내');
assert.ok(ctx.intakeFormText_().indexOf('3. 생년월일') !== -1 && ctx.intakeParse_(ctx.intakeFormText_()).length === 0, '양식 글 자체는 기재 대상 0명');
assert.ok(line.indexOf('동명이인') !== -1 && line.indexOf('이메일 ✓') !== -1);

// 라우터: 등록된 임원만 기재, 참관·미등록은 무시
var users = [{ userId: '222', name: '가회장', title: '회장', role: '회장', active: true }, { userId: '555', name: '라참관', title: '', role: '참관', active: true }];
ctx.authUsers_ = function () { return users; };
ctx.CacheService = { getScriptCache: function () { return { get: function () { return null; }, put: function () {}, remove: function () {} }; } };
ctx.rooms_ = function () { return [{ chatId: '1', name: '회장단방', type: '회장단' }, { chatId: '2', name: '임원방', type: '임원' }]; };
var got = []; ctx.intakeHandle_ = function (c, u, t) { got.push(u.name); };
ctx.tgSend_ = function () {};
var say = function (uid, text) { ctx.officeHandleMessage_({ chat: { id: 1, type: 'group' }, from: { id: uid }, text: text }); };
say(222, filled); say(555, filled); say(999, filled); say(222, '그냥 대화입니다');
assert.strictEqual(J(got), J(['가회장']));
ctx.officeHandleMessage_({ chat: { id: 2, type: 'group' }, from: { id: 222 }, text: filled });
assert.strictEqual(got.length, 1, '임원방에 올린 양식은 기재하지 않음(개인정보는 회장단 방에서만)');
ctx.officeHandleMessage_({ chat: { id: 222, type: 'private' }, from: { id: 222 }, text: filled });
assert.strictEqual(got.length, 2, '1:1 로 보낸 양식은 기재');
ctx.officeHandleMessage_({ chat: { id: 1, type: 'group' }, from: { id: 222 }, photo: [{ file_id: 'p', file_unique_id: 'pu' }], caption: filled });
assert.strictEqual(got.length, 3, '사진 설명글(캡션)로 올린 양식도 기재');
ctx.officeHandleMessage_({ chat: { id: 1, type: 'group' }, from: { id: 222 }, photo: [{ file_id: 'p', file_unique_id: 'pu' }], caption: '신입 회원 사진입니다' });
assert.strictEqual(got.length, 3, '양식이 아닌 사진 설명글은 무시');

// 사진 주인 정하기: 양식 다음에 온 사진 → 그 사람, 사진이 먼저면 보관, 설명글 성명, 접수 방이 아니면 안내만
var pk = ctx.intakePhotoPick_({ photo: [{ file_id: 's', width: 90 }, { file_id: 'm', width: 320 }, { file_id: 'l', width: 1280 }] });
assert.strictEqual(J(pk), J({ big: 'l', thumb: 'm' }), '원본=가장 큰 것, 시트용=160px 이상 중 가장 작은 것');
assert.ok(ctx.intakePhotoPick_({ text: '글' }) === null && ctx.intakePhotoPick_({ document: { file_id: 'd', mime_type: 'application/pdf' } }) === null);
var store = {}, attached = [], sent = [];
ctx.CacheService = { getScriptCache: function () { return { get: function (k) { return store[k] || null; }, put: function (k, v) { store[k] = v; }, remove: function (k) { delete store[k]; } }; } };
ctx.intakePhotoAttach_ = function (name, ph) { attached.push(name + ':' + ph.big); return { ok: name !== '없는이', text: name }; };
ctx.tgSend_ = function (id, t) { sent.push(t); };
var photoMsg = function (chatId, fid, extra) { var m = { chat: { id: chatId, type: 'group' }, from: { id: 222 }, photo: [{ file_id: fid, width: 320 }] }; Object.keys(extra || {}).forEach(function (k) { m[k] = extra[k]; }); return m; };
store['intk_last_1_222'] = '홍길순';
ctx.officeHandleMessage_(photoMsg(1, 'a'));
assert.ok(J(attached) === J(['홍길순:a']) && !store['intk_last_1_222'], '양식 다음 사진 → 그 사람, 한 번 쓰면 대기 해제');
ctx.officeHandleMessage_(photoMsg(1, 'b'));
assert.ok(attached.length === 1 && JSON.parse(store['intk_pend_1_222']).big === 'b', '양식 없이 온 사진은 붙이지 않고 잠시 보관');
ctx.officeHandleMessage_(photoMsg(1, 'c', { caption: '청하 홍길순 사진' }));
assert.strictEqual(attached[1], '홍길순:c', '설명글의 성명(아호 무시)');
sent.length = 0; ctx.officeHandleMessage_(photoMsg(1, 'd', { caption: '없는이' }));
assert.strictEqual(sent.length, 0, '설명글이 명단에 없는 말이면 조용히');
ctx.officeHandleMessage_(photoMsg(1, 'e', { reply_to_message: { text: filled } }));
assert.strictEqual(attached.length, 3, '2명짜리 양식에 답장한 사진은 주인을 알 수 없어 넣지 않음');
ctx.officeHandleMessage_(photoMsg(1, 'e', { reply_to_message: { text: '1. 성명 : 김둘째\n2. 성별 : 여\n3. 생년월일 : 1979-05-05' } }));
assert.strictEqual(attached[3], '김둘째:e', '양식 글에 답장으로 올린 사진');
var before = attached.length; sent.length = 0;
ctx.officeHandleMessage_(photoMsg(2, 'f')); ctx.officeHandleMessage_(photoMsg(2, 'g', { caption: filled }));
ctx.officeHandleMessage_({ chat: { id: 2, type: 'group' }, from: { id: 222 }, text: filled });
assert.ok(attached.length === before && got.length === 3 && sent.length === 2 && sent[0].indexOf('회장단 방') !== -1, '임원방: 기재·사진 저장 없이 안내만');

console.log('✅ test-intake 통과 (' + dir + ')\n\n' + line.replace(/<[^>]+>/g, ''));
