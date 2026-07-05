/**
 * Dues.js — 회비 관리 (부과대장·납부·미납·환율)
 *
 * 회기 7/1 ~ 익년 6/30.
 *  - 기존 회원: 정액. 연회비70만·의무봉사30만·주회비12만·RFSM($100×환율)·분담금(직책별).
 *  - 신입 회원: 가입월 비례. (연회비+의무봉사+주회비)×(잔여개월/12) + 봉사의연금30만(고정) + RFSM($100×가입월환율). 분담금 없음.
 *  - PHF 기부회원: RFSM 면제.
 * 환율(USD→KRW)은 Script Property 'USD_KRW'(기본 1540)로 수동 관리, /환율 로 변경.
 */
var DUES_SHEET = '회비대장';
var DUES_HEADERS = ['아호', '성명', '유형', '직책', '가입월', 'PHF', '연회비', '의무봉사금', '주회비', 'RFSM', '분담금', '봉사의연금', '부과합계', '납부액', '미납'];

var DUES_ANNUAL = 700000, DUES_SERVICE = 300000, DUES_WEEKLY = 120000, DUES_NEWSEED = 300000;
var RFSM_USD = 100, FISCAL_START = 7;   // 회기 시작월(7월)

function getDuesRate_() { return parseInt(getProp_('USD_KRW', false) || '1540', 10) || 1540; }
function setDuesRate_(v) { props_().setProperty('USD_KRW', String(v)); }

/** 천단위 콤마 */
function duesFmt_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function duesSheet_() {
  var ss = getSS_();
  var sh = ss.getSheetByName(DUES_SHEET);
  if (!sh) { sh = ss.insertSheet(DUES_SHEET); sh.appendRow(DUES_HEADERS); }
  return sh;
}

/** 회비/거래 관리 권한: 관리자 또는 재무이사 본인 */
function canManageDues_(userId) {
  if (isAdmin_(userId)) return true;
  var m = getMemberById_(userId);
  return !!(m && m.name && clubRole_(m.name) === '재무이사');
}

/** 한 회원 부과액 계산. joinMonth=신입 가입월(1~12), 0/없으면 기존회원. phf=RFSM 면제 */
function computeDues_(role, joinMonth, phf) {
  var rate = getDuesRate_();
  var rfsm = phf ? 0 : Math.round(RFSM_USD * rate);
  var yr, svc, wk, seed, share;
  if (joinMonth) {                                   // 신입: 가입월 비례
    var pos = ((joinMonth - FISCAL_START + 12) % 12) + 1;   // 회기내 위치(7월=1 … 6월=12)
    var f = (13 - pos) / 12;                          // 잔여개월/12 (가입월 포함)
    yr = Math.round(DUES_ANNUAL * f); svc = Math.round(DUES_SERVICE * f); wk = Math.round(DUES_WEEKLY * f);
    seed = DUES_NEWSEED; share = 0;                   // 봉사의연금 고정, 분담금 없음
  } else {                                            // 기존: 정액
    yr = DUES_ANNUAL; svc = DUES_SERVICE; wk = DUES_WEEKLY; seed = 0;
    share = shareByRole_(role) * 10000;               // shareByRole_는 만원 단위
  }
  var total = yr + svc + wk + rfsm + share + seed;
  return { yr: yr, svc: svc, wk: wk, rfsm: rfsm, share: share, seed: seed, total: total };
}

function duesTypeLabel_(role, joinMonth) {
  if (joinMonth) return '신입';
  return shareByRole_(role) > 0 ? '임원' : '일반';
}

/** 명부 기준으로 대장 재생성. 가입월·PHF·납부액은 보존.
 *  - 미납(납부액 0) 회원: 현재 환율로 부과 재계산(늦게 내면 RFSM 매달 달라짐).
 *  - 납부 시작(납부액>0) 회원: 그 시점 부과로 동결(환율 바뀌어도 불변). 반환=행수 */
