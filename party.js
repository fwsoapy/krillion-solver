// Builds data/party.json, answers for Puffer Party prompts the daily archive lacks: node party.js, then node build.js.
// collector/sheet.json: { prompt: ["answer/T"] } from the collector sheet, T = K D R S T P (krillion down to plankton).
// collector/generated/*.json: { prompt: ["answer"] }, untiered, most common first.
// Out: [{ t: prompt, tiers: { krillion: [...] }, more: [untiered answers not in any tier] }], empty parts left out.
const fs = require('fs'), path = require('path');
const { TIERS, norm, promptKey } = require('./match.js');
const LETTER = { K: 'krillion', D: 'deepcut', R: 'rare', S: 'schooler', T: 'tooclever', P: 'plankton' };
const dir = path.join(__dirname, 'collector'), gen = path.join(dir, 'generated');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));

const byKey = new Map(); // promptKey -> { t, tiers, more, seen: norm(answer) set }
const get = t => {
  const k = promptKey(t);
  if (!byKey.has(k)) byKey.set(k, { t, tiers: {}, more: [], seen: new Set() });
  return byKey.get(k);
};
const sheet = fs.existsSync(path.join(dir, 'sheet.json')) ? read(path.join(dir, 'sheet.json')) : {};
for (const [t, list] of Object.entries(sheet)) {
  const p = get(t);
  for (const s of list) {
    const i = s.lastIndexOf('/'), a = s.slice(0, i).trim(), id = LETTER[s.slice(i + 1).trim()], k = norm(a);
    if (i < 0 || !id || !k || p.seen.has(k)) continue;
    p.seen.add(k); (p.tiers[id] = p.tiers[id] || []).push(a);
  }
}
const files = fs.existsSync(gen) ? fs.readdirSync(gen).filter(f => f.endsWith('.json')).sort() : [];
for (const f of files) for (const [t, list] of Object.entries(read(path.join(gen, f)))) {
  const p = get(t);
  for (const a of list) { const k = norm(a); if (k && !p.seen.has(k)) { p.seen.add(k); p.more.push(String(a).trim()); } }
}

const out = [...byKey.values()].map(({ t, tiers, more }) => ({
  t, ...(Object.keys(tiers).length ? { tiers: Object.fromEntries(TIERS.filter(x => tiers[x.id]).map(x => [x.id, tiers[x.id]])) } : {}), ...(more.length ? { more } : {}),
})).filter(p => p.tiers || p.more);
fs.writeFileSync(path.join(__dirname, 'data', 'party.json'), JSON.stringify(out));
const count = f => out.reduce((n, p) => n + f(p), 0);
console.log(`data/party.json: ${out.length} prompts, ${count(p => Object.values(p.tiers || {}).flat().length)} tiered answers, ${count(p => (p.more || []).length)} more (from sheet.json and ${files.length} generated files).`);
