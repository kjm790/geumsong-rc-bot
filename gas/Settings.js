/**
 * Settings.js — '설정' 탭 (키 / 값 / 설명)
 *
 * 아직 정해지지 않은 값·바뀔 수 있는 값은 코드가 아니라 이 탭에 둔다 → 재배포 없이 시트에서 바로 수정.
 * 값이 비어 있으면 '미정'으로 취급하고, 그 값이 필요한 기능은 스스로 멈춘다(추측해서 돌지 않음).
 */
var SETTINGS_SHEET = '설정';
var SETTINGS_HEADERS = ['키', '값', '설명'];

// setupOffice 가 '없는 키만' 채운다(이미 입력한 값은 절대 덮어쓰지 않음)
var SETTINGS_DEFAULTS = [
  ['RI가입일', (typeof CLUB !== 'undefined' && CLUB.riAdmittedDate) || '', '국제로타리 가입 승인일(가입증서 날짜) yyyy-MM-dd. 창립 회기의 시작일'],
  ['창립일', '', "창립행사(창립총회·창립기념식) 날짜 yyyy-MM-dd. 입력하면 D-day·일정 역산 시작"],
  ['관리위원_정', '', '스폰서클럽 관리위원(정) — 아호 성명'],
  ['관리위원_부', '', '스폰서클럽 관리위원(부) — 아호 성명'],
  ['명단확정마감', '', '창립회원 명단 확정 마감일 yyyy-MM-dd'],
  ['목표인원', 20, '창립회원 목표 인원'],
  ['FINANCE_LIVE', 'FALSE', 'TRUE 로 바꾸기 전까지 회비·지출 기능은 테스트 모드(창립총회 후 가동)'],
  ['연회비', 300000, '원'],
  ['의무봉사금', 200000, '원'],
  ['주회식대', 120000, '원'],
  ['RI기부_USD', 100, '미화 달러. 청구 시점 환율로 원화 환산'],
  ['환율_USD_KRW', '', '1달러당 원. 청구 전에 수동 입력'],
  ['분납_납기', '07-01,01-01', '분납 납기(월-일, 쉼표 구분)'],
  ['창립회기_일할', '', '창립 회기 회비를 일할 계산할지 TRUE/FALSE (미정)'],
  ['입회비', '', '원 (미정)'],
  ['연회비_RI인두세포함', '', '연회비에 RI 인두세·지구분담금·잡지구독료 포함 여부 TRUE/FALSE (미정)'],
  ['분담금_회장', 1500000, '원. 창립 회기 면제'],
  ['분담금_차기회장', 1000000, '원'],
  ['분담금_부회장', 500000, '원'],
  ['분담금_이사', 300000, '원'],
  ['분담금_청구시작', '2027-07-01', '이 날짜가 속한 회기부터 임원 분담금 자동 청구'],
  ['알림_납기전', '14,3', '납기 며칠 전에 알릴지(쉼표 구분)'],
  ['알림_경과후', '7', '납기 경과 며칠 후에 알릴지. 개인 미납은 1:1 로만 발송'],
  ['미납유예일수', '', '일 (미정)'],
  ['정기모임_요일', '', '예: 화 (미정)'],
  ['정기모임_시간', '', '예: 19:00 (미정)'],
  ['정기모임_장소', '', '(미정)']
];

var _SETTINGS = null;
function invalidateSettings_() { _SETTINGS = null; }

/** 시트 값(2차원) → {키: 값}. 순수 함수. */
function settingsParse_(values) {
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var k = String(values[i][0] === null || values[i][0] === undefined ? '' : values[i][0]).trim();
    if (k) map[k] = values[i][1];
  }
  return map;
}
function settingsMap_() {
  if (_SETTINGS) return _SETTINGS;
  _SETTINGS = settingsParse_(getOrCreateSheet_(getSS_(), SETTINGS_SHEET, SETTINGS_HEADERS).getDataRange().getValues());
  return _SETTINGS;
}

function settingIsBlank_(v) { return v === null || v === undefined || String(v).trim() === ''; }
function setting_(key, def) { var v = settingsMap_()[key]; return settingIsBlank_(v) ? def : v; }

