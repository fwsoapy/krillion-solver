// Extra prompts for your own copy of the extension only: .cache/p0rt1k/krillion.sql, a pg_dump from
// github.com/p0rt1k/krillion-answer-helper (classic-mode answers from playdaily.org). That dump has no license, so this
// writes only extension/data/extra.json (gitignored), never data/, and nothing of it is published.
// Prompts in the daily archive (data/index.json) are skipped: the archive's lists win. Run: node extra.js (node build.js runs it).
const fs = require('fs'), path = require('path');
const { TIERS, norm, promptKey } = require('./match.js');
const DUMP = path.join(__dirname, '.cache', 'p0rt1k', 'krillion.sql');
// The dump's value 0..5 is a tier from plankton (0) up to krillion (5): TIERS backwards. Checked against the 275 prompts it
// shares with the archive: 87.5% of shared answers agree (value 1 is rarely tooclever there; kept as the best fit anyway).
const TIER = TIERS.map(t => t.id).reverse();
// pg_dump text format: tab-separated, \N is null, backslash escapes.
const unesc = s => s === '\\N' ? null : s.replace(/\\(.)/g, (m, c) => ({ t: '\t', n: '\n', r: '\r' })[c] || c);

function extra() {
  if (!fs.existsSync(DUMP)) {
    console.log('No .cache/p0rt1k/krillion.sql: skipped extra prompts. To add them, save krillion.sql from github.com/p0rt1k/krillion-answer-helper there.');
    return;
  }
  const idx = path.join(__dirname, 'data', 'index.json');
  if (!fs.existsSync(idx)) throw new Error('no data yet: run node update.js first');
  const daily = new Set(JSON.parse(fs.readFileSync(idx, 'utf8')).flatMap(e => [e.t, e.a].filter(Boolean).map(promptKey)));
  const lines = fs.readFileSync(DUMP, 'utf8').split(/\r?\n/);
  const rows = head => {
    const i = lines.findIndex(l => l.startsWith(head)), out = [];
    if (i < 0) throw new Error(`krillion.sql: no "${head}" table`);
    for (let j = i + 1; j < lines.length && lines[j] !== '\\.'; j++) out.push(lines[j].split('\t').map(unesc));
    return out;
  };
  const answers = new Map(); // promptId -> [[text, value]] in the dump's order
  for (const [id, t, v] of rows('COPY public.answer ')) if (id && t && /^[0-5]$/.test(v || '')) (answers.get(id) || answers.set(id, []).get(id)).push([t, +v]);
  const byKey = new Map(); // promptKey -> { t, tiers, seen }: the same prompt twice in the dump becomes one
  for (const [id, t] of rows('COPY public.prompt ')) {
    const k = t && promptKey(t);
    if (!k || daily.has(k) || !answers.has(id)) continue;
    const e = byKey.get(k) || byKey.set(k, { t, tiers: {}, seen: new Set() }).get(k);
    for (const [a, v] of answers.get(id)) {
      const n = norm(a);
      if (!n || e.seen.has(n)) continue;
      e.seen.add(n); (e.tiers[TIER[v]] = e.tiers[TIER[v]] || []).push(a.trim());
    }
  }
  const out = [...byKey.values()].filter(e => e.seen.size).map(({ t, tiers }) => ({ t, tiers }));
  const file = path.join(__dirname, 'extension', 'data', 'extra.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  const n = out.reduce((s, e) => s + Object.values(e.tiers).reduce((s, l) => s + l.length, 0), 0);
  console.log(`extension/data/extra.json: ${out.length} extra prompts, ${n} answers (local only, not published).`);
}

module.exports = extra;
if (require.main === module) extra();