function duesRebuild_() {
  var sh = duesSheet_();
  sh.getRange(1, 1, 1, DUES_HEADERS.length).setValues([DUES_HEADERS]);
  var data = sh.getDataRange().getValues();
  var prev = {};
  for (var i = 1; i < data.length; i++) {
    var nm = String(data[i][1] || '').trim();
    if (nm) prev[nm] = { row: data[i].slice(), join: data[i][4], phf: String(data[i][5] || '').trim(), paid: Number(data[i][13]) || 0 };
  }
  var rows = getRoster_().map(function (e) {
    var p = prev[e.name] || {};
    var paid = p.paid || 0;
    if (paid > 0 && p.row && Number(p.row[12]) > 0) {         // 동결: 납부 시작분은 부과 유지
      var pr = p.row, total = Number(pr[12]) || 0;
      return [e.aho, e.name, pr[2], pr[3], pr[4], pr[5], pr[6], pr[7], pr[8], pr[9], pr[10], pr[11], total, paid, total - paid];
    }
    var joinMonth = parseInt(p.join, 10) || 0;
    var phf = /^y/i.test(p.phf || '');
    var role = clubRole_(e.name);
    var c = computeDues_(role, joinMonth, phf);
    return [e.aho, e.name, duesTypeLabel_(role, joinMonth), role || '', joinMonth || '', phf ? 'Y' : '',
      c.yr, c.svc, c.wk, c.rfsm, c.share, c.seed, c.total, paid, c.total - paid];
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, DUES_HEADERS.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, DUES_HEADERS.length).setValues(rows);
  return rows.length;
}

/** 납부 추가(원). 이름=아호/성명/부분일치. 반환 {label,paid,total,due} 또는 null */
function duesAddPayment_(name, won) {
  var sh = duesSheet_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var aho = String(data[i][0] || '').trim(), nm = String(data[i][1] || '').trim();
    if (nm === name || aho === name || (aho + ' ' + nm).indexOf(name) !== -1 || nm.indexOf(name) !== -1) {
      var total = Number(data[i][12]) || 0;
      var paid = (Number(data[i][13]) || 0) + won;
      sh.getRange(i + 1, 14).setValue(paid);
      sh.getRange(i + 1, 15).setValue(total - paid);
      return { label: (aho + ' ' + nm).trim(), paid: paid, total: total, due: total - paid };
    }
  }
  return null;
}

// ── 명령 ────────────────────────────────────────────────────
/** (관리자) 회비대장 생성/갱신 */
function cmdDuesSetup_(chat, from) {
  if (!requireAdmin_(chat, from)) return;
  var n = duesRebuild_();
  tgSend_(chat.id, '✅ 회비대장 생성/갱신 완료 (' + n + '명). 환율 1$=' + duesFmt_(getDuesRate_()) + '원.\n' +
    '• 신입: 시트 <b>가입월</b> 칸에 월(예 10) 입력 후 /회비설정 재실행\n• PHF 회원: <b>PHF</b> 칸에 Y → RFSM 면제');
}

/** 회비 현황: 회원=본인 부과/납부/미납, 관리자·재무=전체 요약+미납자 */
function cmdDuesStatus_(chat, from) {
  var sh = duesSheet_();
  if (sh.getLastRow() < 2) { tgSend_(chat.id, '회비대장이 아직 없습니다. 관리자가 <b>/회비설정</b> 을 먼저 실행해 주세요.'); return; }
  var data = sh.getDataRange().getValues();
  if (!canManageDues_(from.id)) {
    var m = getMemberById_(from.id);
    if (!m || !m.name) { tgSend_(chat.id, '먼저 /start 로 등록하시면 본인 회비를 조회할 수 있습니다.'); return; }
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === m.name && String(data[i][0]).trim() === m.aho) { tgSend_(chat.id, duesMemberText_(data[i])); return; }
    }
    tgSend_(chat.id, '대장에서 본인을 못 찾았습니다. 관리자에게 문의해 주세요.'); return;
  }
  var tot = 0, paid = 0, unpaid = [];
  for (var j = 1; j < data.length; j++) {
    var t = Number(data[j][12]) || 0, p = Number(data[j][13]) || 0;
    tot += t; paid += p;
    if (t - p > 0) unpaid.push({ label: (data[j][0] + ' ' + data[j][1]).trim(), due: t - p });
  }
  unpaid.sort(function (a, b) { return b.due - a.due; });
  var L = ['💰 <b>회비 수납 현황</b> (회기 7/1~6/30)', UI_LINE,
    '총 부과 ' + duesFmt_(tot) + '원', '수납 ' + duesFmt_(paid) + '원', '미납 ' + duesFmt_(tot - paid) + '원',
    '', '📌 미납자 ' + unpaid.length + '명'];
  unpaid.slice(0, 40).forEach(function (u) { L.push(' • ' + escapeHtml_(u.label) + ' — ' + duesFmt_(u.due) + '원'); });
  tgSend_(chat.id, L.join('\n'));
}

