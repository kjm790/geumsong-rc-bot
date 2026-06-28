/**
 * Roster.js — 공식 회원 명부 + 이름 퍼지 매칭
 *
 * 텔레그램 표시이름(예: '종만')을 공식 명부의 실명(예: '김종만', 아호 '동우')에 매칭한다.
 * - 명부는 데이터 스프레드시트의 'roster' 시트(연번/아호/성명)에 저장(사용자가 직접 편집 가능).
 * - 최초 seedRoster_() 로 아래 ROSTER_SEED 를 시트에 채운다.
 */

var ROSTER_SHEET = 'roster';
var ROSTER_HEADERS = ['연번', '아호', '성명'];

// 대구금송RC 회원명부 (2026-06 기준, 32명)
var ROSTER_SEED = [
  [1, '경헌', '윤용택'], [2, '왕호', '송건호'], [3, '동화', '김복덕'], [4, '심천', '김영상'],
  [5, '청담', '홍계영'], [6, '명헌', '이영희'], [7, '동우', '김종만'], [8, '선은', '이영준'],
  [9, '사헌', '윤성묵'], [10, '의연', '명건보'], [11, '찰수', '서상일'], [12, '성안', '김선명'],
  [13, '호산', '정창길'], [14, '윤동', '오동원'], [15, '지원', '박재석'], [16, '법운', '전준모'],
  [17, '현도', '권준철'], [18, '취산', '황준영'], [19, '돈일', '박동용'], [20, '한결', '송선호'],
  [21, '청죽', '이준원'], [22, '정호', '김태훈'], [23, '벽공', '김태수'], [24, '신도', '정성철'],
  [25, '벽산', '조지훈'], [26, '고금', '이창수'], [27, '한샘', '정상문'], [28, '다원', '이경환'],
  [29, '강명', '권순오'], [30, '범정', '김현태'], [31, '훈양', '권병훈'], [32, '웅헌', '김병철']
];

var _ROSTER_CACHE = null;

// 에디터 '실행' 메뉴용 공개 래퍼(밑줄 없는 이름이라야 실행 목록에 보임)
function seedRoster() { return seedRoster_(); }
function rematchMembers() { return reMatchAllMembers_(); }

function rosterSheet_() {
  var ss = getSS_();
  var sh = ss.getSheetByName(ROSTER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ROSTER_SHEET);
    sh.appendRow(ROSTER_HEADERS);
  }
  return sh;
}

/** 명부 시트를 ROSTER_SEED 로 채우고(덮어쓰기) 기존 회원을 재매칭. 에디터에서 1회 실행. */
function seedRoster_() {
  var sh = rosterSheet_();
  sh.clearContents();
  sh.getRange(1, 1, 1, ROSTER_HEADERS.length).setValues([ROSTER_HEADERS]);
  sh.getRange(2, 1, ROSTER_SEED.length, 3).setValues(ROSTER_SEED);
  _ROSTER_CACHE = null;
  ensureMemberMatchHeaders_();
  reMatchAllMembers_();
  Logger.log('✅ 명부 ' + ROSTER_SEED.length + '명 기록 + 기존 회원 재매칭 완료');
  return ROSTER_SEED.length;
}

/** [{seq, aho, name}] — 시트가 채워져 있으면 시트, 비어 있으면 내장 ROSTER_SEED (실행 중 1회 캐시) */
function getRoster_() {
  if (_ROSTER_CACHE) return _ROSTER_CACHE;
  var out = [];
  try {
    var data = rosterSheet_().getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var name = String(data[i][2] || '').trim();
      if (!name) continue;
      out.push({ seq: data[i][0], aho: String(data[i][1] || '').trim(), name: name });
    }
  } catch (e) { /* 시트 접근 실패 시 내장 데이터 사용 */ }
  if (!out.length) {
    out = ROSTER_SEED.map(function (r) { return { seq: r[0], aho: r[1], name: r[2] }; });
  }
  _ROSTER_CACHE = out;
  return out;
}

/** 명부 표기: '아호 성명' (예: 동우 김종만). 아호 없으면 성명만. */
function rosterLabel_(e) {
  return (e.aho ? e.aho + ' ' : '') + e.name;
}

function rosterBySeq_(seq) {
  var r = getRoster_();
  for (var i = 0; i < r.length; i++) if (String(r[i].seq) === String(seq)) return r[i];
  return null;
}

// ── 퍼지 매칭 ────────────────────────────────────────────────
function normalizeName_(s) {
  return String(s || '').replace(/\s+/g, '').replace(/님$/, '').toLowerCase();
}

function bigrams_(s) {
  if (s.length <= 1) return [s];
  var r = [];
  for (var i = 0; i < s.length - 1; i++) r.push(s.substr(i, 2));
  return r;
}

/** Dice 계수(문자 bigram 기반 유사도 0~1) */
function diceSim_(a, b) {
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  var ga = bigrams_(a), gb = bigrams_(b);
  var map = {};
  ga.forEach(function (g) { map[g] = (map[g] || 0) + 1; });
  var inter = 0;
  gb.forEach(function (g) { if (map[g] > 0) { inter++; map[g]--; } });
  return (2 * inter) / (ga.length + gb.length);
}

