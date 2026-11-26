// Builds data/ from every daily dive: data/index.json (all prompts) and data/<date>/p<n>.json (every answer, by tier).
// Sources, merged per prompt:
//   krillion.run      full answer lists for each day (main source)
//   minutecryptic.today  fills answers and gems krillion.run is missing (its lists are cut short, so it only adds)
//   thewordfinder.com    used for a day krillion.run doesn't have
// Downloads go to .cache/ and are reused; the newest 2 days are always downloaded again because the sheets can still change.
// Run: node update.js
const fs = require('fs'), path = require('path');
const { TIERS, norm, score } = require('./match.js');

const ROOT = __dirname, CACHE = path.join(ROOT, '.cache'), OUT = path.join(ROOT, 'data');
const FIRST_DAY = '2026-07-16'; // dive #1
const UA = { 'User-Agent': 'Mozilla/5.0 (krillion-solver data update)' };
const IDS = TIERS.map(t => t.id);

const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const diveOf = d => Math.round((Date.parse(d) - Date.parse(FIRST_DAY)) / 864e5) + 1;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Cached download. Returns the text, or null when the source doesn't have that day.
async function get(file, url, fresh) {
  const p = path.join(CACHE, file);
  if (!fresh && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  await sleep(300); // be polite to the sources
  const res = await fetch(url, { headers: UA });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return text;
}

// ---- parsing ----
const MC_TIER = { 'One in a Krillion': 'krillion', 'Deep Cut': 'deepcut', 'Rare': 'rare', 'Schooler': 'schooler', 'Too Clever': 'tooclever', 'Plankton': 'plankton' };
const unescape = s => s.replace(/<[^>]+>/g, '').replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

// minutecryptic page -> [{ text, tiers }]
function parseMc(html) {
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>|data-answer-scroll="true"[^>]*aria-label="([^"]+) answers"[^>]*>([\s\S]*?)<\/ul>/g;
  const out = [];
  let cur = null, m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      const t = unescape(m[1]);
      if (/^name /i.test(t)) out.push(cur = { text: t, tiers: {} });
      continue;
    }
    const tier = MC_TIER[m[2]];
    if (cur && tier) cur.tiers[tier] = [...m[3].matchAll(/<li>([\s\S]*?)(?:<small>[\s\S]*?<\/small>)?<\/li>/g)].map(x => unescape(x[1]));
  }
  return out;
}

// thewordfinder page + its deep-cut sheet -> [{ text, tiers }]
function parseTwf(html, sheetText) {
  const m = html.match(/<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('thewordfinder: no ng-state');
  const day = Object.values(JSON.parse(m[1])).find(v => v && v.b && v.b.prompts);
  if (!day) throw new Error('thewordfinder: no prompts in ng-state');
  const sheet = sheetText ? JSON.parse(sheetText).prompts : [];
  return day.b.prompts.map(p => ({
    text: p.text,
    tiers: {
      ...p.tiers,
      krillion: [p.gem && p.gem.answer, ...(p.otherGems || []).map(g => g.answer || g)].filter(Boolean),
      deepcut: (sheet.find(s => s.id === p.id) || {}).deepcut || [],
    },
  }));
}

// ---- merging ----
// Main source wins; the other only adds answers the main one lacks. A gem from either source is kept as a gem.
function merge(main, extra) {
  const tiers = Object.fromEntries(IDS.map(id => [id, []]));
  const seen = new Map(); // norm(answer) -> tier id
  const add = (id, a) => {
    const k = norm(a);
    if (!k) return;
    const had = seen.get(k);
    if (had === undefined) { seen.set(k, id); tiers[id].push(a.trim()); return; }
    if (id === 'krillion' && had !== 'krillion') { // promote to gem
      tiers[had] = tiers[had].filter(x => norm(x) !== k);
      seen.set(k, id);
      tiers.krillion.push(a.trim());
    }
  };
  for (const id of IDS) for (const a of main[id] || []) add(id, a);
  if (extra) for (const id of IDS) for (const a of extra[id] || []) add(id, a);
  const sort = new Intl.Collator('en', { sensitivity: 'base', numeric: true }).compare;
  for (const id of IDS) tiers[id].sort(sort);
  return tiers;
}

// One day -> [{ t, alt?, tiers }] (7 prompts), or null when no source has it yet.
async function buildDay(date, fresh) {
  const runText = await get(`run/${date}.json`, `https://krillion.run/data/answers/${date}.json`, fresh);
  const mcHtml = await get(`mc/${date}.html`, `https://minutecryptic.today/krillion-answers/${date}`, fresh);
  let main = runText ? JSON.parse(runText).prompts.map(p => ({ text: p.text, tiers: p.tiers })) : null;
  if (!main) {
    const html = await get(`twf/${date}.html`, `https://www.thewordfinder.com/misc-solvers/krillion-answers/${date}/`, fresh);
    const sheet = html && await get(`twf/${date}.sheet.json`, `https://api.thewordfinder.com/krillion/${date}/sheet`, fresh);
    if (html && /"date":"\d{4}-\d\d-\d\d"/.test(html)) {
      const parsed = parseTwf(html, sheet);
      if (parsed.length) main = parsed;
    }
  }
  const mc = mcHtml ? parseMc(mcHtml) : [];
  if (!main && mc.length === 7) main = mc.map(p => ({ text: p.text, tiers: p.tiers })); // last resort: short lists
  if (!main) return null;
  return main.map((p, i) => {
    // Same day, same slot: the same prompt, even when a source words it a little differently.
    const other = mc.length === main.length ? mc[i] : null;
    if (other && score(other.text, p.text) < 0.6) console.warn(`  ${date} p${i + 1}: check wording: "${p.text}" vs "${other.text}"`);
    const out = { t: p.text, tiers: merge(p.tiers, other && other.tiers) };
    if (other && norm(other.text) !== norm(p.text)) out.alt = other.text; // the game may show either wording
    return out;
  });
}

async function main() {
  const today = todayET();
  const index = [];
  let days = 0;
  fs.rmSync(OUT, { recursive: true, force: true });
  for (let d = FIRST_DAY; d <= today; d = addDays(d, 1)) {
    const fresh = d >= addDays(today, -1);
    const prompts = await buildDay(d, fresh);
    if (!prompts) { console.warn(`  ${d}: not published yet`); continue; }
    days++;
    fs.mkdirSync(path.join(OUT, d), { recursive: true });
    prompts.forEach((p, i) => {
      if (!p.tiers.krillion.length) console.warn(`  ${d} p${i + 1}: no One in a Krillion answer in any source`);
      fs.writeFileSync(path.join(OUT, d, `p${i + 1}.json`), JSON.stringify({ t: p.t, tiers: p.tiers }));
      index.push({ d, n: diveOf(d), p: i + 1, t: p.t, ...(p.alt ? { a: p.alt } : {}), c: IDS.map(id => p.tiers[id].length), g: p.tiers.krillion });
    });
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  const answers = index.reduce((s, e) => s + e.c.reduce((a, b) => a + b, 0), 0);
  console.log(`wrote ${index.length} prompts from ${days} days (${answers.toLocaleString('en')} answers) to data/`);
}

module.exports = { parseMc, parseTwf, merge };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
