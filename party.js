// Builds data/party.json, answers for Puffer Party prompts the daily archive lacks: node party.js, then node build.js.
// node party.js --fetch first replaces collector/sheet.json with the collector's live copy (a GET to CONTRIBUTE_URL in
// extension/sw.js). A failed fetch, a bad reply or one with over 10% fewer prompts keeps the old file and only warns.
// collector/sheet.json: { prompt: ["answer/T"] } from the collector sheet, T = K D R S T P (krillion down to plankton),
// or W: only ever turned down.
// collector/generated/*.json: { prompt: ["answer"] }, untiered, most common first.
// Out: [{ t: prompt, tiers: { krillion: [...] }, more: [untiered answers not in any tier], wrong: [W answers, in no tier
// or more] }], empty parts left out.
const fs = require('fs'), path = require('path');
const { TIERS, norm, promptKey } = require('./match.js');
const LETTER = { K: 'krillion', D: 'deepcut', R: 'rare', S: 'schooler', T: 'tooclever', P: 'plankton' };
const dir = path.join(__dirname, 'collector'), gen = path.join(dir, 'generated');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const sheetFile = path.join(dir, 'sheet.json');

async function fetchSheet() {
  try {
    const url = fs.readFileSync(path.join(__dirname, 'extension', 'sw.js'), 'utf8').match(/CONTRIBUTE_URL = '([^']+)'/)[1];
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j || typeof j !== 'object' || Array.isArray(j) || !Object.values(j).every(l => Array.isArray(l) && l.every(x => typeof x === 'string' && /\/[KDRSTPW]$/.test(x))))
      throw new Error('not { prompt: ["answer/T"] }');
    const had = fs.existsSync(sheetFile) ? Object.keys(read(sheetFile)).length : 0, got = Object.keys(j).length;
    if (got < had * 0.9) throw new Error(`${got} prompts, sheet.json has ${had}`);
    fs.writeFileSync(sheetFile, JSON.stringify(j));
    console.log(`collector/sheet.json: ${got} prompts from the collector.`);
  } catch (err) {
    console.warn(`Warning: kept collector/sheet.json, fetch failed: ${err.message}`);
  }
}

function build() {
  const byKey = new Map(); // promptKey -> { t, tiers, more, seen: norm(answer) set, wrong: norm(answer) -> answer }
  const get = t => {
    const k = promptKey(t);
    if (!byKey.has(k)) byKey.set(k, { t, tiers: {}, more: [], seen: new Set(), wrong: new Map() });
    return byKey.get(k);
  };
  const sheet = fs.existsSync(sheetFile) ? read(sheetFile) : {};
  for (const [t, list] of Object.entries(sheet)) {
    const p = get(t);
    for (const s of list) {
      const i = s.lastIndexOf('/'), a = s.slice(0, i).trim(), L = s.slice(i + 1).trim(), id = LETTER[L], k = norm(a);
      if (i >= 0 && k && L === 'W' && !p.wrong.has(k)) p.wrong.set(k, a);
      if (i < 0 || !id || !k || p.seen.has(k)) continue;
      p.seen.add(k); (p.tiers[id] = p.tiers[id] || []).push(a);
    }
  }
  const files = fs.existsSync(gen) ? fs.readdirSync(gen).filter(f => f.endsWith('.json')).sort() : [];
  for (const f of files) for (const [t, list] of Object.entries(read(path.join(gen, f)))) {
    const p = get(t);
    for (const a of list) { const k = norm(a); if (k && !p.seen.has(k)) { p.seen.add(k); p.more.push(String(a).trim()); } }
  }

  // collector/party-classic.json: { party prompt: classic prompt id }, the same question checked by hand. The official
  // sheet's tiers go first, then collected answers it lacks; more keeps only answers in no tier.
  const pcFile = path.join(dir, 'party-classic.json'), clFile = path.join(__dirname, 'data', 'classic.json');
  const pc = fs.existsSync(pcFile) ? read(pcFile) : {}, classic = fs.existsSync(clFile) ? read(clFile).prompts || {} : {};
  // collector/review/*.json: { party prompt: { remove: [answers], add: [answers] } }, checked by hand. Removed answers leave
  // more (never the tiers), whatever a generated file says; added ones join more if the entry lacks them.
  const rev = path.join(dir, 'review'), reviews = new Map(); // promptKey -> { remove: norm(answer) set, add: [answers] }
  for (const f of fs.existsSync(rev) ? fs.readdirSync(rev).filter(f => f.endsWith('.json')).sort() : []) {
    for (const [t, r] of Object.entries(read(path.join(rev, f)))) {
      const k = promptKey(t);
      if (!reviews.has(k)) reviews.set(k, { remove: new Set(), add: [] });
      const v = reviews.get(k);
      for (const a of Array.isArray(r && r.remove) ? r.remove : []) if (norm(a)) v.remove.add(norm(a));
      for (const a of Array.isArray(r && r.add) ? r.add : []) if (norm(a)) v.add.push(String(a).trim());
    }
  }
  let enriched = 0, removed = 0, added = 0;
  const out = [...byKey.values()].map(({ t, tiers, more, wrong }) => {
    const ok = a => !wrong.has(norm(a)); // W answers leave the tiers and more
    const off = (classic[pc[t]] || {}).tiers, inOff = new Set(off ? Object.values(off).flat().map(norm) : []);
    const ts = TIERS.map(x => [x.id, [...((off && off[x.id]) || []), ...(tiers[x.id] || []).filter(a => ok(a) && !inOff.has(norm(a)))]]).filter(([, l]) => l.length);
    if (off) { enriched++; const inT = new Set(ts.flatMap(([, l]) => l).map(norm)); more = more.filter(a => !inT.has(norm(a))); }
    more = more.filter(ok);
    const r = reviews.get(promptKey(t));
    if (r) {
      const n = more.length;
      more = more.filter(a => !r.remove.has(norm(a))); removed += n - more.length;
      const has = new Set([...ts.flatMap(([, l]) => l), ...more].map(norm));
      for (const a of r.add) { const k = norm(a); if (!has.has(k) && !r.remove.has(k) && ok(a)) { has.add(k); more.push(a); added++; } }
    }
    return { t, ...(off ? { src: 'classic' } : {}), ...(ts.length ? { tiers: Object.fromEntries(ts) } : {}), ...(more.length ? { more } : {}), ...(wrong.size ? { wrong: [...wrong.values()] } : {}) };
  }).filter(p => p.tiers || p.more || p.wrong);
  fs.writeFileSync(path.join(__dirname, 'data', 'party.json'), JSON.stringify(out));
  const count = f => out.reduce((n, p) => n + f(p), 0);
  console.log(`data/party.json: ${out.length} prompts, ${count(p => Object.values(p.tiers || {}).flat().length)} tiered answers, ${count(p => (p.more || []).length)} more, ${count(p => (p.wrong || []).length)} wrong (from sheet.json and ${files.length} generated files), ${enriched} with a classic answer sheet.`);
  if (reviews.size) console.log(`collector/review: ${removed} answers removed, ${added} added.`);
}

(process.argv.includes('--fetch') ? fetchSheet() : Promise.resolve()).then(build);
