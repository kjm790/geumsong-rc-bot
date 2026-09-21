/**
 * test-recruit.js — Recruit.js 검증 (가짜 명단, 실제 시트와 같은 모양: 안내문·요약 줄·6행 제목·빈 자리·아래쪽 다른 표)
 *   node tools/test-recruit.js dist/geumhyang
 */
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
var dir = process.argv[2] || 'dist/geumhyang';
var ctx = { PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return null; }, setProperty: function () {} }; } }, Logger: { log: function () {} } };
vm.createContext(ctx);
fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).sort()
  .forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }); });

var H = ['번호', '성명', '성별', '출생년도', '직업분류', '회사 / 직위', '추천인', '연락처', '이메일', '영문명', '가입일', '확약여부', '창립회기 직책', '담당 관리위원', '예비모임 참석', '비고', '아호'];
function row(no, name, job, ref, eng, status, role, mgr) {
  return [no, name, '여', 1980, job, '가짜상사 / 대표', ref, '010-0000-0000', 'fake@example.com', eng, '', status, role, mgr, '', '', no === 1 ? '청향' : ''];
}
var values = [
  ['대구금향 로타리 클럽(가칭) 예비회원 명단'], ['노란 칸에만 입력.'], ['총 인원', '', '확약'], [6, '', 3],
  ['창립 목표일', '2026-__-__'],
  H,
  row(1, '가나다', '의료', '', 'GA NA DA', '확약', '회장', '홍관리'),
  row(2, '라마바', '보험', '가나다', '', '확약', '총무이사', '홍관리'),
  row(3, '사아자', '요식업', '', '', ' 검토 중 ', '', ''),
  row(4, '차카타', '교육', '', '', '검토중', '', '김관리'),
  row(5, '파하<b>', '뷰티', '', '', '확약', '회원위원장', ''),
  row(6, '가나다', '숙박업', '', '', '고민', '', ''),      // 이름 중복 + 목록 밖 상태
  [7], [8], [9],
  ['창립회기 임원'], ['직책', '구분', '성명', '직업분류'], ['회장', '회장단', '가나다', '의료']
];

var p = ctx.recruitParse_(values);
assert.strictEqual(p.rows.length, 6, '6명만 읽어야 함(빈 자리·아래 표 제외)');
assert.strictEqual(p.missingCols.length, 0);   // (vm 경계 너머 객체는 deepStrictEqual 이 프로토타입 차이로 실패 → 값으로 비교)
assert.strictEqual(p.rows[2].status, '검토중', "' 검토 중 ' → '검토중'");
assert.ok(!JSON.stringify(p).match(/010-|example\.com|1980/), '연락처·이메일·출생년도는 읽어 들이지 않아야 함');

var s = ctx.recruitSummary_(p.rows);
assert.strictEqual(s.confirmed, 3); assert.strictEqual(s.byStatus['검토중'], 2); assert.strictEqual(s.byStatus['고민'], 1);
assert.strictEqual(JSON.stringify(s.byManager['홍관리']), JSON.stringify({ total: 2, confirmed: 2 }));
assert.strictEqual(s.byManager['(담당 미지정)'].total, 3);
assert.strictEqual(ctx.recruitDayDiff_('2026-09-19', '2026-10-26'), 37);

