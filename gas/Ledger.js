/**
 * Ledger.js — 수입·지출 장부 (재무시스템 2단계)
 *
 * '거래장부' 시트에 수입/지출을 기록하고 잔액(누계)을 유지한다.
 * 회비 납부(/납부)는 자동으로 '수입/회비'로 장부에 기록되어 월 재무보고(3단계)의 토대가 된다.
 */
var LEDGER_SHEET = '거래장부';
var LEDGER_HEADERS = ['날짜', '구분', '분류', '적요', '금액', '잔액', '등록시각'];

function ledgerSheet_() {
  var ss = getSS_();
  var sh = ss.getSheetByName(LEDGER_SHEET);
  if (!sh) { sh = ss.insertSheet(LEDGER_SHEET); sh.appendRow(LEDGER_HEADERS); }
  return sh;
}

/** 금액 파서: '100만' '100만원' '1,000,000' '37500' → 원(정수) */
function parseAmount_(s) {
  s = String(s || '').replace(/,/g, '').trim();
  var m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*만/);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  var n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

/** 현재 잔액(마지막 행의 잔액) */
function ledgerBalance_() {
  var sh = ledgerSheet_(), last = sh.getLastRow();
  return last < 2 ? 0 : (Number(sh.getRange(last, 6).getValue()) || 0);
}

/** 거래 1건 추가. type '수입'/'지출', amount 원. 반환 {balance} */
function ledgerAppend_(type, category, desc, amount) {
  var sh = ledgerSheet_();
  var bal = ledgerBalance_() + (type === '수입' ? amount : -amount);
  sh.appendRow([todayStr_(), type, category || '', desc || '', amount, bal, nowIso_()]);
  return { balance: bal };
}

// ── 명령 ────────────────────────────────────────────────────
function cmdIncome_(chat, from, text)  { ledgerEntry_(chat, from, text, '수입'); }
function cmdExpense_(chat, from, text) { ledgerEntry_(chat, from, text, '지출'); }

function ledgerEntry_(chat, from, text, type) {
  if (!canManageDues_(from.id)) { tgSend_(chat.id, '재무이사·관리자만 사용할 수 있습니다.'); return; }
  var parts = text.trim().split(/\s+/);   // /수입 분류 금액 [적요...]
  if (parts.length < 3) {
    tgSend_(chat.id, '사용법: <b>/' + type + ' 분류 금액 [적요]</b>\n예) ' +
      (type === '수입' ? CLUB.ledgerExamples.income : CLUB.ledgerExamples.expense));
    return;
  }
  var category = parts[1];
  var amount = parseAmount_(parts[2]);
  if (!(amount > 0)) { tgSend_(chat.id, '금액을 숫자로 적어주세요 (예: 350000 또는 100만).'); return; }
  var desc = parts.slice(3).join(' ');
  var r = ledgerAppend_(type, category, desc, amount);
  tgSend_(chat.id, (type === '수입' ? '📥' : '📤') + ' <b>' + type + ' 기록</b>\n' +
    escapeHtml_(category) + (desc ? ' · ' + escapeHtml_(desc) : '') + '\n금액 ' + (type === '수입' ? '+' : '-') + duesFmt_(amount) + '원\n현재 잔액 <b>' + duesFmt_(r.balance) + '원</b>');
}

/** 최근 거래 내역 + 잔액 */
function cmdLedger_(chat, from) {
  if (!canManageDues_(from.id)) { tgSend_(chat.id, '재무이사·관리자만 사용할 수 있습니다.'); return; }
  var sh = ledgerSheet_(), last = sh.getLastRow();
  if (last < 2) { tgSend_(chat.id, '거래 내역이 아직 없습니다. /수입 /지출 로 기록하세요.'); return; }
  var start = Math.max(2, last - 14);
  var data = sh.getRange(start, 1, last - start + 1, LEDGER_HEADERS.length).getValues();
  var L = ['📒 <b>거래장부</b> (최근 ' + data.length + '건)', UI_LINE];
  data.forEach(function (r) {
    L.push((r[1] === '수입' ? '📥' : '📤') + ' ' + toDateStr_(r[0]) + ' ' + escapeHtml_(String(r[2])) +
      (r[3] ? ' ' + escapeHtml_(String(r[3])) : '') + '  ' + (r[1] === '수입' ? '+' : '-') + duesFmt_(r[4]));
  });
  L.push(UI_LINE, '현재 잔액 <b>' + duesFmt_(ledgerBalance_()) + '원</b>');
  tgSend_(chat.id, L.join('\n'));
}