/** TRUE/FALSE. 미정(빈 값)이면 def */
function settingBoolOf_(v, def) {
  if (settingIsBlank_(v)) return def;
  if (v === true || v === false) return v;
  var t = String(v).trim().toUpperCase();
  if (['TRUE', 'Y', 'YES', '예', '참', '1'].indexOf(t) !== -1) return true;
  if (['FALSE', 'N', 'NO', '아니오', '거짓', '0'].indexOf(t) !== -1) return false;
  return def;
}
function settingBool_(key, def) { return settingBoolOf_(settingsMap_()[key], def); }

/** 숫자('300,000'·'30만' 허용). 미정이면 def */
function settingNumOf_(v, def) {
  if (settingIsBlank_(v)) return def;
  if (typeof v === 'number') return v;
  var t = String(v).replace(/[,\s원]/g, '');
  var man = /^(\d+(?:\.\d+)?)만$/.exec(t);
  if (man) return Math.round(parseFloat(man[1]) * 10000);
  var n = Number(t);
  return isNaN(n) ? def : n;
}
function settingNum_(key, def) { return settingNumOf_(settingsMap_()[key], def); }

/** 'yyyy-MM-dd' 또는 ''. '2026-__-__' 같은 자리표시는 미정으로 본다. */
function settingDateOf_(v) {
  if (settingIsBlank_(v)) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return toDateStr_(v);
  var m = /^(\d{4})[-.\/]\s*(\d{1,2})[-.\/]\s*(\d{1,2})\.?$/.exec(String(v).trim());
  if (!m) return '';
  var mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return m[1] + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
}
function settingDate_(key) { return settingDateOf_(settingsMap_()[key]); }

/** 회비·지출 기능 실가동 여부. FALSE 면 테스트 모드(기록에 [TEST] 표시, 실제 청구·알림 없음) */
function financeLive_() { return settingBool_('FINANCE_LIVE', false); }

/** 없는 키만 추가(멱등). 반환=추가한 키 수 */
function seedSettings_() {
  var sh = getOrCreateSheet_(getSS_(), SETTINGS_SHEET, SETTINGS_HEADERS);
  var have = settingsParse_(sh.getDataRange().getValues());
  var add = SETTINGS_DEFAULTS.filter(function (r) { return !(r[0] in have); });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
  invalidateSettings_();
  return add.length;
}

/** 미정(빈 값) 키 목록 — /설정 과 점검용 */
function settingsBlankKeys_(map) {
  return SETTINGS_DEFAULTS.map(function (r) { return r[0]; }).filter(function (k) { return settingIsBlank_(map[k]); });
}

// ── 설정값 변경: /set 키 값 ─────────────────────────────────
var SETTINGS_DATE_KEYS = ['RI가입일', '창립일', '명단확정마감', '분담금_청구시작'];
/** 무엇을 바꿀지 계산(순수). 반환 {row, before, value} 또는 {error[, suggest]} — row 는 1부터. 표에 있는 키만 허용(오타로 새 키가 생기지 않게) */
function settingsSetPlan_(values, key, value) {
  var keys = SETTINGS_DEFAULTS.map(function (r) { return r[0]; }), k = String(key || '').trim();
  if (keys.indexOf(k) === -1) {
    var low = k.toLowerCase(), sug = keys.filter(function (x) { return x.toLowerCase() === low || x.indexOf(k) !== -1 || (k.length >= 2 && k.indexOf(x) !== -1); });
    return { error: '없는 설정 키입니다: ' + k, suggest: sug.slice(0, 5) };
  }
  var v = String(value === undefined || value === null ? '' : value).trim();
  if (/^(없음|미정|비움|-)$/.test(v)) v = '';
  if (v && SETTINGS_DATE_KEYS.indexOf(k) !== -1) {
    var d = settingDateOf_(v);
    if (!d) return { error: '날짜는 2026-10-14 처럼 적어 주세요: ' + v };
    v = d;
  }
  for (var i = 1; i < values.length; i++) if (String(values[i][0]).trim() === k) {
    var b = values[i][1];
    return { row: i + 1, before: Object.prototype.toString.call(b) === '[object Date]' ? settingDateOf_(b) : String(b === null || b === undefined ? '' : b), value: v };
  }
  return { row: 0, before: '', value: v };                   // 표에는 있지만 시트에 아직 없는 키 → 새 줄
}