var sum = ctx.recruitSummaryText_(p.rows, '2026-09-19', '2026-10-26');
assert.ok(sum.indexOf('D-37') !== -1 && sum.indexOf('17명</b> 더 필요') !== -1 && sum.indexOf('주당 <b>3명</b>') !== -1, sum);
var list = ctx.recruitListText_(p.rows);
assert.ok(list.indexOf('파하&lt;b&gt;') !== -1, 'HTML 이스케이프');
assert.ok(list.indexOf('1. 청향 가나다 — 👑 회장') !== -1 && list.indexOf('2. 라마바 —') !== -1, "'아호 성명' 표기(아호 없으면 성명만)");
var ranked = ctx.recruitListText_([
  { row: 7, name: '일반일', status: '확약', role: '' }, { row: 8, name: '총무', status: '확약', role: '총무이사' }, { row: 9, name: '차기', status: '확약', role: '차기회장' },
  { row: 10, name: '일반이', status: '확약', role: '' }, { row: 11, name: '부회', status: '확약', role: '부회장' }, { row: 12, name: '회장님', status: '확약', role: '회장' },
  { row: 13, name: '위원', status: '확약', role: '회원위원장' }
]).replace(/<[^>]+>/g, '');
var order = ['회장님', '차기', '부회', '총무', '위원', '일반일', '일반이'].map(function (n) { return ranked.indexOf(' ' + n + (n.indexOf('일반') === 0 ? '' : ' —')); });
assert.ok(order.every(function (x, i) { return x !== -1 && (i === 0 || x > order[i - 1]); }), '임원 서열순(회장→차기→부회장→총무→위원장) 뒤에 일반 회원은 시트 순: ' + ranked);
assert.strictEqual(p.ahoMissing, false);
var noAho = ctx.recruitParse_(values.map(function (r) { return r.slice(0, 16); }));
assert.ok(noAho.ahoMissing && noAho.headerRow === 6 && noAho.width === 16 && noAho.missingCols.length === 0, '아호 열 없으면 17열에 추가 대상, 경고 열 목록엔 안 넣음');
assert.ok(list.indexOf('👑 회장') !== -1 && list.indexOf('🤝 회원위원장') !== -1, '직책 뱃지(회장·회원위원장)');
var chk = ctx.recruitCheckText_(p);
assert.ok(chk.indexOf('이름 중복') !== -1 && chk.indexOf('가나다=고민') !== -1 && chk.indexOf('영문명 미입력</b> 5명') !== -1, chk);
assert.strictEqual(ctx.attendRank_ && ctx.ATTEND_ROLE_RANK['회장'], 1);

// 아호 열 위치·입력 파싱
var layEnd = ctx.recruitAhoLayout_(values);
assert.ok(layEnd.headerRow === 6 && layEnd.nameCol === 2 && layEnd.ahoCol === 17 && !layEnd.ok, '맨 오른쪽 아호 → 옮길 대상');
assert.ok(ctx.recruitAhoLayout_([['번호', '아호', '성명']]).ok, '성명 바로 앞이면 그대로');
assert.ok(ctx.recruitAhoLayout_([['번호', '성명']]).ahoCol === 0);
assert.strictEqual(JSON.stringify(ctx.recruitAhoPairs_('/아호 가나다 청향, 라마바 다솜\n사아자 없음 ; 혼자')), JSON.stringify([['가나다', '청향'], ['라마바', '다솜'], ['사아자', '']]));
var moved = values.map(function (r) { return r.length < 16 ? r : [r[0], r[16] || '', r[1]].concat(r.slice(2, 16)); });   // 아호를 성명 앞으로 옮긴 모양
moved[5] = ['번호', '아호', '성명'].concat(H.slice(2, 16));
var pm = ctx.recruitParse_(moved);
assert.ok(pm.rows.length === 6 && pm.rows[0].aho === '청향' && pm.rows[0].name === '가나다' && pm.rows[1].job === '보험', '열을 옮겨도 제목 이름으로 똑같이 읽음');

// 이름 오타 제안
var NM = ['한소연', '박주영', '박수영', '나한결'];
assert.strictEqual(ctx.recruitSuggestName_(NM, '한소영'), '한소연', '한 글자 차이 + 후보 1명 → 제안');
assert.strictEqual(ctx.recruitSuggestName_(NM, '박두영'), '', '후보가 둘(박주영·박수영)이면 제안 안 함');
assert.strictEqual(ctx.recruitSuggestName_(NM, '박철수'), '');
assert.strictEqual(ctx.recruitSuggestName_(NM, '나한'), '나한결', '한 글자 빠진 경우');
assert.strictEqual(ctx.recruitSuggestName_(NM, '한소연'), '', '같은 이름은 제안 대상 아님');
assert.strictEqual(ctx.recruitSuggestButton_('aho', '한소연', '다솜')[0].callback_data, 'aho|한소연|다솜');
assert.strictEqual(ctx.recruitSuggestButton_('aho', '한소연', '아주아주아주아주아주아주아주아주긴아호입니다'), null, '64바이트 넘으면 버튼 생략');

