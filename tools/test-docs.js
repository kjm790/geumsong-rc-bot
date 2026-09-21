/**
 * test-docs.js — 파일 보관(Docs.js) 검증: 보관 요청 인식, 폴더 선택지, 파일명, 라우터·버튼 권한
 *   node tools/test-docs.js dist/geumhyang
 */
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
var dir = process.argv[2] || 'dist/geumhyang';
var PROPS = { ADMIN_IDS: '111' };
var ctx = { PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return PROPS[k] === undefined ? null : PROPS[k]; }, setProperty: function () {} }; } }, Logger: { log: function () {} } };
vm.createContext(ctx);
fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).sort()
  .forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }); });
var J = JSON.stringify;

var DOC = { document: { file_id: 'F1', file_unique_id: 'U1', file_name: 'RI가입증서.pdf', file_size: 171309 } };
var PHOTO = { photo: [{ file_id: 's', file_unique_id: 'us', file_size: 10 }, { file_id: 'L', file_unique_id: 'uL', file_size: 900 }] };
var priv = { id: 222, type: 'private' }, grp = { id: 1, type: 'group', title: '회장단' };
var mk = function (chat, extra) { var m = { chat: chat, from: { id: 222 } }; Object.keys(extra).forEach(function (k) { m[k] = extra[k]; }); return m; };

// 파일 추출
assert.strictEqual(ctx.docsPickFile_(DOC).name, 'RI가입증서.pdf');
assert.ok(ctx.docsPickFile_(PHOTO).fileId === 'L' && ctx.docsPickFile_(PHOTO).kind === 'photo', '사진은 가장 큰 크기');
assert.strictEqual(ctx.docsPickFile_({ text: 'hi' }), null);

// 보관 요청 인식
assert.ok(ctx.docsTrigger_(mk(priv, DOC)), '1:1 의 파일은 무조건 보관 요청');
assert.strictEqual(ctx.docsTrigger_(mk(grp, DOC)), null, '그룹의 그냥 파일은 보관 안 함');
assert.strictEqual(ctx.docsTrigger_(mk(grp, { document: DOC.document, caption: '/보관 9월 이사회 회의록' })).note, '9월 이사회 회의록');
assert.ok(ctx.docsTrigger_(mk(grp, { photo: PHOTO.photo, caption: '/save@geumhyang_office_bot' })), '/save@봇 도 인정');
var rep = ctx.docsTrigger_(mk(grp, { text: '/보관 통장사본', reply_to_message: DOC }));
assert.ok(rep && rep.source === DOC && rep.note === '통장사본', '파일에 답장으로 /보관');
assert.strictEqual(ctx.docsTrigger_(mk(grp, { text: '/보관', reply_to_message: { text: '글' } })), null, '파일 없는 글에 답장이면 아님');
assert.strictEqual(ctx.docsTrigger_(mk(grp, { text: '보관해 주세요', reply_to_message: DOC })), null);

// 폴더 선택지: 권한 + 방
var U = function (role) { return { userId: '222', name: '가', role: role }; };
var all = ctx.docsFolderChoices_(U('재무이사'), true), lim = ctx.docsFolderChoices_(U('재무이사'), false), jo = ctx.docsFolderChoices_(U('조회'), true);
assert.ok(all.indexOf('04_재무(회비·장부·영수증)') !== -1 && all.indexOf('02_회원명부·가입신청서') !== -1 && all.indexOf('99_봇데이터') === -1);
assert.ok(lim.indexOf('04_재무(회비·장부·영수증)') === -1 && lim.indexOf('03_회의록·총회') !== -1, '임원방에서는 민감 폴더 선택 불가');
assert.ok(jo.indexOf('02_회원명부·가입신청서') === -1 && jo.indexOf('05_봉사활동') !== -1, '조회 권한은 회원명부 폴더 불가');
assert.strictEqual(ctx.docsDefaultFolder_(U('재무이사'), 'document', all), '04_재무(회비·장부·영수증)');
assert.strictEqual(ctx.docsDefaultFolder_(U('재무이사'), 'document', lim), '', '선택지에 없으면 기본값 없음');
assert.strictEqual(ctx.docsDefaultFolder_(U('회장'), 'photo', all), '06_행사사진');

// 파일명
assert.strictEqual(ctx.docsSafeName_('2026-09-21', 'RI가입증서.pdf', ''), '2026-09-21_RI가입증서.pdf');
assert.strictEqual(ctx.docsSafeName_('2026-09-21', 'a/b:c*.pdf', '이사회 <1차>'), '2026-09-21_이사회 1차_a b c .pdf'.replace('c .pdf', 'c .pdf'));
assert.strictEqual(ctx.docsSafeName_('2026-09-21', 'photo_uL.jpg', '창립총회 단체사진'), '2026-09-21_창립총회 단체사진.jpg', '이름 없는 사진은 설명글이 이름');
assert.strictEqual(ctx.docsSafeName_('2026-09-21', '2026-09-07_RI가입증서.pdf', ''), '2026-09-07_RI가입증서.pdf', '이미 날짜로 시작하면 그대로');
var kb = ctx.docsButtons_('abc123', all, '04_재무(회비·장부·영수증)');
var flat = [].concat.apply([], kb.inline_keyboard);
assert.ok(flat.some(function (b) { return b.text === '✅ 04_재무' && b.callback_data === 'doc|abc123|4'; }) && flat[flat.length - 1].callback_data === 'doc|abc123|x');
assert.ok(flat.every(function (b) { return Buffer.byteLength(b.callback_data) <= 64; }));
assert.ok(flat.some(function (b) { return b.text === '동호회·골프회' && b.callback_data === 'doc|abc123|8'; }), '동호회 폴더 버튼(목록 맨 뒤 순번)');
assert.strictEqual(ctx.DOCS_FOLDERS[4].name, '04_재무(회비·장부·영수증)', '기존 폴더 순번은 그대로여야 함(버튼 값이 순번)');

