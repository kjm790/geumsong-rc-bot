/**
 * Scheduling.js — N번째 요일 / 월말 날짜 계산
 *
 * 날짜는 'yyyy-MM-dd' 문자열로 다룬다. (ISO 문자열은 사전식 비교 = 날짜 비교)
 * 요일은 JS 기준 0=일 .. 6=토.
 */

function nowIso_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

function todayStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function ymd_(str) {
  var p = str.split('-');
  return { y: parseInt(p[0], 10), m: parseInt(p[1], 10), d: parseInt(p[2], 10) };
}

function dateStr_(y, m, d) { return y + '-' + pad2_(m) + '-' + pad2_(d); }

function daysInMonth_(y, m) {           // m: 1~12
  return new Date(y, m, 0).getDate();
}

function lastDayOfMonthStr_(y, m) {
  return dateStr_(y, m, daysInMonth_(y, m));
}

function isLastDayOfMonth_(str) {
  var a = ymd_(str);
  return str === lastDayOfMonthStr_(a.y, a.m);
}

function weekdayOf_(y, m, d) {          // JS 0=일 .. 6=토
  return new Date(y, m - 1, d).getDay();
}

/**
 * 해당 월의 'N번째 특정 요일' 날짜('yyyy-MM-dd').
 * 그 달에 nth번째가 없으면(예: 다섯째 요일이 없는 달) 마지막 해당 요일로 보정.
 */
function nthWeekdayOfMonth_(y, m, weekday, nth) {
  var first = new Date(y, m - 1, 1).getDay();
  var offset = (weekday - first + 7) % 7;
  var day = 1 + offset + (nth - 1) * 7;
  var dim = daysInMonth_(y, m);
  while (day > dim) day -= 7;          // 없는 nth → 마지막 해당 요일로
  return dateStr_(y, m, day);
}

function addMonth_(y, m) {
  return m === 12 ? { y: y + 1, m: 1 } : { y: y, m: m + 1 };
}

/**
 * fromStr(포함) 기준 가장 가까운 다가오는 행사 날짜.
 * 이번 달 행사가 지났으면 다음 달.
 */
function nextMeetingDate_(fromStr, weekday, nth) {
  var a = ymd_(fromStr);
  var thisMonth = nthWeekdayOfMonth_(a.y, a.m, weekday, nth);
  if (thisMonth >= fromStr) return thisMonth;   // ISO 문자열 비교
  var nx = addMonth_(a.y, a.m);
  return nthWeekdayOfMonth_(nx.y, nx.m, weekday, nth);
}

function daysUntil_(targetStr, fromStr) {
  var t = ymd_(targetStr), f = ymd_(fromStr);
  var td = Date.UTC(t.y, t.m - 1, t.d), fd = Date.UTC(f.y, f.m - 1, f.d);
  return Math.round((td - fd) / 86400000);
}

function formatMeetingDate_(str, hour, minute) {
  var a = ymd_(str);
  var w = weekdayOf_(a.y, a.m, a.d);
  var t = hour + '시' + (minute ? ' ' + minute + '분' : '');
  return a.y + '년 ' + a.m + '월 ' + a.d + '일 (' + weekdayNameKr_(w) + ') ' + t;
}
