// Extra prompts for the extension's exact-match lookups and close-prompt guesses, written to extension/data/extra.json
// (gitignored). First data/classic.json (published; from playdaily.org's API by classic.js, with Krillion's permission),
// then, for your own copy only, answers from .cache/p0rt1k/krillion.sql, a pg_dump from github.com/p0rt1k/krillion-answer-helper:
// whole prompts classic.json lacks, and for prompts in both the dump answers classic.json lacks (the API returns ~10 per tier).
// Prompts match by id (classic.json keys are API ids, as are the dump's), else by promptKey. That dump has no license, so none of it goes into data/ or gets published.
// Prompts in the daily archive (data/index.json) are skipped: the archive's lists win. Run: node extra.js (node build.js runs it).
const fs = require('fs'), path = require('path');
const { TIERS, norm, promptKey } = require('./match.js');
const DUMP = path.join(__dirname, '.cache', 'p0rt1k', 'krillion.sql');
const CLASSIC = path.join(__dirname, 'data', 'classic.json');
const GEN = path.join(__dirname, 'collector', 'generated-classic');
// The dump's value 0..5 is a tier from plankton (0) up to krillion (5): TIERS backwards. Checked against the 275 prompts it
// shares with the archive: 87.5% of shared answers agree (value 1 is rarely tooclever there; kept as the best fit anyway).
const TIER = TIERS.map(t => t.id).reverse();
// pg_dump text format: tab-separated, \N is null, backslash escapes.
const unesc = s => s === '\\N' ? null : s.replace(/\\(.)/g, (m, c) => ({ t: '\t', n: '\n', r: '\r' })[c] || c);

function extra() {
  const hasClassic = fs.existsSync(CLASSIC), hasDump = fs.existsSync(DUMP);
  if (!hasClassic && !hasDump) {
    console.log('No data/classic.json (node classic.js makes it) and no .cache/p0rt1k/krillion.sql: skipped extra prompts.');
    return;
  }
  const idx = path.join(__dirname, 'data', 'index.json');
  if (!fs.existsSync(idx)) throw new Error('no data yet: run node update.js first');
  const daily = new Set(JSON.parse(fs.readFileSync(idx, 'utf8')).flatMap(e => [e.t, e.a].filter(Boolean).map(promptKey)));
  const byKey = new Map(); // promptKey -> { t, tiers, seen }: the same prompt twice becomes one
  const add = (t, list, k = t && promptKey(t)) => { // list: [[answer, tier id]]; returns how many answers were new
    if (!k || daily.has(k)) return 0;
    let added = 0;
    const e = byKey.get(k) || byKey.set(k, { t, tiers: {}, seen: new Set() }).get(k);
    for (const [a, tier] of list) {
      const n = norm(a);
      if (!n || e.seen.has(n)) continue;
      e.seen.add(n); (e.tiers[tier] = e.tiers[tier] || []).push(String(a).trim()); added++;
    }
    return added;
  };
  const classicKey = new Map(); // API prompt id -> promptKey of classic.json's text
  if (hasClassic) for (const [id, e] of Object.entries(JSON.parse(fs.readFileSync(CLASSIC, 'utf8')).prompts || {})) {
    if (e.t) classicKey.set(id, promptKey(e.t));
    add(e.t, TIERS.flatMap(t => (e.tiers[t.id] || []).map(a => [a, t.id])));
  }
  const fromClassic = byKey.size, inClassic = new Set(byKey.keys());
  let fromDump = 0; // dump answers added to prompts classic.json has
  if (hasDump) {
    const lines = fs.readFileSync(DUMP, 'utf8').split(/\r?\n/);
    const rows = head => {
      const i = lines.findIndex(l => l.startsWith(head)), out = [];
      if (i < 0) throw new Error(`krillion.sql: no "${head}" table`);
      for (let j = i + 1; j < lines.length && lines[j] !== '\\.'; j++) out.push(lines[j].split('\t').map(unesc));
      return out;
    };
    const answers = new Map(); // promptId -> [[text, tier]] in the dump's order
    for (const [id, t, v] of rows('COPY public.answer ')) if (id && t && /^[0-5]$/.test(v || '')) (answers.get(id) || answers.set(id, []).get(id)).push([t, TIER[+v]]);
    for (const [id, t] of rows('COPY public.prompt ')) {
      if (!t || !answers.has(id)) continue;
      const k = classicKey.get(id) || promptKey(t), n = add(t, answers.get(id), k);
      if (inClassic.has(k)) fromDump += n;
    }
  }
  // collector/generated-classic/*.json ({ classic id: [answers] }): answers in no tier go in "more", like party.json's.
  let fromGen = 0;
  if (fs.existsSync(GEN)) for (const f of fs.readdirSync(GEN).filter(f => f.endsWith('.json')).sort())
    for (const [id, list] of Object.entries(JSON.parse(fs.readFileSync(path.join(GEN, f), 'utf8')))) {
      const e = byKey.get(classicKey.get(id));
      if (!e || !Array.isArray(list)) continue;
      for (const a of list) {
        const n = norm(a);
        if (n && !e.seen.has(n)) { e.seen.add(n); (e.more = e.more || []).push(String(a).trim()); fromGen++; }
      }
    }
  const out = [...byKey.values()].filter(e => e.seen.size).map(({ t, tiers, more }) => more ? { t, tiers, more } : { t, tiers });
  const file = path.join(__dirname, 'extension', 'data', 'extra.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  const n = out.reduce((s, e) => s + Object.values(e.tiers).reduce((s, l) => s + l.length, 0), 0);
  console.log(`extension/data/extra.json: ${out.length} extra prompts (${fromClassic} from classic.json, ${byKey.size - fromClassic} from the local dump only), ${n} answers (${fromDump} added from the dump to classic.json prompts, ${fromGen} unrated from collector/generated-classic).`);
}

module.exports = extra;
if (require.main === module) extra();
