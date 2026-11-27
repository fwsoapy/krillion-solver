/** @OnlyCurrentDoc */
// Krillion Solver collector: a Google Apps Script web app, bound to a Google Sheet (see README.md).
// The extension POSTs { items: [{ prompt, answers: [{ answer, tier }] }] } as text/plain. Each valid answer becomes a row:
// time (set here), prompt, answer, tier. Bad answers are skipped; a malformed or oversized request is turned down.
const TIERS = ['krillion', 'deepcut', 'rare', 'schooler', 'tooclever', 'plankton'];
const MAX_BODY = 50000, MAX_ITEMS = 50, MAX_ANSWERS = 100, MAX_PROMPT = 200, MAX_ANSWER = 100;

function doPost(e) {
  const text = e && e.postData && e.postData.contents;
  if (!text || text.length > MAX_BODY) return reply({ ok: false, error: 'empty or too big' });
  let body;
  try { body = JSON.parse(text); } catch (err) { return reply({ ok: false, error: 'bad json' }); }
  const items = body && body.items;
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return reply({ ok: false, error: 'bad items' });

  const now = new Date(), rows = [];
  for (const it of items) {
    const prompt = clean(it && it.prompt, MAX_PROMPT);
    if (!prompt || !Array.isArray(it.answers)) continue;
    for (const a of it.answers) {
      const answer = clean(a && a.answer, MAX_ANSWER);
      if (answer && TIERS.indexOf(a.tier) >= 0) rows.push([now, prompt, answer, a.tier]);
    }
  }
  if (rows.length > MAX_ANSWERS) return reply({ ok: false, error: 'too many answers' });
  if (rows.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
      if (!sheet.getLastRow()) sheet.appendRow(['time', 'prompt', 'answer', 'tier']);
      const range = sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4);
      range.offset(0, 1, rows.length, 3).setNumberFormat('@'); // plain text, so "1984" stays an answer, not a number
      range.setValues(rows);
    } finally {
      lock.releaseLock();
    }
  }
  return reply({ ok: true, added: rows.length });
}

// A trimmed string no longer than max, or ''. Control characters go; a leading = + - @ gets a ' so Sheets never runs it as a formula.
function clean(s, max) {
  if (typeof s !== 'string') return '';
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s || s.length > max) return '';
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
