/**
 * Remote.js — 개발자 원격 도구 (clasp run 전용)
 *
 * 이 함수들은 텔레그램 명령 표에 없으므로 웹훅으로는 닿을 수 없다. Apps Script 실행 API(매니페스트 executionApi: MYSELF)로
 * 스크립트 소유자의 구글 로그인을 거쳐야만 실행된다 → 외부에 새 구멍을 만들지 않고 개발자가 직접 점검·수정할 수 있다.
 *
 *   clasp run-function remotePing
 *   clasp run-function remoteSimulate -p '[{"message":{"text":"/recruit","from":{"id":123},"chat":{"id":123,"type":"private"}}}]'
 *   clasp run-function remoteSet -p '["창립일","2026-10-14"]'
 *   clasp run-function remoteWebhookInfo · remoteErrors -p '[20]' · remoteLog -p '[20]'
 *
 * 비밀값(토큰·웹훅 비밀값)은 어떤 함수도 반환하지 않는다.
 */

// 시트를 바꾸지 않는 명령 — remoteSimulate 가 기본으로 허용하는 범위
var REMOTE_READONLY_CMDS = ['/help', '/도움말', '/start', '/id', '/whoami', '/내권한', '/recruit', '/모집현황', '/recruitlist', '/모집명단',
  '/recruitcheck', '/모집점검', '/log', '/로그', '/rooms', '/방목록', '/form', '/양식', '/save', '/보관', '/edu', '/교육', '/schedule', '/일정'];

/**
 * 가상 실행: 텔레그램 업데이트를 실제 시트를 상대로 처리하되, **텔레그램으로는 아무것도 보내지 않고** 봇이 보냈을 내용을 돌려준다.
 * 시트를 바꾸는 명령·양식·버튼은 allowWrites=true 일 때만 실행한다(기본은 거부).
 */
function remoteSimulate(update, allowWrites) {
  if (typeof update === 'string') update = JSON.parse(update);
  var m = update.message, cq = update.callback_query;
  var text = m ? String(m.text || '').trim() : '', cmd = text.charAt(0) === '/' ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';
  var readOnly = !!m && !!cmd && REMOTE_READONLY_CMDS.indexOf(cmd) !== -1 && !(m.reply_to_message && docsIsCmd_(text));
  if (!readOnly && !allowWrites) return { refused: '시트를 바꿀 수 있는 요청입니다. 실제로 실행하려면 두 번째 인자를 true 로.', what: cmd || (cq ? '버튼' : '글/파일') };

  var out = [], keep = { send: tgSend_, api: tgApi_, ans: tgAnswerCallback_ };
  tgSend_ = function (chatId, body, kb) {
    out.push({ to: String(chatId), text: body, buttons: kb && kb.inline_keyboard ? kb.inline_keyboard.map(function (r) { return r.map(function (b) { return b.text + ' ⟶ ' + b.callback_data; }); }) : undefined });
    return { ok: true, result: { message_id: 0 } };
  };
  tgApi_ = function (method) { out.push({ api: method }); return { ok: true, result: {} }; };
  tgAnswerCallback_ = function (id, body) { out.push({ toast: body }); return { ok: true }; };
  var error = null;
  try { if (cq) handleCallback_(cq); else if (m) handleMessage_(m); }
  catch (e) { error = String(e && e.message || e) + '\n' + String(e && e.stack || '').slice(0, 600); }
  finally { tgSend_ = keep.send; tgApi_ = keep.api; tgAnswerCallback_ = keep.ans; }
  return { wrote: !readOnly, replies: out, error: error };
}

/** 설정 탭 값 변경(/set 과 같은 검증). 로그에는 '(원격)'으로 남는다 */
function remoteSet(key, value) {
  try { seedSettings_(); } catch (e) {}
  var sh = getOrCreateSheet_(getSS_(), SETTINGS_SHEET, SETTINGS_HEADERS), plan = settingsSetPlan_(sh.getDataRange().getValues(), key, value);
  if (plan.error) return plan;
  if (plan.before === plan.value) return { unchanged: plan.value };
  if (plan.row) sh.getRange(plan.row, 2).setNumberFormat('@').setValue(plan.value); else sh.appendRow([key, plan.value, '']);
  invalidateSettings_();
  audit_({ userId: '', name: '(원격) 개발자', role: '' }, '설정 변경', key, plan.before, plan.value, 'clasp run');
  return { key: key, before: plan.before, after: plan.value };
}

/** 텔레그램이 보는 웹훅 상태: 밀린 메시지 수, 마지막 오류. (주소는 호스트만) */
function remoteWebhookInfo() {
  var r = tgApi_('getWebhookInfo', {}), w = (r && r.result) || {};
  return { ok: !!(r && r.ok), host: String(w.url || '').replace(/^https?:\/\/([^\/]+).*$/, '$1'), pending: w.pending_update_count,
    lastError: w.last_error_message || '', lastErrorAt: w.last_error_date ? Utilities.formatDate(new Date(w.last_error_date * 1000), TZ, 'yyyy-MM-dd HH:mm:ss') : '',
    allowed: w.allowed_updates };
}

function remoteTail_(sheetName, headers, n) {
  var v = getOrCreateSheet_(getSS_(), sheetName, headers).getDataRange().getValues();
  return v.slice(1).slice(-(n || 20)).map(function (r) { return r.map(function (c) { return Object.prototype.toString.call(c) === '[object Date]' ? Utilities.formatDate(c, TZ, 'yyyy-MM-dd HH:mm:ss') : c; }); });
}
function remoteErrors(n) { return remoteTail_(ERRORS_SHEET, ERRORS_HEADERS, n); }
function remoteLog(n) { return remoteTail_(AUDIT_SHEET, AUDIT_HEADERS, n); }