function duesMemberText_(r) {
  return ['💰 <b>' + escapeHtml_((r[0] + ' ' + r[1]).trim()) + ' 님 회비</b> (' + r[2] + ')', UI_LINE,
    '연회비 ' + duesFmt_(r[6]) + ' · 의무봉사 ' + duesFmt_(r[7]) + ' · 주회비 ' + duesFmt_(r[8]),
    'RFSM ' + duesFmt_(r[9]) + (Number(r[10]) ? ' · 분담금 ' + duesFmt_(r[10]) : '') + (Number(r[11]) ? ' · 봉사의연 ' + duesFmt_(r[11]) : ''),
    UI_LINE, '부과합계 <b>' + duesFmt_(r[12]) + '원</b>', '납부 ' + duesFmt_(r[13]) + '원', '미납 <b>' + duesFmt_(r[14]) + '원</b>'].join('\n');
}

/** (재무·관리자) 납부 기록: /납부 이름 금액(만원) */
function cmdPay_(chat, from, text) {
  if (!canManageDues_(from.id)) { tgSend_(chat.id, '재무이사·관리자만 사용할 수 있습니다.'); return; }
  var parts = text.trim().split(/\s+/);
  if (parts.length < 3) { tgSend_(chat.id, '사용법: <b>/납부 이름 금액(만원)</b>\n예) /납부 송선호 100  (=100만원)'); return; }
  var amt = parseFloat(parts[2]);
  if (!(amt > 0)) { tgSend_(chat.id, '금액을 숫자(만원)로 적어주세요. 예) /납부 송선호 100'); return; }
  var won = Math.round(amt * 10000);
  var r = duesAddPayment_(parts[1], won);
  if (!r) { tgSend_(chat.id, '"' + escapeHtml_(parts[1]) + '" 회원을 대장에서 못 찾았습니다.'); return; }
  ledgerAppend_('수입', '회비', r.label, won);   // 거래장부에 수입 자동 기록(월 재무보고 연동)
  tgSend_(chat.id, '✅ 납부 기록\n' + escapeHtml_(r.label) + '  +' + duesFmt_(won) + '원\n납부누계 ' + duesFmt_(r.paid) + ' / 부과 ' + duesFmt_(r.total) + ' → 미납 <b>' + duesFmt_(r.due) + '원</b>\n<i>(거래장부에 수입 기록됨)</i>');
}

/** (재무·관리자) 환율 조회/설정: /환율 [숫자] */
function cmdRate_(chat, from, text) {
  if (!canManageDues_(from.id)) { tgSend_(chat.id, '재무이사·관리자만 사용할 수 있습니다.'); return; }
  var parts = text.trim().split(/\s+/);
  if (parts.length < 2) { tgSend_(chat.id, '현재 환율: 1$=' + duesFmt_(getDuesRate_()) + '원\n변경: <b>/환율 1540</b>'); return; }
  var v = parseInt(String(parts[1]).replace(/[^0-9]/g, ''), 10);
  if (!(v > 0)) { tgSend_(chat.id, '환율을 숫자로 적어주세요. 예) /환율 1540'); return; }
  setDuesRate_(v);
  var n = duesRebuild_();
  tgSend_(chat.id, '✅ 환율 1$=' + duesFmt_(v) + '원 설정 (RFSM=' + duesFmt_(RFSM_USD * v) + '원). 대장 ' + n + '명 재계산 완료.');
}
