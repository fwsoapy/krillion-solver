// node test.js: matching, merging and parsing, then checks every data file.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { TIERS, norm, search, tierOf } = require('./match.js');
const { parseMc, merge, familiarity, rankWith } = require('./update.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('norm', () => {
  assert.strictEqual(norm('  Ça Va & Rock’n’Roll! '), 'ca va and rocknroll');
  assert.strictEqual(norm('São Tomé and Príncipe'), norm('sao tome & principe'));
});

const index = [
  { d: '2026-09-30', n: 77, p: 4, t: 'Name a power tool', c: [1, 0, 0, 0, 0, 0], g: [] },
  { d: '2026-07-16', n: 1, p: 3, t: 'Name a pasta shape', c: [1, 0, 0, 0, 0, 0], g: [] },
  { d: '2026-07-16', n: 1, p: 4, t: 'Name a Pixar feature film', c: [1, 0, 0, 0, 0, 0], g: [] },
  { d: '2026-11-01', n: 109, p: 2, t: 'Name a movie from Pixar, DreamWorks Animation, Illumination, Disney Animation, Sony Pictures Animation or Blue Sky Studios', c: [1, 0, 0, 0, 0, 0], g: [] },
  { d: '2026-08-26', n: 42, p: 7, t: 'Name a holiday from anywhere in the world', a: 'Name a holiday celebrated around the world', c: [0, 0, 0, 0, 0, 0], g: [] },
];
ok('search: exact, partial, typo, alt wording', () => {
  assert.strictEqual(search(index, 'Name a power tool')[0].s, 1);
  assert.strictEqual(search(index, 'power tool')[0].e.p, 4);
  assert.strictEqual(search(index, 'pow')[0].e.p, 4);
  assert.strictEqual(search(index, 'name a powr tool')[0].e.p, 4);
  assert.strictEqual(search(index, 'holiday celebrated around the world')[0].s, 1);
  assert.strictEqual(search(index, 'zzzz qqqq').length, 0);
  assert.strictEqual(search(index, 'name a pixar movie')[0].e.t, 'Name a Pixar feature film'); // spoken: movie = film
});

ok('tierOf', () => {
  const tiers = { krillion: ['Kouprey'], plankton: ['Koala'], rare: ['Kudu'] };
  assert.strictEqual(tierOf(tiers, 'koala').tier.id, 'plankton');
  assert.strictEqual(tierOf(tiers, ' KOUPREY ').tier.score, 100);
  assert.strictEqual(tierOf(tiers, 'Kangaroo'), null);
});

ok('merge: main wins, extras add, gems promote, dupes drop', () => {
  const m = merge(
    { krillion: [], rare: ['Taiwan', 'Peru', 'peru'], plankton: ['Chile'] },
    { krillion: ['Peru'], deepcut: ['Macau', 'Taiwan'], plankton: ['Chile', 'Cuba'] });
  assert.deepStrictEqual(m.krillion, ['Peru']);
  assert.deepStrictEqual(m.rare, ['Taiwan']);
  assert.deepStrictEqual(m.deepcut, ['Macau']);
  assert.deepStrictEqual(m.plankton, ['Chile', 'Cuba']);
  assert.deepStrictEqual(Object.keys(m), TIERS.map(t => t.id));
});

ok('most common first: typed counts, then familiar words', () => {
  const freq = new Map([['drill', 10000], ['saw', 300000], ['air', 50000], ['tool', 40000], ['powder', 10000], ['it', 9e6]]);
  const fam = familiarity(freq);
  assert(fam('Saw') > fam('Drill'));
  assert(fam('Air tool') > fam('Powder-actuated tool'), 'an unknown word sinks the answer');
  assert(fam('It') > fam('It (1967)'), 'a bracketed year marks the lesser-known one');
  const rank = rankWith(freq, new Map([['drill', 500]]));
  assert.deepStrictEqual(merge({ schooler: ['Air tool', 'Saw', 'Drill', 'Zzzyx'] }, null, rank).schooler, ['Drill', 'Saw', 'Air tool', 'Zzzyx']);
});

ok('parseMc', () => {
  const html = `<h3 class="x">Name a <b>K</b> animal</h3>
    <div data-answer-scroll="true" role="region" aria-label="One in a Krillion answers"><ul><li>Kouprey<small>wild ox</small></li></ul></div>
    <div data-answer-scroll="true" role="region" aria-label="Plankton answers"><ul><li>Koala</li><li>Kangaroo &amp; joey</li></ul></div>
    <h3>Not a prompt</h3>`;
  assert.deepStrictEqual(parseMc(html), [{ text: 'Name a K animal', tiers: { krillion: ['Kouprey'], plankton: ['Koala', 'Kangaroo & joey'] } }]);
});

// Every file update.js wrote: 7 prompts a day, counts match the files, no answer in two tiers.
const DATA = path.join(__dirname, 'data');
if (fs.existsSync(path.join(DATA, 'index.json'))) ok('data files', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
  const days = new Map();
  for (const e of idx) days.set(e.d, (days.get(e.d) || 0) + 1);
  for (const [d, c] of days) assert.strictEqual(c, 7, `${d} has ${c} prompts`);
  for (const e of idx) {
    const f = JSON.parse(fs.readFileSync(path.join(DATA, e.d, `p${e.p}.json`), 'utf8'));
    assert.strictEqual(f.t, e.t);
    assert.deepStrictEqual(TIERS.map(t => f.tiers[t.id].length), e.c, `${e.d} p${e.p} counts`);
    assert.deepStrictEqual(f.tiers.krillion, e.g);
    const seen = new Set();
    for (const t of TIERS) for (const a of f.tiers[t.id]) { const k = norm(a); assert(!seen.has(k), `${e.d} p${e.p}: "${a}" twice`); seen.add(k); }
  }
  console.log(`   ${idx.length} prompts, ${days.size} days`);
});
console.log(`${n} checks passed`);
