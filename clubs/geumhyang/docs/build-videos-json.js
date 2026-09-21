// education-videos.md → 영상 목록 CSV, 러닝센터 CSV (+ 회차 구성용 요약 출력)
var fs = require('fs'), path = require('path');
var SRC = 'C:/Users/kjm79/ai-samujang-bot/clubs/geumhyang/docs/education-videos.md';
var OUT = process.argv[2];
var lines = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');

var section = '', videos = [], courses = [], mode = '';
lines.forEach(function (ln) {
  var h = /^## (.+)$/.exec(ln);
  if (h) {
    section = h[1].trim();
    mode = /^\d+\./.test(section) ? 'video' : (section.indexOf('러닝센터') !== -1 ? 'course' : '');
    return;
  }
  if (ln.charAt(0) !== '|' || /^\|\s*-{3}/.test(ln)) return;
  var cells = ln.split('|').slice(1, -1).map(function (c) { return c.trim(); });
  if (mode === 'video' && cells.length === 7 && cells[0] !== '제목') {
    videos.push({ section: section.replace(/^\d+\.\s*/, ''), title: cells[0], channel: cells[1], lang: cells[2], len: cells[3], url: cells[4], summary: cells[5], q: cells[6] });
  }
  if (mode === 'course' && cells.length === 4 && cells[0] !== '대상') courses.push(cells);
});

function csv(rows) {
  return '\uFEFF' + rows.map(function (r) { return r.map(function (c) { c = String(c === undefined ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n') + '\r\n';
}
var vrows = [['번호', '분야', '제목', '채널/출처(게시연도)', '언어(자막)', '길이', '링크', '한 줄 요약', '추천 확인질문', '우리 클럽 메모']];
videos.forEach(function (v, i) { vrows.push([i + 1, v.section, v.title, v.channel, v.lang, v.len, v.url, v.summary, v.q, '']); });
fs.writeFileSync(path.join(OUT, 'videos.csv'), csv(vrows));
fs.writeFileSync(path.join(OUT, 'courses.csv'), csv([['대상', '강좌(한국어 명칭)', '구성·내용(카탈로그 기준)', '링크(My Rotary 로그인 필요)', '수강 완료 메모']].concat(courses.map(function (c) { return c.concat(['']); }))));

var bad = videos.filter(function (v) { return !/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(v.url); });
console.log('videos', videos.length, '| courses', courses.length, '| 링크 형식 이상', bad.length);
var bySec = {};
videos.forEach(function (v, i) { (bySec[v.section] = bySec[v.section] || []).push((i + 1) + ') ' + v.title.slice(0, 46) + ' [' + v.len + '] ' + v.channel.slice(0, 18) + ' ' + v.url.slice(-11)); });
Object.keys(bySec).forEach(function (s) { if (/사찰|클럽관리|멤버십|공공이미지|봉사프로젝트|로타리재단|총무|재무/.test(s)) { console.log('\n# ' + s); bySec[s].forEach(function (t) { console.log('  ' + t); }); } });
fs.writeFileSync(path.join(OUT, 'videos.json'), JSON.stringify(videos));