// 직책 지정 계획
var ALLOWED = ['회장', '차기회장', '부회장', '총무이사', '재무이사', '사찰이사', '회원위원장'];
var rp = ctx.recruitRolePlan_(values, '사아자', ' 재무이사 ', ALLOWED);
assert.ok(rp.row === 9 && rp.col === 13 && rp.before === '' && rp.after === '재무이사', JSON.stringify(rp));
assert.ok(/이미 라마바 님/.test(ctx.recruitRolePlan_(values, '사아자', '총무이사', ALLOWED).error), '한 자리 한 명 — 이미 맡은 사람이 있으면 막음');
assert.ok(/시트에 없는 직책/.test(ctx.recruitRolePlan_(values, '사아자', '대통령', ALLOWED).error), '드롭다운 목록 밖 값 거부');
assert.strictEqual(ctx.recruitRolePlan_(values, '없는사람', '재무이사', ALLOWED).error, 'notfound');
assert.ok(/여러 명/.test(ctx.recruitRolePlan_(values, '가나다', '재무이사', ALLOWED).error));
var clr = ctx.recruitRolePlan_(values, '라마바', '없음', ALLOWED);
assert.ok(clr.before === '총무이사' && clr.after === '', '직책 해제');
assert.strictEqual(ctx.recruitRolePlan_(values, '차카타', '아무직책').after, '아무직책', '드롭다운이 없는 시트면 검사 생략');

// 확약여부 변경 계획
var sp = ctx.recruitStatusPlan_(values, ['라마바', '사아자', ' 차카타 ', '가나다', '없는사람', '사아자'], '확약');
assert.strictEqual(JSON.stringify(sp.changes.map(function (c) { return c.name + ':' + c.before + '@' + c.row + ',' + c.col; })), JSON.stringify(['사아자:검토중@9,12', '차카타:검토중@10,12']));
assert.strictEqual(JSON.stringify([sp.same, sp.notFound, sp.ambiguous]), JSON.stringify([['라마바'], ['없는사람'], ['가나다']]), '이미 같은 상태·없는 이름·동명이인 구분, 중복 입력은 1회만');

// 클럽별 서열: 금향은 DEI(6번)가 IT(7번)보다 앞
assert.ok(ctx.recruitRoleRank_('DEI위원장') < ctx.recruitRoleRank_('IT위원장') && ctx.recruitRoleRank_('봉사프로젝트위원장') < ctx.recruitRoleRank_('DEI위원장'), 'DEI 6번·IT 7번');

// 동호회장 표기
var withSub = ctx.recruitListText_([{ row: 7, name: '차기', aho: '류', status: '확약', role: '차기회장' }, { row: 8, name: '일반', status: '확약', role: '' }], { '차기': '골프회장', '일반': '문화레저동호회장' }).replace(/<[^>]+>/g, '');
assert.ok(withSub.indexOf('차기회장(골프회장)') !== -1 && withSub.indexOf('일반 — 문화레저동호회장') !== -1, withSub);
assert.strictEqual(ctx.recruitNameOf_('동우 김종만'), '김종만'); assert.strictEqual(ctx.recruitNameOf_('김종만'), '김종만'); assert.strictEqual(ctx.recruitNameOf_(''), '');

// 제목 줄이 없으면 명확한 오류
assert.throws(function () { ctx.recruitParse_([['아무거나'], ['이름', '상태']]); }, /성명/);
// D-day 없이도 동작
assert.ok(ctx.recruitSummaryText_(p.rows, '2026-09-19', '').indexOf('창립행사일') === -1);
// '(가칭)' 제거: 제목 줄 위쪽 칸만, 회원 줄은 건드리지 않음
var prov = ctx.recruitProvisionalCells_(values.concat([[99, '이름(가칭)']]));
assert.strictEqual(JSON.stringify(prov), JSON.stringify([{ row: 1, col: 1, value: '대구금향 로타리 클럽 예비회원 명단' }]));
assert.strictEqual(ctx.recruitProvisionalCells_([['번호', '성명']]).length, 0);

console.log('✅ test-recruit 통과 (' + dir + ')\n');
console.log(sum.replace(/<[^>]+>/g, ''));
