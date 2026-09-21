/**
 * Prep.js — 행사 준비 체크리스트 ('준비' 탭)
 *
 * 항목·담당·기한을 시트에 두고, 봇이 진행률을 보여 주고 기한이 다가오면 방에 알린다.
 *  - 시트가 원본: 항목 추가·문구 수정·담당·기한 변경은 시트에서 직접 한다(봇은 '상태'·'완료일' 칸만 쓴다).
 *  - 초안(PREP_TEMPLATE)은 창립행사일 기준 D-일수로 기한을 계산해 한 번만 채운다. 클럽 사정에 맞게 고쳐 쓰는 출발점이다.
 *  - 명령: /prep (/준비) 요약 · /prep all 전체 · /done 번호… 완료 · /undo 번호 되돌리기
 *  - 알림(dailyCheck): 기한 지남·3일 이내 항목이 있으면 매일 1회, 월요일엔 전체 요약. 'prep' 기능이 열린 방으로.
 */
var PREP_SHEET = '준비';
var PREP_HEADERS = ['번호', '분류', '항목', '담당', '기한', '상태', '완료일', '비고'];

// [분류, 항목, 담당(직책), 창립행사일 기준 일수(음수=전, 양수=후)]
var PREP_TEMPLATE = [
  ['의결 준비', '창립총회 일시·장소 확정 및 예약', '회장', -21],
  ['의결 준비', '클럽 세칙(안) 작성·임원 회람', '총무이사', -14],
  ['의결 준비', '임원·이사 인선 마무리(사찰이사·상임위원장)', '회장', -14],
  ['의결 준비', '창립 회기 예산(안)·회비(안) 작성', '재무이사', -10],
  ['의결 준비', '정기모임 요일·시간·장소(안) 정하기', '회장', -10],
  ['의결 준비', '창립총회 의안 확정(세칙·임원 선출·예산·회비·정기모임)', '총무이사', -7],
  ['의결 준비', '창립회원 명단 확정(목표 인원 확약)', '관리위원', -7],
  ['초청·의전', '내빈 초청 명단 작성(지구·스폰서클럽·인근 클럽)', '회장', -18],
  ['초청·의전', '초청장 발송', '총무이사', -14],
  ['초청·의전', '식순·사회 시나리오 작성', '총무이사', -10],
  ['초청·의전', '회장 인사말 준비·내빈 축사 요청', '회장', -10],
  ['초청·의전', '의전 물품 준비(클럽기·로타리기·타종·배너·명패)', '사찰이사', -10],
  ['초청·의전', '가입증서 전달식 준비(증서 액자)', '총무이사', -7],
  ['초청·의전', '회원 배지·명찰·임명장 준비', '총무이사', -7],
  ['초청·의전', '참석 회신 집계·좌석 배치', '총무이사', -5],
  ['행사 운영', '현수막·포토존·식순지 제작', '공공이미지위원장', -7],
  ['행사 운영', '사진·영상 촬영 담당 지정', '공공이미지위원장', -7],
  ['행사 운영', '기념품·답례품 준비', '재무이사', -7],
  ['행사 운영', '식사·다과 메뉴와 인원 확정', '재무이사', -5],
  ['행사 운영', '리허설(사회·타종·입장 동선)', '사찰이사', -2],
  ['행사 운영', '접수대·방명록·회비 수납 준비', '재무이사', -1],
  ['마무리', '회의록 작성·드라이브 보관', '총무이사', 3],
  ['마무리', '행사 사진 드라이브 보관·회원 공유', '공공이미지위원장', 3],
  ['마무리', '지구 보고·내빈 감사 인사', '회장', 5]
];

