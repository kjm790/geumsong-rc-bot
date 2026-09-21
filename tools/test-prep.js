/**
 * test-prep.js — 준비 체크리스트(Prep.js) 검증
 *   node tools/test-prep.js dist/geumhyang
 */
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
var dir = process.argv[2] || 'dist/geumhyang';
var ctx = { PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return k === 'ADMIN_IDS' ? '111' : null; }, setProperty: function () {} }; } }, Logger: { log: function () {} } };
vm.createContext(ctx);
fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).sort()
  .forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }); });
var J = JSON.stringify, strip = function (s) { return s.replace(/<[^>]+>/g, ''); };

assert.strictEqual(ctx.prepAddDays_('2026-10-14', -21), '2026-09-23');
assert.strictEqual(ctx.prepAddDays_('2026-10-14', 5), '2026-10-19');
assert.strictEqual(ctx.prepAddDays_('2026-03-01', -1), '2026-02-28', '달·윤년 경계');
var rows = ctx.prepTemplateRows_('2026-10-14');
assert.ok(rows.length === ctx.PREP_TEMPLATE.length && rows[0][0] === 1 && rows[0][4] === '2026-09-23' && rows[0][5] === '대기');
assert.ok(rows.every(function (r) { return r.length === ctx.PREP_HEADERS.length && /^\d{4}-\d{2}-\d{2}$/.test(r[4]) && r[2] && r[3]; }), '모든 항목에 담당·기한');
assert.strictEqual(rows.filter(function (r) { return r[4] > '2026-10-14'; }).length, 3, '행사 뒤 마무리 3건');

var values = [ctx.PREP_HEADERS].concat(rows);
values[2][5] = ' 완 료 '; values[2][6] = '2026-09-20';          // 2번 완료(표기 흔들림)
values.push(['', '', '', '', '', '', '', '']);                  // 빈 줄
values.push([99, '기타', '직접 추가한 항목', '', new Date(Date.UTC(2026, 8, 22)), '', '', '']);   // 시트가 날짜로 바꾼 기한
ctx.toDateStr_ = function (d) { return d.toISOString().slice(0, 10); };
var items = ctx.prepParse_(values);
assert.strictEqual(items.length, rows.length + 1, '빈 줄 제외');
assert.ok(items[1].done && !items[0].done && items[items.length - 1].due === '2026-09-22' && items[items.length - 1].status === '대기');

var today = '2026-09-24', sum = strip(ctx.prepSummaryText_(items, today, '2026-10-14'));
assert.ok(sum.indexOf('D-20') !== -1 && sum.indexOf('진행 1 / ' + items.length) !== -1, sum);
assert.ok(sum.indexOf('기한 지남 2건') !== -1 && sum.indexOf('1 창립총회 일시') !== -1 && sum.indexOf('1일 지남') !== -1 && sum.indexOf('99 직접 추가한 항목') !== -1, '기한 지난 1번(9/23)·99번(9/22)');
assert.ok(sum.indexOf('이번 주 기한 3건') !== -1 && sum.indexOf('09-30 (D-6)') !== -1, '7일 안 기한: 9/26 내빈 명단, 9/30 세칙·인선 — 완료한 2번은 제외됨? ' + sum);
var allText = strip(ctx.prepAllText_(items, today));
assert.ok(allText.indexOf('의결 준비') < allText.indexOf('초청·의전') && allText.indexOf('✅ 2 ') !== -1 && allText.indexOf('기타') !== -1);
assert.ok(strip(ctx.prepSummaryText_(items.map(function (x) { var y = JSON.parse(J(x)); y.done = true; return y; }), today, '2026-10-14')).indexOf('모든 항목을 마쳤습니다') !== -1);

// 라우터: 방 기능·권한
var users = [{ userId: '222', name: '가회장', title: '', role: '회장', active: true }, { userId: '555', name: '참관', title: '', role: '참관', active: true }];
ctx.authUsers_ = function () { return users; };
ctx.rooms_ = function () { return [{ chatId: '1', name: '회장단', type: '회장단' }, { chatId: '2', name: '임원', type: '임원' }, { chatId: '3', name: '동호회', type: '동호회' }]; };
var sent = [], calls = [];
ctx.tgSend_ = function (c, t) { sent.push(t); return { ok: true }; };
ctx.prepReply_ = function (c, t) { calls.push('prep'); }; ctx.prepMarkReply_ = function (c, u, t, d) { calls.push((d ? 'done:' : 'undo:') + t); };
var say = function (room, uid, text) { sent = []; ctx.officeHandleMessage_({ chat: { id: room, type: 'group' }, from: { id: uid }, text: text }); };
say(2, 222, '/prep'); say(2, 222, '/done 3 7'); say(1, 222, '/undo 3'); say(2, 555, '/prep');
assert.strictEqual(J(calls), J(['prep', 'done:/done 3 7', 'undo:/undo 3', 'prep']), '임원방에서도 준비 현황·완료 표시 가능, 참관은 조회만');
say(2, 555, '/done 3'); assert.ok(sent[0].indexOf('권한이 필요') !== -1, '참관은 완료 표시 불가');
say(3, 222, '/prep'); assert.ok(sent[0].indexOf('이 방에서는') !== -1, '동호회 방에서는 불가');

console.log('✅ test-prep 통과 (' + dir + ')\n\n' + sum);
