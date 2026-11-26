// Shared by the page, the extension and the scripts: tier info, text normalizing and prompt matching.
(() => {
  // Highest score first: the order the solver lists them in. Colors are the game's own.
  const TIERS = [
    { id: 'krillion', name: 'One in a Krillion', score: 100, color: '#ffd166', blurb: 'The designated gem. Trench floor.' },
    { id: 'deepcut', name: 'Deep Cut', score: 85, color: '#9d7bff', blurb: 'True obscurity. Few go this deep.' },
    { id: 'rare', name: 'Rare', score: 60, color: '#ff5252', blurb: 'Genuinely uncommon. Nice pull.' },
    { id: 'schooler', name: 'Schooler', score: 30, color: '#4de3ff', blurb: 'Solid. Swims with the school.' },
    { id: 'tooclever', name: 'Too Clever', score: 15, color: '#ff9f43', blurb: 'The famous "obscure" pick everyone reaches for.' },
    { id: 'plankton', name: 'Plankton', score: 10, color: '#8fa3c4', blurb: 'The answer everyone blurts out.' },
  ];

  // Lowercase, no accents, "&" as "and", punctuation as spaces.
  function norm(s) {
    return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // "Name a power tool" and "power tool" should match the same prompt.
  // Spoken or typed loosely: "movie" and "film" mean the same here.
  const SAME = { movie: "film", movies: "film", films: "film" };
  const promptKey = s => norm(s).replace(/^(name|give|list)( (a|an|any|one|the|some))? /, "").split(" ").map(w => SAME[w] || w).join(" ");

  function bigrams(s) {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); out.set(b, (out.get(b) || 0) + 1); }
    return out;
  }
  function dice(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const A = bigrams(a), B = bigrams(b);
    let hit = 0;
    for (const [k, n] of A) hit += Math.min(n, B.get(k) || 0);
    return (2 * hit) / (a.length - 1 + b.length - 1);
  }

  // 0..1: how well typed text matches a prompt. Exact = 1; the start of a prompt scores high so it works as you type.
  function score(query, prompt) {
    const q = promptKey(query), p = promptKey(prompt);
    if (!q) return 0;
    if (q === p) return 1;
    if (p.startsWith(q)) return 0.9 + 0.09 * (q.length / p.length);
    const qw = q.split(' '), pw = new Set(p.split(' '));
    const words = qw.filter(w => pw.has(w) || (w.length > 2 && [...pw].some(x => x.startsWith(w)))).length / qw.length;
    const covered = [...pw].filter(w => qw.includes(w)).length / pw.size; // how much of the prompt was said
    return 0.45 * words + 0.15 * covered + 0.4 * dice(q, p);
  }

  // Best matches for a query from the index, best first.
  function search(index, query, limit = 8) {
    return index.map(e => ({ e, s: Math.max(score(query, e.t), e.a ? score(query, e.a) : 0) }))
      .filter(r => r.s >= 0.35)
      .sort((a, b) => b.s - a.s || (a.e.d < b.e.d ? 1 : -1))
      .slice(0, limit);
  }

  // The tier an answer is in, or null. Exact match (ignoring case, accents and punctuation) only.
  function tierOf(tiers, answer) {
    const k = norm(answer);
    if (!k) return null;
    for (const t of TIERS) for (const a of tiers[t.id] || []) if (norm(a) === k) return { tier: t, answer: a };
    return null;
  }

  const api = { TIERS, norm, promptKey, score, search, tierOf };
  if (typeof module !== 'undefined') module.exports = api;
  globalThis.KrMatch = api;
})();
