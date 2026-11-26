// Stress test for the extension's auto answer and auto queue, run on mock-game.html?test (party) or ?daily&test.
// Results go to the page and to window.__results. To test a hidden tab, open another tab in front while it runs:
// the "hidden tab" step waits for that.
(async () => {
  const out = document.getElementById('results');
  const results = window.__results = { pass: 0, fail: 0, lines: [], done: false };
  const line = s => { results.lines.push(s); out.textContent = results.lines.join('\n'); };
  const check = (name, ok, detail = '') => { ok ? results.pass++ : results.fail++; line(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); };
  const wait = ms => wwait(ms);
  const waitFor = async (cond, ms) => { const end = performance.now() + ms; while (performance.now() < end) { if (cond()) return true; await wait(50); } return !!cond(); };
  const R = () => document.getElementById('krillion-solver').shadowRoot;
  const set = (id, v) => { const el = R().getElementById(id); if (el.type === 'checkbox') { el.checked = v; el.dispatchEvent(new Event('change')); } else { el.value = v; el.dispatchEvent(new Event('input')); } };
  const LOW_TO_HIGH = [...KrMatch.TIERS].reverse().map(t => t.id);
  const inRange = (tier, lo, hi) => { const i = LOW_TO_HIGH.indexOf(tier); return i >= lo && i <= hi; };
  const daily = location.search.includes('daily');

  await waitFor(() => document.getElementById('krillion-solver') && R().querySelector('.gem, .t'), 8000);
  line(`Krillion Solver auto answer test (${daily ? 'daily' : 'party'}), ${new Date().toLocaleTimeString()}`);

  if (daily) {
    set('from', 0); set('to', 5); set('speed', 5); set('mistakes', true); set('auto', true);
    for (const p of ['Name a power tool', 'Name a magazine', 'Name a country in Africa', 'Name a pasta shape']) {
      const n = game.log.length;
      await setPrompt(p);
      const t0 = performance.now();
      const sent = await waitFor(() => game.log.length > n, 15000);
      const l = game.log[game.log.length - 1];
      const first = game.inputs.find(i => i.t > t0);
      check(`daily "${p}" answered`, sent && l.ok, sent ? `"${l.v}" (${l.tier}) after ${((l.t - t0) / 1000).toFixed(1)}s` : 'nothing sent');
      check(`daily "${p}" waited 2s before typing`, !!first && first.t - t0 >= 1950, first ? `${((first.t - t0) / 1000).toFixed(2)}s` : 'no typing');
    }
    set('auto', false);
    const descend = document.querySelector('.ds-next-btn'); descend.hidden = false; set('queue', true);
    const c = game.clicks.length; await wait(4500);
    check('auto queue leaves the daily\'s Descend button alone', game.clicks.length === c);
    set('queue', false);
  } else {
    // 1. Many turns in a row, with other players answering in between.
    set('from', 3); set('to', 5); set('speed', 5); set('mistakes', false); set('auto', true);
    async function round(label, turns, check2) {
      let ok = 0, times = [];
      for (let i = 0; i < turns; i++) {
        const n = game.log.length;
        turn('me');
        const t0 = performance.now();
        const done = await waitFor(() => game.log.slice(n).some(l => l.ok), 15000);
        const tries = game.log.slice(n), good = tries.find(l => l.ok);
        if (done) { ok++; times.push(performance.now() - t0); }
        if (check2) check2(tries, good, i);
        turn('s1');
        const left = KrMatch.TIERS.flatMap(t => (game.sheet.tiers[t.id] || []).map(a => [a, t.id])).filter(([a]) => !game.used.has(KrMatch.norm(a)));
        const [a, tier] = left[Math.floor(Math.random() * left.length)];
        game.used.add(KrMatch.norm(a)); game.said.push(a); say('s1', a.toLowerCase(), tier);
        await wait(250);
      }
      const avg = times.length ? (times.reduce((x, y) => x + y, 0) / times.length / 1000).toFixed(2) : '-';
      check(`${label}: answered on every turn`, ok === turns, `${ok}/${turns}, average ${avg}s per turn`);
      return times;
    }
    let outOfRange = 0, repeats = 0;
    await round('25 turns, Rare to 1 in a Krillion, speed 5', 25, (tries, good) => {
      if (good && !inRange(good.tier, 3, 5)) outOfRange++;
      repeats += tries.filter(l => l.repeat).length;
    });
    check('every answer inside the tier range', outOfRange === 0, `${outOfRange} outside`);
    const caps = game.log.filter(l => l.v !== l.v.toLowerCase()).length;
    check('types everything in lowercase', caps === 0, `${caps} with capitals`);
    check('never repeats an answer when mistakes are off', repeats === 0, `${repeats} repeats`);

    // 2. Mistakes on: typos get fixed, rare repeats, never the answer just said.
    set('mistakes', true); set('from', 0); set('to', 5);
    let typos = 0, recent = 0, deliberate = 0;
    const before = game.inputs.length;
    await round('25 turns with mistakes on', 25, tries => {
      for (const l of tries.filter(x => x.repeat)) { deliberate++; if (l.lastTwo.map(KrMatch.norm).includes(KrMatch.norm(l.v))) recent++; }
    });
    for (let i = before + 1; i < game.inputs.length; i++) if (game.inputs[i].v.length < game.inputs[i - 1].v.length && game.inputs[i].v) typos++;
    check('typos are made and fixed', typos > 0, `${typos} backspaces`);
    check('repeats stay rare', deliberate <= 6, `${deliberate} in 25 turns`);
    check('never repeats the answer just said', recent === 0, `${recent} times`);
    set('mistakes', false);

    // 3. A new question: auto answer waits 2 seconds, then answers for the new question.
    for (const p of ['Name a magazine', 'Name a country in Africa']) {
      const n = game.log.length;
      await setPrompt(p);
      const t0 = performance.now();
      turn('me');
      const done = await waitFor(() => game.log.slice(n).some(l => l.ok), 15000);
      const first = game.inputs.find(i => i.t > t0);
      const good = game.log.slice(n).find(l => l.ok);
      check(`new question "${p}": answered`, done, good ? `"${good.v}"` : 'nothing');
      check(`new question "${p}": waited 2s`, !!first && first.t - t0 >= 1950, first ? `${((first.t - t0) / 1000).toFixed(2)}s` : 'no typing');
      turn('s1'); await wait(300);
    }

    // 4. The puffer moves on mid-typing: nothing is sent, and the next turn still works.
    set('speed', 1);
    let n = game.log.length;
    turn('me');
    await waitFor(() => box.value.length >= 2, 8000);
    turn('s2');
    await wait(2500);
    check('stops when the turn is lost mid-typing', game.log.length === n);
    set('speed', 5);
    n = game.log.length; turn('me');
    check('answers on the next turn after that', await waitFor(() => game.log.slice(n).some(l => l.ok), 15000));
    turn('s1'); await wait(300);

    // 5. Turned down by the server (say, a name it doesn't accept): tries again with another answer.
    n = game.log.length; game.rejectNext = 2; turn('me');
    const retried = await waitFor(() => game.log.slice(n).some(l => l.ok), 20000);
    check('tries again after being turned down', retried, `${game.log.slice(n).length} tries`);
    turn('s1'); await wait(300);

    // 6. Pre-type: types an answer while someone else holds the puffer, swaps it when they say it, sends it fast on your turn.
    set('pretype', true); set('mistakes', false); set('speed', 5);
    turn('s1');
    const onSheet = v => !!v && KrMatch.TIERS.some(t => (game.sheet.tiers[t.id] || []).some(a => a.toLowerCase() === v));
    const settled = async () => { let last = '', since = performance.now(); return waitFor(() => { if (box.value !== last) { last = box.value; since = performance.now(); } return onSheet(box.value) && performance.now() - since > 600; }, 10000); };
    const pre1 = await settled() && box.value;
    check('pre-type fills the box before your turn', !!pre1 && !document.querySelector('#me.hold'), pre1 ? `"${pre1}"` : 'box stayed empty');
    if (pre1) {
      const tier = KrMatch.TIERS.find(t => (game.sheet.tiers[t.id] || []).some(a => a.toLowerCase() === pre1)).id;
      game.used.add(KrMatch.norm(pre1)); game.said.push(pre1); say('s1', pre1, tier); // someone else says it first
      await waitFor(() => box.value !== pre1, 5000);
      const pre2 = await settled() && box.value;
      check('pre-type swaps the answer when someone says it first', !!pre2 && pre2 !== pre1, pre2 ? `"${pre1}" became "${pre2}"` : 'no new answer');
      const k = game.log.length, t0 = performance.now();
      turn('me');
      const sent = await waitFor(() => game.log.slice(k).some(l => l.ok), 8000);
      const l = game.log.slice(k).find(x => x.ok);
      check('pre-typed answer goes out fast on your turn', sent && l.v === pre2 && l.t - t0 < 1500, sent ? `"${l.v}" in ${((l.t - t0) / 1000).toFixed(2)}s` : 'nothing sent');
      turn('s1'); await wait(300);
    }
    set('pretype', false);

    // 7. Clicking an answer in the panel means you're taking over: auto answer switches off.
    set('auto', true);
    R().querySelector('.c').click();
    check('clicking an answer switches auto answer off', !R().getElementById('auto').checked);
    box.value = ''; set('auto', true);

    // 8. Auto queue clicks Play again once, and never New table.
    set('auto', false); set('queue', true);
    const [again, table] = document.querySelectorAll('.ds-next-btn');
    again.hidden = table.hidden = false;
    const c = game.clicks.length, t0 = performance.now();
    await waitFor(() => game.clicks.length > c, 6000);
    await wait(2000);
    const clicks = game.clicks.slice(c);
    check('auto queue clicks Play again', clicks.some(k => /again/i.test(k.text)), clicks.length ? `after ${((clicks[0].t - t0) / 1000).toFixed(1)}s` : 'no click');
    check('auto queue clicks it only once and never New table', clicks.length === 1 && !clicks.some(k => /table/i.test(k.text)), `${clicks.length} clicks`);
    again.hidden = table.hidden = true; set('queue', false); set('auto', true);

    // 9. Hidden tab: put another tab in front within 20 seconds.
    line('Waiting up to 20s for this tab to be hidden (open another tab in front)...');
    if (await waitFor(() => document.hidden, 20000)) {
      const times = await round('hidden tab, 10 turns', 10);
      const slow = times.filter(t => t > 6000).length;
      check('hidden tab: turns as fast as a visible tab', slow === 0, `${slow} slow turns, longest ${(Math.max(...times) / 1000).toFixed(1)}s`);
    } else line('SKIP hidden tab: the tab stayed in front');
  }
  set('auto', false);
  results.done = true;
  line(`\n${results.pass} passed, ${results.fail} failed`);
})();
