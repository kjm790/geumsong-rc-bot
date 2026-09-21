/**
 * Report.js — 월 재무보고 (재무시스템 3단계)
 *
 * 거래장부(Ledger)를 월별로 집계(수입/지출 항목별)해 보고서를 만든다.
 *  - 자동: 매월 1일, 전월 보고를 임원방에 1회 게시(dailyCheck → postMonthlyReportIfDue_).
 *  - 수동: /월보고 [YYYY-MM] (생략 시 이번 달).
 */

/** 'YYYY-MM' 월의 재무보고 텍스트 */
function monthReport_(ym) {
  var data = ledgerSheet_().getDataRange().getValues();
  var incCat = {}, expCat = {}, incTot = 0, expTot = 0, count = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(toDateStr_(data[i][0])).slice(0, 7) !== ym) continue;
    count++;
    var type = data[i][1], cat = String(data[i][2] || '기타'), amt = Number(data[i][4]) || 0;
    if (type === '수입') { incCat[cat] = (incCat[cat] || 0) + amt; incTot += amt; }
    else { expCat[cat] = (expCat[cat] || 0) + amt; expTot += amt; }
  }
  var p = ym.split('-');
  var L = ['📊 <b>' + CLUB.short + ' 월 재무보고</b>', UI_LINE, '🗓 ' + p[0] + '년 ' + parseInt(p[1], 10) + '월', ''];
  L.push('▌<b>수입</b> 합계 ' + duesFmt_(incTot) + '원');
  L = L.concat(reportCatLines_(incCat));
  L.push('', '▌<b>지출</b> 합계 ' + duesFmt_(expTot) + '원');
  L = L.concat(reportCatLines_(expCat));
  L.push('', UI_LINE);
  var net = incTot - expTot;
  L.push('당월 수지: <b>' + (net >= 0 ? '+' : '') + duesFmt_(net) + '원</b>  (수입 ' + duesFmt_(incTot) + ' − 지출 ' + duesFmt_(expTot) + ')');
  L.push('누적 잔액: <b>' + duesFmt_(ledgerBalance_()) + '원</b>');
  var due = duesUnpaidSummary_();
  if (due) L.push('', '💰 회비 미납 ' + due.count + '명 · ' + duesFmt_(due.amount) + '원');
  L.push('', '<i>거래 ' + count + '건 집계</i>');
  return L.join('\n');
}

function reportCatLines_(catMap) {
  var keys = Object.keys(catMap).sort(function (a, b) { return catMap[b] - catMap[a]; });
  if (!keys.length) return [' • (없음)'];
  return keys.map(function (k) { return ' • ' + escapeHtml_(k) + ' ' + duesFmt_(catMap[k]); });
}

/** 회비 미납 요약 {count, amount} 또는 null */
function duesUnpaidSummary_() {
  var sh = getSS_().getSheetByName(DUES_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var data = sh.getDataRange().getValues();
  var cnt = 0, amt = 0;
  for (var i = 1; i < data.length; i++) { var u = Number(data[i][14]) || 0; if (u > 0) { cnt++; amt += u; } }
  return { count: cnt, amount: amt };
}

/** (재무·관리자) 월 재무보고 수동: /월보고 [YYYY-MM] */
function cmdMonthReport_(chat, from, text) {
  if (!canManageDues_(from.id)) { tgSend_(chat.id, '재무이사·관리자만 사용할 수 있습니다.'); return; }
  var parts = text.trim().split(/\s+/);
  var ym = (parts[1] && /^\d{4}-\d{2}$/.test(parts[1])) ? parts[1] : todayStr_().slice(0, 7);
  tgSend_(chat.id, monthReport_(ym));
}

/** 매월 1일 → 전월 재무보고를 임원방에 1회 게시 (dailyCheck에서 호출, 자체 가드) */
function postMonthlyReportIfDue_() {
  var a = ymd_(todayStr_());
  if (a.d !== 1) return;
  var prev = a.m === 1 ? { y: a.y - 1, m: 12 } : { y: a.y, m: a.m - 1 };
  var ym = prev.y + '-' + pad2_(prev.m);
  var key = 'MONTHREPORT_' + ym;
  if (props_().getProperty(key)) return;              // 이미 게시됨
  tgSend_(getOfficerChatId_() || getGroupChatId_(), monthReport_(ym));
  props_().setProperty(key, todayStr_());
}