function prepAddDays_(ymd, n) {
  var p = ymd.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
/** 초안 행(순수): 창립행사일 기준으로 기한 계산 */
function prepTemplateRows_(charter) {
  return PREP_TEMPLATE.map(function (t, i) { return [i + 1, t[0], t[1], t[2], prepAddDays_(charter, t[3]), '대기', '', '']; });
}

/** 시트 값 → 항목 목록(순수). 기한은 'yyyy-MM-dd' 로 정규화, 항목이 빈 줄은 건너뜀 */
function prepParse_(values) {
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i], item = String(r[2] === null || r[2] === undefined ? '' : r[2]).trim();
    if (!item) continue;
    var st = String(r[5] || '').replace(/\s+/g, '');
    out.push({ row: i + 1, no: String(r[0]).replace(/\.0+$/, '').trim(), group: String(r[1] || '').trim(), item: item, owner: String(r[3] || '').trim(),
      due: settingDateOf_(r[4]), done: st === '완료', status: st || '대기', note: String(r[7] || '').trim() });
  }
  return out;
}

function prepDday_(today, due) { var d = recruitDayDiff_(today, due); return d > 0 ? 'D-' + d : d === 0 ? '오늘' : (-d) + '일 지남'; }
function prepLine_(it, today) {
  return (it.done ? '✅' : (it.due && it.due < today ? '🔴' : (it.due && recruitDayDiff_(today, it.due) <= 3 ? '🟡' : '▫️'))) + ' <b>' + escapeHtml_(it.no) + '</b> ' + escapeHtml_(it.item) +
    (it.owner ? '  <i>' + escapeHtml_(it.owner) + '</i>' : '') + (it.done || !it.due ? '' : '  · ' + it.due.slice(5) + ' (' + prepDday_(today, it.due) + ')');
}

