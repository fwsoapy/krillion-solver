/** @OnlyCurrentDoc */
// Krillion Solver collector: a Google Apps Script web app, bound to a Google Sheet (see README.md).
// The extension POSTs { items: [{ prompt, answers: [{ answer, tier }] }] } as text/plain. Each valid answer becomes a row:
// time (set here), prompt, answer, tier (one of TIERS, or "wrong": turned down). Bad answers are skipped; a malformed or oversized request is turned down.
// A GET returns everything collected so far, read-only, in the shape of collector/sheet.json (see doGet).
const TIERS = ['krillion', 'deepcut', 'rare', 'schooler', 'tooclever', 'plankton'], LETTERS = 'KDRSTP';
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
      if (answer && (TIERS.indexOf(a.tier) >= 0 || a.tier === 'wrong')) rows.push([now, prompt, answer, a.tier]);
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

// { prompt: ["answer/T"] }, T = K D R S T P, or W: only ever turned down ("wrong"). One entry per answer (compared by
// norm), with the latest tier it got (rows are in time order); a tier beats W, so one bad report can't wipe a real
// answer. Prompt and answer text as first seen. The header row and malformed rows are skipped.
function doGet() {
  const prompts = new Map(), out = {};
  for (const [, p, a, tier] of SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].getDataRange().getValues()) {
    const t = String(p).trim(), answer = String(a).replace(/^'(?=[=+\-@])/, '').trim();
    const L = tier === 'wrong' ? 'W' : LETTERS[TIERS.indexOf(tier)];
    if (!L || !norm(t) || !norm(answer)) continue;
    if (!prompts.has(norm(t))) prompts.set(norm(t), { t, answers: new Map() });
    const answers = prompts.get(norm(t)).answers;
    if (!answers.has(norm(answer))) answers.set(norm(answer), { answer, L });
    const it = answers.get(norm(answer));
    if (L !== 'W' || it.L === 'W') it.L = L;
  }
  for (const { t, answers } of prompts.values()) out[t] = [...answers.values()].map(({ answer, L }) => answer + '/' + L);
  return reply(out);
}

// Same as norm in match.js: lowercase, no accents, "&" as "and", no apostrophes, other punctuation as spaces.
function norm(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
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