/** 텔레그램 이름 vs 명부 한 명: 성명/아호/이름(성 제외)와 비교한 최고 점수 */
function nameScore_(tname, entry) {
  var t = normalizeName_(tname);
  if (!t) return 0;
  var n = normalizeName_(entry.name), a = normalizeName_(entry.aho);
  var best = 0;
  [n, a].forEach(function (cand) {
    if (!cand) return;
    var s = diceSim_(t, cand);
    if (t === cand) s = 1;
    else if (cand.indexOf(t) !== -1 || t.indexOf(cand) !== -1) s = Math.max(s, 0.85); // 부분일치(종만⊂김종만)
    best = Math.max(best, s);
  });
  if (n.length >= 2) {                  // 성 제외 이름(박동용→동용)
    var given = n.slice(-2);
    if (t === given) best = Math.max(best, 0.9);
    else best = Math.max(best, diceSim_(t, given) * 0.9);
  }
  return best;
}

var MATCH_THRESHOLD = 0.6;

// ── 한글→로마자(개정 로마자표기) + 성씨 변형 ─────────────────
var RR_INI = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
var RR_MED = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
var RR_FIN = ['', 'k', 'k', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'];

function hangulToRoman_(s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i) - 0xAC00;
    if (c < 0 || c > 11171) { out += s.charAt(i).toLowerCase(); continue; }
    out += RR_INI[Math.floor(c / 588)] + RR_MED[Math.floor((c % 588) / 28)] + RR_FIN[c % 28];
  }
  return out;
}

// 흔한 성씨의 실제 표기 변형(2글자 이상만)
var ROMAN_SURNAME = {
  '김': ['kim', 'gim'], '이': ['lee', 'yi', 'rhee'], '박': ['park', 'bak', 'pak'],
  '정': ['jung', 'jeong', 'chung'], '최': ['choi', 'choe'], '권': ['kwon', 'gwon'],
  '황': ['hwang'], '송': ['song'], '윤': ['yoon', 'yun'], '홍': ['hong'],
  '명': ['myung', 'myeong'], '서': ['seo', 'suh'], '오': ['oh'], '전': ['jeon', 'jun', 'chun'],
  '조': ['cho', 'jo'], '강': ['kang', 'gang'], '신': ['shin', 'sin'], '한': ['han'],
  '임': ['lim', 'im', 'rim'], '장': ['jang', 'chang'], '문': ['moon', 'mun'],
  '안': ['ahn', 'an'], '백': ['baek', 'paik'], '유': ['yoo', 'yu', 'ryu'], '구': ['koo', 'gu', 'ku']
};

/** 영문/로마자 텔레그램 이름 vs 명부 한 명: 성씨 변형 + 이름 로마자 유사도 */
function romanScore_(tlatin, entry) {
  var t = tlatin.toLowerCase().replace(/[^a-z]/g, '');
  if (t.length < 3) return 0;
  var surHan = entry.name.charAt(0), givenHan = entry.name.slice(1);
  var surRomans = ROMAN_SURNAME[surHan] || [hangulToRoman_(surHan)];
  var givenRoman = hangulToRoman_(givenHan);
  var best = 0;
  surRomans.forEach(function (sr) {
    if (!sr || sr.length < 2) return;
    if (t.indexOf(sr) !== -1) {                       // 성씨가 들어있으면 강한 신호
      var rem = t.replace(sr, '');
      best = Math.max(best, 0.5 + 0.5 * diceSim_(rem, givenRoman));
    }
    best = Math.max(best, diceSim_(t, sr + givenRoman) * 0.85, diceSim_(t, givenRoman + sr) * 0.85);
  });
  return best;
}

/** 텔레그램 이름 → 명부 매칭. {entry, score} 또는 null */
function matchRoster_(tname) {
  if (!tname) return null;
  var hasLatin = /[a-z]/i.test(tname);
  var roster = getRoster_();
  var best = null, bestScore = 0;
  roster.forEach(function (e) {
    var s = nameScore_(tname, e);
    if (hasLatin) s = Math.max(s, romanScore_(tname, e));
    if (s > bestScore) { bestScore = s; best = e; }
  });
  return bestScore >= MATCH_THRESHOLD ? { entry: best, score: bestScore } : null;
}

/** 표시용 라벨: 매칭되면 '아호 성명', 아니면 텔레그램명 */
function memberLabelFromName_(fullName, username) {
  var m = matchRoster_(fullName || username || '');
  if (m) return rosterLabel_(m.entry);
  return displayName_(fullName, username);
}

/** 호칭용(환영·칭찬): 매칭되면 아호만(예: 동우), 아호 없으면 성명, 미매칭은 텔레그램명 */
function addressName_(fullName, username) {
  var m = matchRoster_(fullName || username || '');
  if (m) return m.entry.aho || m.entry.name;
  return displayName_(fullName, username);
}