/** 요약(순수): 진행률 + 기한 지남 + 곧 기한(7일) + 다음 할 일 */
function prepSummaryText_(items, today, charter) {
  var done = items.filter(function (x) { return x.done; }).length, open = items.filter(function (x) { return !x.done; });
  var byDue = function (a, b) { return (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0; };
  var late = open.filter(function (x) { return x.due && x.due < today; }).sort(byDue);
  var soon = open.filter(function (x) { return x.due && x.due >= today && recruitDayDiff_(today, x.due) <= 7; }).sort(byDue);
  var L = ['🗂 <b>' + CLUB.short + ' 창립행사 준비</b>', UI_LINE];
  if (charter) L.push('🗓 창립행사일 ' + charter + '  <b>' + prepDday_(today, charter).replace(/^오늘$/, 'D-DAY') + '</b>');
  L.push('진행 <b>' + done + '</b> / ' + items.length + '  ' + recruitBar_(done, Math.max(1, items.length)));
  if (late.length) { L.push('', '🔴 <b>기한 지남 ' + late.length + '건</b>'); late.forEach(function (x) { L.push(prepLine_(x, today)); }); }
  if (soon.length) { L.push('', '🟡 <b>이번 주 기한 ' + soon.length + '건</b>'); soon.forEach(function (x) { L.push(prepLine_(x, today)); }); }
  if (!late.length && !soon.length) L.push('', open.length ? '7일 안에 기한인 항목은 없습니다.' : '🎉 모든 항목을 마쳤습니다.');
  L.push(UI_LINE, '완료 표시 <code>/done 번호</code> · 전체 보기 <code>/prep all</code> · 항목·담당·기한 수정은 시트 「준비」 탭');
  return L.join('\n');
}

function prepAllText_(items, today) {
  var L = ['🗂 <b>창립행사 준비 — 전체</b>', UI_LINE], groups = [];
  items.forEach(function (x) { if (groups.indexOf(x.group) === -1) groups.push(x.group); });
  groups.forEach(function (g) {
    L.push('▌<b>' + escapeHtml_(g || '기타') + '</b>');
    items.filter(function (x) { return x.group === g; }).forEach(function (x) { L.push(prepLine_(x, today)); });
    L.push('');
  });
  return L.join('\n').trim();
}

// ── 시트 접근 + 명령 ─────────────────────────────────────────
function prepSheet_() { return getOrCreateSheet_(getSS_(), PREP_SHEET, PREP_HEADERS); }
function prepItems_() { return prepParse_(prepSheet_().getDataRange().getValues()); }

/** 초안 채우기(탭이 비어 있을 때만). 창립행사일이 없으면 채우지 않는다. 반환=채운 줄 수 */
function prepSeedIfEmpty_() {
  var sh = prepSheet_();
  if (sh.getLastRow() > 1) return 0;
  var charter = recruitCharterDate_();
  if (!charter) throw new Error('창립행사일(설정 「창립일」)이 있어야 기한을 계산할 수 있습니다.');
  var rows = prepTemplateRows_(charter);
  sh.getRange(2, 1, rows.length, PREP_HEADERS.length).setNumberFormats(rows.map(function () { return ['0', '@', '@', '@', '@', '@', '@', '@']; })).setValues(rows);
  sh.setFrozenRows(1);
  try { sh.setColumnWidth(3, 330); sh.setColumnWidth(4, 120); } catch (e) {}
  return rows.length;
}

function prepReply_(chat, text) {
  var all = /\s(all|전체)\s*$/i.test(' ' + String(text || '').replace(/^\/\S+/, '')), items = prepItems_(), today = todayStr_();
  if (!items.length) { tgSend_(chat.id, '🗂 준비 항목이 아직 없습니다. 관리자가 초안을 채우거나 시트 「준비」 탭에 직접 적어 주세요.'); return; }
  tgSend_(chat.id, all ? prepAllText_(items, today) : prepSummaryText_(items, today, recruitCharterDate_()));
}

/** /done 3 7 · /undo 3 — 번호로 완료 표시/되돌리기 */
function prepMarkReply_(chat, user, text, done) {
  var nos = String(text || '').replace(/^\/\S+\s*/, '').split(/[\s,]+/).filter(Boolean);
  if (!nos.length) { tgSend_(chat.id, '사용법: <code>/' + (done ? 'done' : 'undo') + ' 번호 [번호…]</code>   번호는 /prep all 에서 확인'); return; }
  var sh = prepSheet_(), items = prepParse_(sh.getDataRange().getValues()), today = todayStr_(), L = [];
  nos.forEach(function (n) {
    var it = items.filter(function (x) { return x.no === n; })[0];
    if (!it) { L.push('❓ 없는 번호: ' + escapeHtml_(n)); return; }
    if (it.done === done) { L.push('➖ ' + escapeHtml_(n) + ' ' + escapeHtml_(it.item) + ' — 이미 ' + (done ? '완료' : '미완료')); return; }
    sh.getRange(it.row, 6, 1, 2).setValues([[done ? '완료' : '대기', done ? today : '']]);
    try { audit_(user, done ? '준비 항목 완료' : '준비 항목 되돌림', n + ' ' + it.item, it.status, done ? '완료' : '대기', ''); } catch (e) {}
    L.push((done ? '✅ ' : '↩️ ') + '<b>' + escapeHtml_(n) + '</b> ' + escapeHtml_(it.item));
  });
  SpreadsheetApp.flush();
  var after = prepItems_(), cnt = after.filter(function (x) { return x.done; }).length;
  tgSend_(chat.id, L.join('\n') + '\n' + UI_LINE + '\n진행 <b>' + cnt + '</b> / ' + after.length + '  ' + recruitBar_(cnt, Math.max(1, after.length)));
}

/** 매일 1회(dailyCheck): 기한 지남·3일 이내가 있으면 알림, 월요일은 항상 요약. 미완료가 없으면 조용히 */
function prepDailyIfDue_() {
  var today = todayStr_();
  if (props_().getProperty('PREP_DAILY_LAST') === today) return;
  var items; try { items = prepItems_(); } catch (e) { return; }
  var open = items.filter(function (x) { return !x.done; });
  if (!open.length) return;
  var urgent = open.some(function (x) { return x.due && recruitDayDiff_(today, x.due) <= 3; }), t = ymd_(today), monday = weekdayOf_(t.y, t.m, t.d) === 1;
  if (!urgent && !monday) return;
  var targets = roomsWithFeature_(rooms_(), 'prep');
  if (!targets.length) return;
  var body = prepSummaryText_(items, today, recruitCharterDate_());
  targets.forEach(function (r) { tgSend_(r.chatId, body); });
  props_().setProperty('PREP_DAILY_LAST', today);
}