// 라우터: 등록자만, 방 기능 확인
var users = [{ userId: '222', name: '가회장', title: '', role: '회장', active: true }, { userId: '555', name: '참관', title: '', role: '참관', active: true }];
ctx.authUsers_ = function () { return users; };
ctx.rooms_ = function () { return [{ chatId: '1', name: '회장단', type: '회장단' }, { chatId: '2', name: '임원', type: '임원' }, { chatId: '3', name: '동호회', type: '동호회' }]; };
var sent = []; ctx.tgSend_ = function (c, t, k) { sent.push({ t: t, k: k }); return { ok: true }; };
var cacheStore = {};
ctx.CacheService = { getScriptCache: function () { return { get: function (k) { return cacheStore[k] || null; }, put: function (k, v) { cacheStore[k] = v; }, remove: function (k) { delete cacheStore[k]; } }; } };
ctx.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
var n = 0; ctx.Utilities = { getUuid: function () { n++; return 'aaaaaaaa-bbbb-cccc-dddd-00000000000' + n; } };
var go = function (chat, uid, extra) { sent = []; var m = mk(chat, extra); m.from = { id: uid }; ctx.officeHandleMessage_(m); return sent; };
assert.strictEqual(go({ id: 999, type: 'private' }, 999, DOC).length, 0, '미등록자의 파일은 무시');
assert.ok(go({ id: 555, type: 'private' }, 555, DOC)[0].t.indexOf('권한이 없습니다') !== -1, '참관은 보관 불가');
var r1 = go(priv, 222, DOC);
assert.ok(r1.length === 1 && r1[0].t.indexOf('어느 폴더') !== -1 && r1[0].k.inline_keyboard.length >= 4, '1:1 파일 → 폴더 버튼');
assert.strictEqual(go({ id: 3, type: 'group' }, 222, { document: DOC.document, caption: '/보관' }).length, 0, '동호회 방은 보관 기능 없음');
assert.strictEqual(go({ id: 2, type: 'group' }, 222, { document: DOC.document }).length, 0, '표시 없는 파일은 그냥 둠');
var r2 = go({ id: 2, type: 'group' }, 222, { text: '/보관', reply_to_message: DOC });
assert.ok(r2.length === 1 && !JSON.stringify(r2[0].k).match(/04_재무|02_회원/), '임원방: 민감 폴더 버튼 없음');
// 앨범: 첫 장만 묻고 나머지는 같은 묶음
cacheStore = {};
go(priv, 222, { photo: PHOTO.photo, media_group_id: 'G9' });
var second = go(priv, 222, { photo: [{ file_id: 'L2', file_unique_id: 'uL2', file_size: 5 }], media_group_id: 'G9' });
assert.strictEqual(second.length, 0, '앨범 둘째 장부터는 다시 묻지 않음');
var pendKey = Object.keys(cacheStore).filter(function (k) { return /^DOC_/.test(k); })[0];
assert.strictEqual(JSON.parse(cacheStore[pendKey]).files.length, 2);

// 버튼: 올린 사람(또는 관리자)만, 허용된 폴더만
var saved = [], answers = [];
ctx.tgAnswerCallback_ = function (id, t) { answers.push(t); }; ctx.tgApi_ = function () { return { ok: true }; };
var realCb = ctx.docsHandleCallback_;
var shortId = pendKey.slice(4);
var press = function (uid, chat, pick) { answers = []; ctx.officeHandleCallback_({ id: 'c', from: { id: uid }, data: 'doc|' + shortId + '|' + pick, message: { message_id: 7, chat: chat } }); return answers; };
users.push({ userId: '333', name: '나재무', title: '', role: '재무이사', active: true });
assert.ok(press(333, priv, '1')[0].indexOf('올린 분이') !== -1, '다른 사람은 못 누름');
assert.ok(press(999, priv, '1')[0].indexOf('등록 전') !== -1);
cacheStore['DOC_zzz'] = JSON.stringify({ files: [ctx.docsPickFile_(DOC)], note: '', uploader: '222', chatId: 2 });
answers = []; ctx.officeHandleCallback_({ id: 'c', from: { id: 222 }, data: 'doc|zzz|4', message: { message_id: 7, chat: { id: 2, type: 'group' } } });
assert.ok(answers[0].indexOf('보관할 수 없습니다') !== -1, '임원방에서 재무 폴더 버튼을 위조해도 거부');
assert.ok(press(222, priv, 'x')[0].indexOf('취소') !== -1 && !cacheStore[pendKey], '취소하면 대기 삭제');
assert.ok(press(222, priv, '1')[0].indexOf('만료') !== -1, '이미 처리된 버튼');

console.log('✅ test-docs 통과 (' + dir + ')');
