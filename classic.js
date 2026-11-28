// Classic-mode answer sheets from playdaily.org's API, used with Krillion's permission (at most 1,200 requests an hour).
// Keeps data/classic.json: { lap, prompts: { [id]: { t, level, mode, tiers, at } } }. Each deal hands out prompts with
// tickets; a ticket unlocks its prompt's answers about a minute later. The saved `lap` tells the server which prompts this
// client has seen, so deals keep giving new ones until the lap is done. New prompts are fetched first, then sheets older
// than a week. Run: node classic.js [--minutes 30] [--max N]. The update job runs it every 3 hours.
const fs = require('fs'), path = require('path');
const { TIERS, norm } = require('./match.js');
const API = 'https://playdaily.org/api/krillion/';
const UA = 'krillion-solver (+https://github.com/fwsoapy/krillion-solver)';
const FILE = path.join(__dirname, 'data', 'classic.json');
const GAP = 3000; // ms between any two requests
const LOCK = 65000; // a ticket's answers open ~52-65 s after the deal; earlier asks get 425 { wait }
const STALE = 7 * 864e5; // refresh sheets older than this
const DRY = 10; // deals in a row with nothing to fetch: classic moves on to endless, endless ends the run
const TIER = TIERS.map(t => t.id).reverse(); // API value 0..5 = plankton..krillion
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const MINUTES = arg('--minutes', 30), MAX = arg('--max', Infinity);
const deadline = Date.now() + MINUTES * 6e4;
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

const db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { prompts: {} };
function save() {
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
  fs.renameSync(FILE + '.tmp', FILE);
}
// Prompt ids already known from the local p0rt1k dump (same API): only to show how many are left, never its answers.
const known = new Set(Object.keys(db.prompts));
const DUMP = path.join(__dirname, '.cache', 'p0rt1k', 'krillion.sql');
if (fs.existsSync(DUMP)) {
  const sql = fs.readFileSync(DUMP, 'utf8'), i = sql.indexOf('COPY public.prompt ');
  if (i >= 0) for (const m of sql.slice(i, sql.indexOf('\n\\.', i)).matchAll(/^(\w+)\t/gm)) known.add(m[1]);
}

// One request, at least GAP after the last. Waits on { wait } (not counted as a try); other errors retry with back-off,
// then give up with null. Also null once out of time or requests.
let last = 0, used = 0;
async function req(url, opts = {}) {
  for (let tries = 0; ;) {
    await sleep(last + GAP - Date.now());
    if (Date.now() > deadline || used >= MAX) return null;
    last = Date.now(); used++;
    try {
      const r = await fetch(API + url, { ...opts, headers: { 'user-agent': UA, ...opts.headers }, signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      const wait = j.wait || (r.headers.get('retry-after') || 0) * 1000;
      if (wait > 0) { await sleep(wait + 1000); continue; }
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (++tries >= 3) { console.warn(`  ${url.split('?')[0]}: ${e.message}, skipped`); return null; }
      await sleep(GAP * 2 ** tries);
    }
  }
}

async function main() {
  const queue = []; // { p, ticket, mode, ready }
  let mode = 'classic', run, dry = 0, dealing = true, fetched = 0, answers = 0;
  const progress = () => console.log(`fetched ${Object.keys(db.prompts).length}/${known.size} prompts, ${answers} answers this run (${used} requests)`);
  while (Date.now() < deadline && used < MAX) {
    // Ready tickets first: never-fetched prompts, then the oldest sheet.
    const ready = queue.filter(q => q.ready <= Date.now());
    if (ready.length) {
      const at = q => db.prompts[q.p.id] ? Date.parse(db.prompts[q.p.id].at) : -Infinity;
      const q = ready.reduce((a, b) => at(b) < at(a) ? b : a);
      queue.splice(queue.indexOf(q), 1);
      const j = await req(`answers?prompt=${encodeURIComponent(q.p.id)}&ticket=${encodeURIComponent(q.ticket)}`);
      if (!j || !Array.isArray(j.answers) || !j.answers.length) continue;
      const tiers = Object.fromEntries(TIERS.map(t => [t.id, []])), seen = new Set();
      for (const [v, a] of j.answers) {
        const n = norm(a);
        if (!n || seen.has(n) || !TIER[v]) continue;
        seen.add(n); tiers[TIER[v]].push(String(a).trim());
      }
      const old = db.prompts[q.p.id];
      db.prompts[q.p.id] = { t: q.p.text, ...(q.p.cat ? { cat: q.p.cat } : {}), ...(q.p.level != null ? { level: q.p.level } : {}), mode: old ? old.mode : q.mode, tiers, at: new Date().toISOString() };
      answers += seen.size;
      if (++fetched % 25 === 0) { save(); progress(); }
      continue;
    }
    // Deal while tickets are few and there is time to use them.
    if (dealing && queue.length < 28 && deadline - Date.now() > LOCK + 30000) {
      const j = await req('deal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, lap: db.lap, ...(run ? { run } : {}) }) });
      if (!j) { console.warn('deal failed: stopped dealing'); dealing = false; continue; }
      if (j.lap) db.lap = j.lap;
      if (j.run) run = j.run;
      const got = j.prompts ? j.prompts.map(p => [p, j.tickets && j.tickets[p.id]]) : [[j.prompt, j.ticket]];
      let n = 0;
      for (const [p, ticket] of got) {
        if (!p || !p.id || !p.text || !ticket) continue;
        known.add(p.id);
        const e = db.prompts[p.id];
        if ((e && Date.now() - Date.parse(e.at) < STALE) || queue.some(q => q.p.id === p.id)) continue;
        queue.push({ p, ticket, mode, ready: Date.now() + LOCK }); n++;
      }
      dry = n ? 0 : dry + 1;
      if (dry >= DRY) {
        dry = 0;
        if (mode === 'classic') { mode = 'endless'; console.log('classic deals have nothing new: trying endless'); }
        else { dealing = false; console.log('endless deals have nothing new: done dealing'); }
      }
      continue;
    }
    if (!queue.length) break;
    await sleep(Math.min(...queue.map(q => q.ready)) - Date.now());
  }
  save(); progress();
}

for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { save(); console.log(`stopped by ${s}, saved`); process.exit(0); });
// Never fails the scheduled job: whatever went wrong, what was fetched so far is saved.
main().catch(e => { console.error(e); try { save(); } catch {} process.exit(0); });
