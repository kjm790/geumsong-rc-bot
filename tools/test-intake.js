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
  '1. 성명 : 홍 길순\n2. 성별 : 여성\n3. 출생년도 : 82년생\n4. 직업(업종) : 요식업\n5. 회사명 / 직위 : 가짜식당 / 대표\n6. 추천인 : 가나다\n' +
  '7. 연락처 : 01012345678\n8. 이메일 : fake@example.com\n9. 영문명(여권 표기) : hong gil soon\n10. 아호(있으면) : 없음\n11. 비고(특이사항) : 10월 초 확답 예정\n\n' +
  '1. 성명：김둘째\n2. 성별： 여\n3. 출생년도： 1979\n4. 직업(업종)： 교육\n7. 연락처： 010-2222-3333\n10. 아호(있으면)： 청향\n';
var ps = ctx.intakeParse_(filled);
assert.strictEqual(ps.length, 2, '한 메시지에 2명');
assert.strictEqual(J([ps[0].name, ps[0].gender, ps[0].birth, ps[0].phone, ps[0].eng, ps[0].aho]), J(['홍길순', '여', '1982', '010-1234-5678', 'HONG GIL SOON', '']));
assert.strictEqual(J([ps[1].name, ps[1].birth, ps[1].aho, ps[1].phone]), J(['김둘째', '1979', '청향', '010-2222-3333']), '전각 콜론(：)도 인식');
assert.strictEqual(ctx.intakeMaskPhone_('010-1234-5678'), '010-****-5678');

// 실제 시트와 같은 모양: 안내 줄 + 6행 제목 + 번호만 있는 빈 자리
var H = ['번호', '성명', '성별', '출생년도', '직업분류', '회사 / 직위', '추천인', '연락처', '이메일', '영문명', '최초 접촉일', '확약여부', '창립회기 직책', '담당 관리위원', '예비모임 참석', '비고'];
var sheet = [['예비회원 명단'], ['안내'], ['총 인원'], [2], ['창립 목표일'], H,
  [1, '가나다', '여', 1980, '의료', '', '', '010-1111-2222', '', '', '', '확약', '회장', '', '', ''],
  [2, '홍길순', '여', 1982, '요식업', '', '', '010-9999-0000', '', '', '', '검토중', '', '', '', ''],
  [3, '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], [4], [5]];
var plan = ctx.intakePlan_(sheet, ps[1], '2026-09-19');
assert.strictEqual(plan.dupRow, null); assert.strictEqual(plan.targetRow, 9, '번호 3의 빈 줄(9행)에 기재');
assert.ok(plan.needAhoCol && plan.ahoCol === 17, '아호 열이 없으면 맨 오른쪽(17열)에 추가');
var w = {}; plan.writes.forEach(function (x) { w[x[0]] = x[1]; });
assert.strictEqual(w[2], '김둘째'); assert.strictEqual(w[4], 1979); assert.strictEqual(w[8], '010-2222-3333');
assert.strictEqual(w[11], '2026-09-19', '최초 접촉일'); assert.strictEqual(w[12], '검토중'); assert.strictEqual(w[17], '청향');
assert.ok(!(13 in w) && !(14 in w), '직책·담당 관리위원은 건드리지 않음');

var homo = ctx.intakePlan_(sheet, ps[0], '2026-09-19');     // 같은 이름, 다른 연락처
assert.ok(homo.dupRow === null && homo.homonym, '이름만 같으면 동명이인으로 기재');
assert.ok(homo.writes.some(function (x) { return x[0] === 16 && String(x[1]).indexOf('동명이인 확인') !== -1; }));
var dup = ctx.intakePlan_(sheet, ctx.intakeNormalize_({ name: '홍길순', phone: '010 9999 0000' }), '2026-09-19');
assert.strictEqual(dup.dupRow, 8, '이름+연락처 같으면 중복(8행)');
var dup2 = ctx.intakePlan_(sheet, ctx.intakeNormalize_({ name: '가나다' }), '2026-09-19');
assert.strictEqual(dup2.dupRow, 7, '연락처 없이 같은 이름이면 중복으로 보고 기재 안 함');

var full = sheet.slice(0, 8);                                  // 빈 자리 없음 → 마지막 번호 아래에 줄 추가
var ins = ctx.intakePlan_(full, ps[1], '2026-09-19');
assert.ok(ins.targetRow === null && ins.insertAfterRow === 8 && ins.no === 3);

var line = ctx.intakeConfirmLine_(3, ps[0], { homonym: true });
assert.ok(line.indexOf('010-****-5678') !== -1 && line.indexOf('01012345678') === -1 && line.indexOf('fake@example.com') === -1, '답장에 연락처 원문·이메일 주소 없음');
assert.ok(line.indexOf('동명이인') !== -1 && line.indexOf('이메일 ✓') !== -1);

// 라우터: 등록된 임원만 기재, 참관·미등록은 무시
var users = [{ userId: '222', name: '가회장', title: '회장', role: '회장', active: true }, { userId: '555', name: '라참관', title: '', role: '참관', active: true }];
ctx.authUsers_ = function () { return users; };
ctx.rooms_ = function () { return [{ chatId: '1', name: '회장단방', type: '회장단' }, { chatId: '2', name: '임원방', type: '임원' }]; };
var got = []; ctx.intakeHandle_ = function (c, u, t) { got.push(u.name); };
var say = function (uid, text) { ctx.officeHandleMessage_({ chat: { id: 1, type: 'group' }, from: { id: uid }, text: text }); };
say(222, filled); say(555, filled); say(999, filled); say(222, '그냥 대화입니다');
assert.strictEqual(J(got), J(['가회장']));
ctx.officeHandleMessage_({ chat: { id: 2, type: 'group' }, from: { id: 222 }, text: filled });
assert.strictEqual(got.length, 1, '임원방에 올린 양식은 기재하지 않음(개인정보는 회장단 방에서만)');
ctx.officeHandleMessage_({ chat: { id: 222, type: 'private' }, from: { id: 222 }, text: filled });
assert.strictEqual(got.length, 2, '1:1 로 보낸 양식은 기재');

console.log('✅ test-intake 통과 (' + dir + ')\n\n' + line.replace(/<[^>]+>/g, ''));
