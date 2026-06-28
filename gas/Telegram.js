/**
 * Telegram.js — 텔레그램 Bot API 호출 + 웹훅 관리
 */

function tgApi_(method, payload) {
  var url = 'https://api.telegram.org/bot' + getToken_() + '/' + method;
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var data;
  try { data = JSON.parse(res.getContentText()); }
  catch (e) { data = { ok: false, raw: res.getContentText() }; }
  if (!data.ok) Logger.log('TG ' + method + ' 실패: ' + res.getContentText());
  return data;
}

function tgSend_(chatId, text, replyMarkup) {
  var p = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (replyMarkup) p.reply_markup = replyMarkup;
  return tgApi_('sendMessage', p);
}

function tgAnswerCallback_(callbackId, text, showAlert) {
  var p = { callback_query_id: callbackId, text: text || '' };
  if (showAlert) p.show_alert = true;
  return tgApi_('answerCallbackQuery', p);
}

// ── 웹훅 관리 (배포 후 수동 실행) ─────────────────────────────
function setWebhook() {
  var url = getProp_('WEBHOOK_URL', true);
  var res = tgApi_('setWebhook', { url: url, allowed_updates: ['message', 'callback_query'] });
  Logger.log('setWebhook → ' + JSON.stringify(res));
  return res;
}

function deleteWebhook() {
  var res = tgApi_('deleteWebhook', { drop_pending_updates: false });
  Logger.log('deleteWebhook → ' + JSON.stringify(res));
  return res;
}

function getWebhookInfo() {
  var res = tgApi_('getWebhookInfo', {});
  Logger.log('getWebhookInfo → ' + JSON.stringify(res));
  return res;
}

function getMe() {
  var res = tgApi_('getMe', {});
  Logger.log('getMe → ' + JSON.stringify(res));
  return res;
}
