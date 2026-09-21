/**
 * Budget.js — 예산·결산 (재무시스템 4단계)
 *
 * 회기(7/1~익년 6/30) 예산을 '예산' 시트에 편성하고, 거래장부 실적과 대비해 결산 보고를 만든다.
 *  - /예산 수입|지출 항목 금액  → 예산 항목 편성/수정
 *  - /결산                     → 예산 대비 실적(집행률) + 수지 + 잔액
 */
var BUDGET_SHEET = '예산';
var BUDGET_HEADERS = ['구분', '항목', '예산액', '비고'];

function budgetSheet_() {
  var ss = getSS_();
  var sh = ss.getSheetByName(BUDGET_SHEET);
  if (!sh) { sh = ss.insertSheet(BUDGET_SHEET); sh.appendRow(BUDGET_HEADERS); }
  return sh;
}

/** today 기준 회기 범위 {start,end,label} (label 'YYYY-YY') */
function fiscalRange_(today) {
  var a = ymd_(today);
  var sy = a.m >= FISCAL_START ? a.y : a.y - 1;
  return { start: dateStr_(sy, 7, 1), end: dateStr_(sy + 1, 6, 30), label: sy + '-' + pad2_((sy + 1) % 100) };
}

/** 거래장부 회기 실적 집계 {inc:{cat:amt}, exp:{cat:amt}, incTot, expTot} */
function fiscalActuals_(range) {
  var data = ledgerSheet_().getDataRange().getValues();
  var inc = {}, exp = {}, incTot = 0, expTot = 0;
  for (var i = 1; i < data.length; i++) {
    var d = String(toDateStr_(data[i][0]));
    if (d < range.start || d > range.end) continue;
    var type = data[i][1], cat = String(data[i][2] || '기타'), amt = Number(data[i][4]) || 0;
    if (type === '수입') { inc[cat] = (inc[cat] || 0) + amt; incTot += amt; }
    else { exp[cat] = (exp[cat] || 0) + amt; expTot += amt; }
  }
  return { inc: inc, exp: exp, incTot: incTot, expTot: expTot };
}

/** 예산 목록 [{type,item,amount}] */
function budgetRows_() {
  var data = budgetSheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (!String(data[i][1] || '').trim()) continue;
    out.push({ type: String(data[i][0] || '').trim(), item: String(data[i][1]).trim(), amount: Number(data[i][2]) || 0 });
  }
  return out;
}

/** 예산 항목 추가/수정. 반환 '추가'/'수정' */
function budgetSet_(type, item, amount) {
  var sh = budgetSheet_(), data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === type && String(data[i][1]).trim() === item) { sh.getRange(i + 1, 3).setValue(amount); return '수정'; }
  }
  sh.appendRow([type, item, amount, '']); return '추가';
}

// ── 명령 ────────────────────────────────────────────────────
/** (재무·관리자) 예산 편성: /예산 수입|지출 항목 금액 */
function cmdBudget_(chat, from, text) {
  if (!canManageDues_(from.id)) { tgSend_(chat.id, '재무이사·관리자만 사용할 수 있습니다.'); return; }
  var parts = text.trim().split(/\s+/);
  if (parts.length < 4) { tgSend_(chat.id, '사용법: <b>/예산 수입|지출 항목 금액</b>\n예) /예산 지출 봉사활동비 500만\n예) /예산 수입 회비 4000만\n(편성 현황·집행률은 /결산)'); return; }
  var type = parts[1];
  if (type !== '수입' && type !== '지출') { tgSend_(chat.id, '구분은 <b>수입</b> 또는 <b>지출</b> 로 적어주세요.'); return; }
  var item = parts[2], amount = parseAmount_(parts[3]);
  if (!(amount > 0)) { tgSend_(chat.id, '금액을 숫자로 적어주세요 (예: 500만 또는 5000000).'); return; }
  var r = budgetSet_(type, item, amount);
  tgSend_(chat.id, '✅ 예산 ' + r + '\n' + type + ' · ' + escapeHtml_(item) + ' · ' + duesFmt_(amount) + '원\n(집행률은 /결산 으로 확인)');
}

/** (재무·관리자) 예산 대비 결산: /결산 */
function cmdSettlement_(chat, from) {
  if (!canManageDues_(from.id)) { tgSend_(chat.id, '재무이사·관리자만 사용할 수 있습니다.'); return; }
  var range = fiscalRange_(todayStr_());
  var act = fiscalActuals_(range);
  var budgets = budgetRows_();
  var L = ['📑 <b>' + CLUB.short + ' 예산 대비 결산</b>', UI_LINE, '🗓 ' + range.label + ' 회기 (' + range.start + '~' + range.end + ')', ''];
  var budInc = 0, budExp = 0;
  ['수입', '지출'].forEach(function (type) {
    var actMap = type === '수입' ? act.inc : act.exp;
    var actTot = type === '수입' ? act.incTot : act.expTot;
    var buds = budgets.filter(function (b) { return b.type === type; });
    var budTot = 0, seen = {};
    L.push('▌<b>' + type + '</b>');
    buds.forEach(function (b) {
      budTot += b.amount; seen[b.item] = 1;
      var a = actMap[b.item] || 0, rate = b.amount ? Math.round(a / b.amount * 100) : 0;
      L.push(' • ' + escapeHtml_(b.item) + ': 예산 ' + duesFmt_(b.amount) + ' / 실적 ' + duesFmt_(a) + ' (' + rate + '%)');
    });
    Object.keys(actMap).forEach(function (cat) { if (!seen[cat]) L.push(' • ' + escapeHtml_(cat) + ': 예산 - / 실적 ' + duesFmt_(actMap[cat]) + ' <i>(예산외)</i>'); });
    L.push('   ▸ 소계 예산 ' + duesFmt_(budTot) + ' / 실적 ' + duesFmt_(actTot) + (budTot ? ' (' + Math.round(actTot / budTot * 100) + '%)' : ''), '');
    if (type === '수입') budInc = budTot; else budExp = budTot;
  });
  L.push(UI_LINE);
  L.push('예산 수지: ' + (budInc - budExp >= 0 ? '+' : '') + duesFmt_(budInc - budExp) + '원');
  L.push('실적 수지: <b>' + (act.incTot - act.expTot >= 0 ? '+' : '') + duesFmt_(act.incTot - act.expTot) + '원</b>');
  L.push('현재 잔액: ' + duesFmt_(ledgerBalance_()) + '원');
  if (!budgets.length) L.push('', '<i>편성된 예산이 없습니다. /예산 수입|지출 항목 금액 으로 편성하세요.</i>');
  tgSend_(chat.id, L.join('\n'));
}
