/**
 * golden.js — 리팩터 무회귀 검증(골든 테스트)
 *
 * 지정한 폴더들의 *.js 를 GAS 처럼 '파일명 알파벳순'으로 한 전역 스코프에 로드한 뒤,
 * 시트·텔레그램 없이 돌릴 수 있는 문구/계산 함수들의 출력을 JSON 으로 뽑는다.
 * 리팩터 전/후 출력을 비교해 한 글자라도 다르면 회귀.
 *
 *   node tools/golden.js <dir> [<dir>...] > out.json
 */
var fs = require('fs'), path = require('path'), vm = require('vm');

var dirs = process.argv.slice(2);
if (!dirs.length) { console.error('usage: node golden.js <dir> [<dir>...]'); process.exit(2); }

var files = [];
dirs.forEach(function (d) {
  fs.readdirSync(d).filter(function (f) { return /\.js$/.test(f); })
    .forEach(function (f) { files.push({ name: f, full: path.join(d, f) }); });
});
files.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });

function unavailable(name) {
  return new Proxy({}, { get: function (_, k) { throw new Error(name + '.' + String(k) + ' (GAS 서비스는 골든 테스트에서 사용 불가)'); } });
}
var ctx = {
  PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return null; }, setProperty: function () {} }; } },
  Logger: { log: function () {} },
  SpreadsheetApp: unavailable('SpreadsheetApp'), DriveApp: unavailable('DriveApp'),
  UrlFetchApp: unavailable('UrlFetchApp'), ScriptApp: unavailable('ScriptApp'),
  CacheService: unavailable('CacheService'), LockService: unavailable('LockService'),
  Utilities: unavailable('Utilities'), console: console
};
vm.createContext(ctx);
files.forEach(function (f) { vm.runInContext(fs.readFileSync(f.full, 'utf8'), ctx, { filename: f.name }); });

// 전송 함수는 캡처로 교체, 회원 조회는 고정값
var sent = [];
ctx.tgSend_ = function (chatId, text) { sent.push(text); return { ok: true, result: { message_id: 1 } }; };
var fakeMember = null;
ctx.getMemberById_ = function () { return fakeMember; };
ctx.upsertMember_ = function () { return true; };
ctx.isAdmin_ = function () { return true; };

var run = function (code) { return vm.runInContext(code, ctx); };
var out = {};
function cap(label, fn) {
  sent = [];
  try { var r = fn(); out[label] = sent.length ? sent.slice() : r; }
  catch (e) { out[label] = 'ERROR: ' + e.message; }
}

var roster = run('getRoster_()');
out.roster = roster;
out.files = files.map(function (f) { return f.name; }).filter(function (n) { return n !== 'Club.js'; });

cap('president', function () { return [ctx.presidentLabel_(), ctx.presidentName_(), ctx.immediatePastPresidentName_()]; });
cap('events', function () { return run('EVENTS.map(function(e){return [e.key,e.name,e.kind,eventDescribe_(e)];})'); });
cap('clubNotice', function () { var o = {}; for (var m = 1; m <= 12; m++) o[m] = ctx.clubNoticeForMonths_([m, m === 12 ? 1 : m + 1]); return o; });
cap('bandHeader', function () { return ctx.bandHeader_(); });

roster.forEach(function (m) {
  cap('member:' + m.name, function () {
    var role = ctx.clubRole_(m.name);
    return {
      role: role, sub: ctx.subTitle_(m.name), past: ctx.pastPresidentTitle_(m.name),
      honorific: ctx.memberHonorific_(m), attendLabel: ctx.attendLabel_(m.aho, m.name),
      rank: ctx.attendRank_(m.name), share: ctx.shareByRole_(role),
      dues: ctx.computeDues_(role, 0, false), duesPhf: ctx.computeDues_(role, 0, true),
      duesType: ctx.duesTypeLabel_(role, 0)
    };
  });
});
cap('share:edge', function () { return [null, '', '없는직책', '공공이미지위원장(클럽감사)', '출석위원장'].map(function (r) { return ctx.shareByRole_(r); }); });
cap('dues:newMember', function () { var o = {}; for (var j = 1; j <= 12; j++) o[j] = [ctx.computeDues_(null, j, false), ctx.computeDues_('클럽 회장', j, true)]; return o; });

var sample = roster[0] || { aho: '아호', name: '홍길동' };
[0, 1, 2, 3].forEach(function (seed) {
  cap('praise:' + seed, function () {
    return [ctx.immediatePastPraise_(sample, seed), ctx.pastPresidentPraise_(sample, '3대회장', seed), ctx.presidentPraise_('아호', seed)];
  });
});
cap('absentMsg', function () { return ctx.absentPresidentMsg_('아호'); });

run('recurringEvents_()').forEach(function (ev) {
  ['2026-07-07', '2026-10-06', '2026-12-01', '2027-01-16'].forEach(function (d) {
    cap('announce:' + ev.key + ':' + d, function () { return ctx.buildAnnouncement_(ev, d); });
  });
});

var chat = { id: 1 }, from = { id: 1, username: 'u' };
fakeMember = null;
cap('cmdDues:guest', function () { ctx.cmdDues_(chat, from); });
cap('cmdStart:guest', function () { ctx.cmdStart_(chat, from, '홍길동'); });
roster.slice(0, 3).concat(roster.filter(function (m) { return ctx.clubRole_(m.name); })).forEach(function (m) {
  fakeMember = m;
  cap('cmdDues:' + m.name, function () { ctx.cmdDues_(chat, from); });
  cap('cmdStart:' + m.name, function () { ctx.cmdStart_(chat, from, m.name); });
});
fakeMember = null;
cap('cmdHelp', function () { ctx.cmdHelp_(chat, from); });

process.stdout.write(JSON.stringify(out, null, 1));
