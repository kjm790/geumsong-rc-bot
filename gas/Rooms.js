/**
 * Rooms.js — 방(그룹) 등록과 방별 기능 ('방' 탭)
 *
 * 봇이 여러 방에 들어가 있어도 방마다 할 수 있는 일이 다르다.
 *  - 명령이 실행되려면 ①사용자 권한(Auth.js)과 ②그 방에 열린 기능, 둘 다 맞아야 한다.
 *  - 등록되지 않은 방에서는 조용히 있는다(/id 와 관리자의 /setroom 만 예외) → 누가 봇을 엉뚱한 방에 초대해도 아무 일도 안 일어남.
 *  - 봇과의 1:1 대화는 방 제한이 없다(사용자 권한만 본다).
 *  - 방 유형↔기능 대응표는 코드에 둔다(개인정보·재무가 어느 방에 나가는지는 시트 편집으로 바뀌면 안 되므로).
 */
var ROOMS_SHEET = '방';
var ROOMS_HEADERS = ['chat_id', '방 이름', '유형', '등록일', '비고'];

var ROOM_TYPES = {
  '회장단': { desc: '회장단 방 — 예비회원 추천 접수(개인정보)·명단·재무 승인·관리',
    feats: ['intake', 'docs', 'docs.notify', 'recruit.summary', 'recruit.names', 'edu', 'schedule', 'finance', 'admin', 'report.recruit'] },
  '임원':   { desc: '임원·이사회 방 — 교육·일정·모집 현황(숫자)·월 보고. 개인정보·명단은 나오지 않음',
    feats: ['docs', 'recruit.summary', 'edu', 'schedule', 'finance.report', 'report.recruit'] },
  '동호회': { desc: '동호회 방 — 행사 일정·참석 조사만',
    feats: ['schedule'] }
};

var _ROOMS = null;
function invalidateRooms_() { _ROOMS = null; }

/** 시트 값 → [{chatId, name, type}] (순수). 유형이 표에 없는 줄은 무시 */
function roomsParse_(values) {
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var id = String(values[i][0] === null || values[i][0] === undefined ? '' : values[i][0]).trim().replace(/\.0+$/, '');
    var type = String(values[i][2] || '').trim();
    if (/^-?\d+$/.test(id) && ROOM_TYPES[type]) out.push({ chatId: id, name: String(values[i][1] || '').trim(), type: type });
  }
  return out;
}
function rooms_() {
  if (_ROOMS) return _ROOMS;
  _ROOMS = roomsParse_(getOrCreateSheet_(getSS_(), ROOMS_SHEET, ROOMS_HEADERS).getDataRange().getValues());
  return _ROOMS;
}
function roomFind_(rooms, chatId) {
  for (var i = 0; i < rooms.length; i++) if (rooms[i].chatId === String(chatId)) return rooms[i];
  return null;
}

/** 이 대화에서 feature 가 열려 있는가(순수). 1:1 은 항상 true, 미등록 방은 항상 false */
function roomAllows_(rooms, chat, feature) {
  if (chat.type === 'private') return true;
  var r = roomFind_(rooms, chat.id);
  return !!r && ROOM_TYPES[r.type].feats.indexOf(feature) !== -1;
}
function roomsWithFeature_(rooms, feature) {
  return rooms.filter(function (r) { return ROOM_TYPES[r.type].feats.indexOf(feature) !== -1; });
}

/** /setroom 유형 — 관리자가 그 방 안에서 실행 */
function officeCmdSetRoom_(chat, user, text) {
  var type = (text.split(/\s+/)[1] || '').trim();
  var usage = '사용법: <code>/setroom 유형</code>\n' + Object.keys(ROOM_TYPES).map(function (t) { return '• <b>' + t + '</b> — ' + ROOM_TYPES[t].desc.split(' — ')[1]; }).join('\n');
  if (chat.type === 'private') { tgSend_(chat.id, '그룹방 안에서 실행해 주세요.\n' + usage); return; }
  if (!ROOM_TYPES[type]) {                                  // 유형을 안 적었으면 버튼으로 고르게 한다
    tgSend_(chat.id, '🚪 <b>이 방을 어떤 방으로 등록할까요?</b>\n' + usage.split('\n').slice(1).join('\n'),
      { inline_keyboard: [Object.keys(ROOM_TYPES).map(function (t) { return { text: t, callback_data: 'room:' + t }; })] });
    return;
  }
  roomRegister_(chat, user, type);
}

/** 방 등록/유형 변경(명령·버튼 공용). 권한 확인은 호출한 쪽 책임 */
function roomRegister_(chat, user, type) {
  var sh = getOrCreateSheet_(getSS_(), ROOMS_SHEET, ROOMS_HEADERS), data = sh.getDataRange().getValues(), row = 0, before = '';
  for (var i = 1; i < data.length; i++) if (String(data[i][0]).replace(/\.0+$/, '') === String(chat.id)) { row = i + 1; before = data[i][2]; break; }
  var title = chat.title || '';
  if (row) sh.getRange(row, 2, 1, 2).setValues([[title, type]]);
  else sh.appendRow([String(chat.id), title, type, todayStr_(), '']);
  invalidateRooms_();
  audit_(user, '방 등록', title || String(chat.id), before, type, '');
  tgSend_(chat.id, '✅ 이 방을 <b>' + type + '</b> 방으로 등록했습니다.\n' + ROOM_TYPES[type].desc.split(' — ')[1] + '\n\n/help 로 이 방에서 쓸 수 있는 명령을 확인하세요.');
}
