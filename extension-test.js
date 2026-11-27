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
    check('no filter box in the panel', !R().querySelector('input[type=search], #f'));

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

    // 5b. Your own answer counts as said only once the game accepts it.
    set('auto', false); turn('me');
    const saidRow = () => [...R().querySelectorAll('.said-row s')].map(s => s.textContent);
    const fresh = KrMatch.TIERS.flatMap(t => game.sheet.tiers[t.id] || []).filter(a => !game.used.has(KrMatch.norm(a)));
    const enter = v => { box.value = v; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); };
    game.rejectNext = 1; enter(fresh[0]); await wait(400);
    check('a turned-down answer is not hidden as already said', !saidRow().includes(fresh[0].toLowerCase()), `"${fresh[0]}"`);
    enter(fresh[1]); await wait(400);
    check('an accepted answer is hidden as already said', saidRow().includes(fresh[1].toLowerCase()), `"${fresh[1]}"`);
    turn('s1'); set('auto', true); await wait(300);

    // 5c. Range One in a Krillion only and the gem already said: the closest tier outside the range, Deep Cut.
    set('from', 5); set('to', 5);
    for (const gem of game.sheet.tiers.krillion || []) { game.used.add(KrMatch.norm(gem)); say('s1', gem.toLowerCase(), 'krillion'); await wait(300); }
    n = game.log.length; turn('me');
    const fb = await waitFor(() => game.log.slice(n).some(l => l.ok), 15000) && game.log.slice(n).find(l => l.ok);
    check('gem said, range One in a Krillion only: types a Deep Cut answer', !!fb && fb.tier === 'deepcut', fb ? `"${fb.v}" (${fb.tier})` : 'nothing');
    turn('s1'); set('from', 0); set('to', 5); await wait(300);

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
    // 6b. An opponent's answer turned down, then your turn: the pre-typed answer goes out at once. A turn that comes
    // mid-pre-type finishes it and sends it. A new question deletes what pre-type typed, never your own text.
    turn('s1');
    let pre = await settled() && box.value;
    say('s1', 'not on the list', null, 'bad'); await wait(300);
    let k = game.log.length, t1 = performance.now(); turn('me');
    let sent = await waitFor(() => game.log.length > k, 3000) && game.log[k];
    check('opponent turned down, then your turn: the pre-typed answer goes out within 1s', !!pre && !!sent && sent.ok && sent.v === pre && sent.t - t1 < 1000, sent ? `"${sent.v}" in ${((sent.t - t1) / 1000).toFixed(2)}s` : 'nothing sent');
    turn('s1'); set('speed', 1);
    await waitFor(() => box.value.length >= 2, 10000);
    const part = box.value; k = game.log.length; turn('me');
    sent = await waitFor(() => game.log.slice(k).some(l => l.ok), 10000) && game.log.slice(k).find(l => l.ok);
    check('your turn comes mid-pre-type: it finishes and sends it', !!sent && part.length >= 2 && sent.v.startsWith(part) && game.log.length === k + 1, sent ? `"${part}" became "${sent.v}"` : 'nothing sent');
    set('speed', 5); turn('s1'); pre = await settled() && box.value;
    await setPrompt('Name a pasta shape');
    check('a new question deletes the pre-typed answer at once', !!pre && await waitFor(() => !box.value, 1500), `"${pre}", box "${box.value}"`);
    set('pretype', false); set('auto', false); await wait(300);
    box.value = 'my own text'; await setPrompt('Name a magazine'); await wait(1500);
    check('a new question leaves your own text alone', box.value === 'my own text', `"${box.value}"`);
    box.value = ''; set('auto', true);

    // 7. Clicking an answer in the panel means you're taking over: auto answer switches off.
    set('auto', true);
    R().querySelector('.c').click();
    check('clicking an answer switches auto answer off', !R().getElementById('auto').checked);
    box.value = ''; set('auto', true);

    // 8. Auto queue: Play again once per game end after a moment, never New table; Take a seat only on the idle-kick screen.
    set('auto', false); set('queue', true);
    const [again, table] = document.querySelectorAll('.ds-next-btn');
    const st = () => R().getElementById('st').textContent;
    const secs = ms => `${(ms / 1000).toFixed(1)}s`;
    // Shows a screen, collects the clicks it gets (waiting `ms` for the first, then 2s more), then hides it.
    const clicksOn = async (show, hide, ms = 6000) => {
      const c = game.clicks.length, t0 = performance.now();
      show();
      await waitFor(() => game.clicks.length > c, ms);
      await wait(2000);
      const clicks = game.clicks.slice(c), status = st();
      hide(); await wait(400);
      return { clicks, after: clicks.length ? clicks[0].t - t0 : 0, status };
    };
    const showEnd = () => { again.hidden = table.hidden = false; }, hideEnd = () => { again.hidden = table.hidden = true; };
    let q = await clicksOn(showEnd, hideEnd);
    check('auto queue clicks Play again', q.clicks.some(k => /again/i.test(k.text)), q.clicks.length ? `after ${secs(q.after)}` : 'no click');
    check('auto queue waits a moment before clicking', q.after >= 1400, secs(q.after));
    check('auto queue clicks it only once and never New table', q.clicks.length === 1 && !q.clicks.some(k => /table/i.test(k.text)), `${q.clicks.length} clicks`);
    check('status moves on from "Queuing again" once clicked', !/queuing again/i.test(q.status), `"${q.status}"`);

    again.disabled = true;
    q = await clicksOn(showEnd, () => {}, 3500);
    check('auto queue leaves a disabled Play again alone', q.clicks.length === 0, `${q.clicks.length} clicks`);
    again.disabled = false;
    q = await clicksOn(() => {}, hideEnd);
    check('auto queue clicks Play again once it enables', q.clicks.length === 1 && /again/i.test(q.clicks[0].text), `${q.clicks.length} clicks`);

    let each = [];
    for (let i = 0; i < 3; i++) each.push((await clicksOn(showEnd, hideEnd)).clicks.length);
    check('auto queue queues every game end in a row', each.join() === '1,1,1', `clicks per game end: ${each.join(', ')}`);

    showEnd(); await wait(600); const waiting = st(); hideEnd(); await wait(400);
    check('status doesn\'t stay on "Queuing again" when Play again goes away first', /queuing again/i.test(waiting) && !/queuing again/i.test(st()), `"${waiting}" then "${st()}"`);

    q = await clicksOn(() => kick('you'), () => {});
    const seated = !!document.querySelector('.pf-seat.me') && document.querySelector('.pf-kick').hidden;
    check('idle-kick screen: clicks Take a seat once, after a moment', q.clicks.length === 1 && /take a seat/i.test(q.clicks[0].text) && q.after >= 1400, `${q.clicks.length} clicks, after ${secs(q.after)}`);
    check('idle-kick screen: back in a seat, status moved on', seated && !/taking a seat/i.test(st()), `seated ${seated}, "${st()}"`);
    seat();
    q = await clicksOn(() => kick(''), seat, 4500);
    check('idle-kick screen with an empty name: Take a seat left alone', q.clicks.length === 0, `${q.clicks.length} clicks`);
    q = await clicksOn(() => kick('you', false), seat, 4500);
    check('lobby join screen (no kick message): Take a seat left alone', q.clicks.length === 0, `${q.clicks.length} clicks`);

    // 8b. The room filled up after an idle kick: off to the lobby, Quick Play once, never Rated or Leave room.
    sessionStorage.clear(); game.went = [];
    const lobby = document.querySelector('.lobby');
    q = await clicksOn(() => kick('you', false, true), seat, 4500);
    check('a full room you opened yourself: no Quick Play', q.clicks.length === 0 && !game.went.length, `${q.clicks.length} clicks, ${game.went.length} lobby trips`);
    game.full = true;
    set('queue', true); // status back to "Off." (it still says "Took a seat." from the kick above)
    const statuses = new Set(); let watching = true;
    (async () => { while (watching) { statuses.add(st()); await wait(50); } })();
    q = await clicksOn(() => kick('you'), () => { lobby.hidden = lobby.querySelector('p').hidden = true; game.full = false; seat(); });
    watching = false;
    const texts = q.clicks.map(k => k.text.trim());
    check('kick, take a seat, room full: Quick Play clicked once, Rated never', texts.length === 2 && /take a seat/i.test(texts[0]) && texts[1] === 'QUICK PLAY' && game.went.length === 1, `${texts.join(', ')}; went to ${game.went.join(', ')}`);
    check('still in a room: Leave room left alone, status says so', !texts.some(t => /leave|rated/i.test(t)) && /still in a room/i.test(q.status), `"${q.status}"`);
    check('status not left on "Took a seat." when not seated', statuses.has('Clicked Quick Play.') && !statuses.has('Took a seat.'), [...statuses].join(' | '));

    set('queue', false);
    q = await clicksOn(() => { showEnd(); kick('you'); }, () => { hideEnd(); seat(); }, 4500);
    check('auto queue off: neither button clicked', q.clicks.length === 0, `${q.clicks.length} clicks`);

    // 9. Contribute answers: off sends nothing; on sends each new party answer once as { prompt, answers }, retrying a failure.
    check('contribute off: nothing sent at game end', game.posts.length === 0, `${game.posts.length} requests`);
    set('auto', false); set('contribute', true); game.postFail = true;
    await setPrompt('Name a mock party thing'); await wait(400);
    say('s1', 'Glowfish', 'rare'); await wait(300); say('s2', '=SUM(1)', 'plankton'); await wait(300);
    const end = async () => { again.hidden = false; await wait(500); again.hidden = true; await wait(300); };
    await end();
    check('contribute: sends at game end', game.posts.length === 1, `${game.posts.length} requests`);
    game.postFail = false; await end();
    const want = [{ prompt: 'Name a mock party thing', answers: [{ answer: 'Glowfish', tier: 'rare' }, { answer: '=SUM(1)', tier: 'plankton' }] }];
    check('contribute: retries after a failure, payload is prompt + answers only', JSON.stringify(game.posts[1]) === JSON.stringify(want), JSON.stringify(game.posts[1]));
    say('s1', 'Glowfish', 'rare'); await wait(300); await end();
    check('contribute: each answer goes out once', game.posts.length === 2, `${game.posts.length} requests`);
    await setPrompt('Name a magazine'); await wait(400);
    say('s1', 'Mock Monthly', 'rare'); await wait(300);
    const seen = saidRow().includes('Mock Monthly'); await end();
    check('contribute: nothing sent for a prompt with a daily list', seen && game.posts.length === 2, `seen ${seen}, ${game.posts.length} requests`);
    await setPrompt('Name a mock party thing'); await wait(400);
    for (let i = 0; i < 30; i++) { say('s1', `Mock thing ${i}a`, 'rare'); say('s2', `Mock thing ${i}b`, 'rare'); await wait(250); }
    await end();
    const drained = await waitFor(() => game.posts.length >= 4, 8000);
    const sizes = game.posts.slice(2).map(p => p.reduce((n, it) => n + it.answers.length, 0));
    check('contribute: more than 50 answers drain in batches without the 5 minute wait', drained && sizes.join() === '50,10', `batches ${sizes.join(', ')}`);

    // 9b. A prompt with no list: auto answer guesses from the 3 closest daily lists, most common first, 2 tries from each,
    // at most 2 a turn, never one turned down again, gives up after 5 turned down; only an accepted guess is contributed.
    const near = window.__idx.find(x => x.t === 'Name a power tool');
    const tools = await (await fetch(`data/${near.d}/p${near.p}.json`)).json();
    const flat = l => LOW_TO_HIGH.flatMap(id => (l.tiers[id] || []).map(a => a.toLowerCase())); // most common first
    await setPrompt('Name a mock power tool brand'); game.sheet = tools; await wait(1500);
    const posts = game.posts.length;
    n = game.log.length; game.rejectNext = 1; set('auto', true); turn('me');
    const guessed = await waitFor(() => game.log.slice(n).some(l => l.ok), 15000);
    const tries = game.log.slice(n).map(l => l.v), hit = game.log.slice(n).find(l => l.ok);
    turn('s1'); set('auto', false); await wait(400);
    check('no list: guesses the closest daily list\'s most common answers first', guessed && tries.join() === flat(tools).slice(0, 2).join(), tries.join(', '));
    check('the guess list stays out of the panel', !R().querySelector('.c, .gem') && /party-only/i.test(R().querySelector('.meta').textContent), R().querySelector('.meta').textContent);
    await end();
    const gWant = hit && [{ prompt: 'Name a mock power tool brand', answers: [{ answer: hit.v, tier: 'plankton' }] }];
    check('contribute sends the accepted guess, nothing else from the guess list', game.posts.length === posts + 1 && JSON.stringify(game.posts[posts]) === JSON.stringify(gWant), JSON.stringify(game.posts.slice(posts)));
    set('contribute', false);
    // Guessing budget: 2 from each of the 3 close lists in order, all in one turn if need be, then it gives up; a turn that
    // ends early leaves the rest for the next one. An accepted answer on a close list (anyone's) locks guessing to that
    // list, with no limit. A new prompt starts over.
    const closeLists = p => Promise.all(KrMatch.search(window.__idx, p, 3).map(async m => flat(await (await fetch(`data/${m.e.d}/p${m.e.p}.json`)).json())));
    const budget = ls => { const out = []; for (const l of ls) for (const v of l) { if (l.filter(x => out.includes(x)).length >= 2) break; if (!out.includes(v)) out.push(v); } return out; };
    const myTurn = async (stop, linger = 0) => { // one turn of yours, until stop(tries) or 20s
      const k0 = game.log.length; turn('me');
      await waitFor(() => stop(game.log.slice(k0)), 20000); await wait(linger);
      const t = game.log.slice(k0); turn('s1'); await wait(400); return t;
    };
    const gave = t => t.length > 0 && st() === 'No good guess.';
    const gp = 'Name a mock pasta sauce shop', gl = await closeLists(gp);
    await setPrompt(gp); await wait(1500); set('auto', true); // nothing accepted
    const gt = (await myTurn(gave, 1500)).map(l => l.v), gSt = st();
    check('all wrong: 6 guesses in one turn, 2 from each close list in order, then it gives up', gt.length === 6 && gt.join() === budget(gl).join() && gSt === 'No good guess.', `${gt.join(', ')}; "${gSt}"`);
    const pp = 'Name a pasta sauce', pl = await closeLists(pp);
    await setPrompt(pp); await wait(1500);
    const c1 = (await myTurn(t => t.length >= 3)).map(l => l.v), c2 = (await myTurn(gave, 1500)).map(l => l.v);
    check('the 6 guesses carry over to the next turn', c1.length === 3 && [...c1, ...c2].join() === budget(pl).join(), `${c1.join(', ')} | ${c2.join(', ')}`);
    const lp = 'Name a mock pasta sauce', [lA, lB] = await closeLists(lp);
    await setPrompt(lp); game.accept = v => lB.includes(v) && !lA.includes(v); await wait(1500);
    const got = (await myTurn(t => t.some(l => l.ok))).find(l => l.ok);
    game.accept = () => false;
    const after = (await myTurn(t => t.length >= 7)).map(l => l.v);
    check('a guess from the 2nd close list accepted: only that list after, past 6 misses', !!got && after.length >= 7 && after.every(v => lB.includes(v)), `"${got && got.v}", then ${after.join(', ')}`);
    const cp = 'Name a mock pasta sauce dish', [cA, cB, cC] = await closeLists(cp);
    await setPrompt(cp); await wait(1500);
    const cOnly = cC.find(v => !cA.includes(v) && !cB.includes(v));
    say('s2', cOnly, 'plankton'); await wait(400);
    const ct = (await myTurn(t => t.length >= 3)).map(l => l.v);
    check('another player\'s accepted answer on the 3rd close list locks to it', ct.length >= 3 && ct.every(v => cC.includes(v)), `"${cOnly}", then ${ct.join(', ')}`);
    const rp = 'Name a mock pasta or sauce', [rA] = await closeLists(rp);
    await setPrompt(rp); await wait(1500);
    const rt = (await myTurn(t => t.length >= 1)).map(l => l.v);
    check('a new prompt clears the lock', rt[0] === rA[0], `${rt.join(', ')} (first close list starts "${rA[0]}")`);
    set('auto', false);

    // 9c. A prompt with a letter pattern: only guesses that fit it, none if nothing fits; no status left over.
    const booE = window.__idx.find(x => x.t === 'Name a word that starts with “boo”');
    const boo = await (await fetch(`data/${booE.d}/p${booE.p}.json`)).json();
    const oneTurn = async (p, list) => {
      await setPrompt(p); game.sheet = list; box.value = ''; await wait(1500); // box: drop what a cut-off guess left
      const n0 = game.log.length, i0 = game.inputs.length; turn('me'); await wait(4000); turn('s1');
      return { tries: game.log.slice(n0).map(l => l.v), typed: game.inputs.length - i0, status: st() };
    };
    set('auto', true);
    let g = await oneTurn('Name an English word starting with “scr”', boo);
    check('"starting with “scr”", closest list has no "scr" words: the word list answers', g.tries.length && g.tries.every(v => v.startsWith('scr')), `${g.tries.join(', ')}; "${g.status}"`);
    await setPrompt('Name an English word starting with “boot”'); game.sheet = boo; game.accept = v => v.startsWith('boot'); await wait(1500);
    n = game.log.length; game.rejectNext = 1; turn('me');
    await waitFor(() => game.log.slice(n).some(l => l.ok), 15000);
    const boots = game.log.slice(n).map(l => l.v);
    check('"starting with “boot”": guesses only words that fit', boots.length === 2 && boots.every(v => v.startsWith('boot')), boots.join(', '));
    const me = document.getElementById('me'); me.classList.add('out'); await wait(400);
    const outSt = st(); me.classList.remove('out');
    check('your seat out: status not left on the last answer', outSt === 'On.', `"${outSt}"`);
    turn('me'); await waitFor(() => /^Guessing/.test(st()), 8000);
    const mid = st(); turn('s1'); await setPrompt('Name a power tool'); await wait(400);
    check('prompt changes mid-guess: status not left on "Guessing"', /^Guessing/.test(mid) && st() === 'On.', `"${mid}" then "${st()}"`);
    const real = chrome.runtime.sendMessage; // the closest list for -graphy: power tools instead, none of them fit
    chrome.runtime.sendMessage = (msg, cb) => real(msg.type === 'prompt' ? { type: 'prompt', d: near.d, p: near.p } : msg, cb);
    g = await oneTurn('Name a word ending in -graphy', tools);
    chrome.runtime.sendMessage = real;
    check('"ending in -graphy" read as a pattern: a -graphy word, no power tool', g.tries.length && g.tries.every(v => v.endsWith('graphy')), g.tries.join(', '));

    // 9d. Word prompts with no list: the word list answers (2 guesses a turn, a turned-down word never again), the panel
    // lists the words, and contribute sends only words the game accepted.
    const wordsBox = () => [...R().querySelectorAll('.t')].find(s => s.querySelector('h3').textContent === 'Words');
    set('contribute', true);
    const wPosts = game.posts.length, wLog = game.log.length;
    await setPrompt('Name an English word containing “bio”'); game.accept = v => v.includes('bio'); await wait(1500);
    n = game.log.length; turn('me');
    await waitFor(() => game.log.slice(n).some(l => l.ok), 15000);
    const bio = game.log.slice(n).map(l => l.v); turn('s1'); await wait(400); // the bubble gets read before the prompt changes
    check('"containing “bio”": types a word with "bio" in it', bio.length === 1 && bio[0].includes('bio'), bio.join(', '));
    await setPrompt('Name a word with “zz” in it'); await wait(1500); // nothing accepted
    const zz = (await myTurn(t => t.length >= 5)).map(l => l.v);
    check('word list: keeps trying past 2 in one turn, a turned-down word not retried', zz.length >= 5 && new Set(zz).size === zz.length && zz.every(v => v.includes('zz')), zz.join(', '));
    chrome.runtime.sendMessage = (msg, cb) => (msg.type === 'prompt' ? cb({ data: { tiers: {} } }) : real(msg, cb)); // no list to guess from
    await setPrompt('Name a country starting with “B”'); game.accept = () => true; await wait(1500);
    n = game.log.length; turn('me'); await wait(4000); turn('s1');
    chrome.runtime.sendMessage = real;
    const bTries = game.log.slice(n).map(l => l.v);
    check('"Name a country starting with “B”": word list not used', !bTries.length && !wordsBox(), bTries.join(', '));
    await end();
    const okWords = game.log.slice(wLog).filter(l => l.ok).map(l => l.v);
    const sentWords = game.posts.slice(wPosts).flatMap(p => p.flatMap(it => it.answers.map(a => a.answer)));
    check('contribute: only the accepted word goes out', okWords.length === 1 && sentWords.join() === okWords.join(), sentWords.join(', '));
    set('contribute', false); set('auto', false);
    await setPrompt('Name an English word with bio in it'); await wait(1500);
    const ws = wordsBox(), chip = ws && ws.querySelector('.c'), w = chip && chip.textContent;
    if (chip) chip.click();
    check('panel: a Words section of 20, clicking one types it', !!chip && ws.querySelectorAll('.c').length === 20 && !!ws.querySelector('.more') && box.value === w && w.includes('bio'), `"${w}", box "${box.value}"`);
    box.value = ''; say('s1', w, 'plankton'); await wait(400);
    check('panel: a word said is crossed off', !!wordsBox() && ![...wordsBox().querySelectorAll('.c')].some(c => c.textContent === w));
    await setPrompt('Name a word ending in -graphy'); await wait(1500); // not an archive prompt (the -graphy one is)
    const graphy = wordsBox() ? [...wordsBox().querySelectorAll('.c')].map(c => c.textContent) : [];
    check('a blocked word is never listed or typed', graphy.length > 3 && !graphy.includes('pornography') && !game.inputs.some(i => i.v.includes('pornograph')), graphy.join(', '));
    // Word prompts: letter counts, length, double letters, no vowels; only the word list, never a close daily list; a
    // prompt it can't read: nothing.
    set('auto', true);
    const wordTurn = async (p, ok) => {
      await setPrompt(p); game.accept = ok; box.value = ''; await wait(1500);
      const k0 = game.log.length, i0 = game.inputs.length; turn('me');
      await waitFor(() => game.log.slice(k0).some(l => l.ok), 6000); await wait(300); turn('s1'); await wait(400);
      return { tries: game.log.slice(k0).map(l => l.v), typed: game.inputs.length - i0 };
    };
    for (const [p, ok] of [['Name an English word with three or more S\'s', v => v.split('s').length > 3], ['Name a 10-letter word', v => v.length === 10],
      ['Name an English word with a double “o”', v => v.includes('oo')], ['Name an English word with no vowels', v => !/[aeiou]/.test(v)]]) {
      const r = await wordTurn(p, ok);
      check(`"${p}": types a word that fits`, r.tries.length === 1 && ok(r.tries[0]), r.tries.join(', '));
    }
    const r0 = await wordTurn('Name an English word that sounds like a sneeze', () => true);
    check('a word prompt it can\'t read: nothing typed', !r0.tries.length && !r0.typed, `${r0.tries.join(', ')}; ${r0.typed} keys`);
    set('auto', true);

    // 9e. Whole games back to back with auto answer, pre-type and auto queue on, opponents sometimes turned down: every one
    // of your turns sends an answer, and every game end gets Play again.
    set('pretype', true); set('queue', true);
    let myTurns = 0, mySends = 0, ends = 0;
    for (const p of ['Name a magazine', 'Name a country in Africa', 'Name a pasta shape', 'Name a power tool']) {
      await setPrompt(p); turn('s1'); await wait(2500);
      for (let i = 0; i < 5; i++) {
        for (const s of ['s1', 's2']) {
          turn(s); await wait(500 + Math.random() * 1500);
          const left = KrMatch.TIERS.flatMap(t => (game.sheet.tiers[t.id] || []).map(a => [a, t.id])).filter(([a]) => !game.used.has(KrMatch.norm(a)));
          const [a, tier] = left[Math.floor(Math.random() * left.length)];
          if (Math.random() < 0.3) say(s, 'not on the list', null, 'bad');
          else { game.used.add(KrMatch.norm(a)); game.said.push(a); say(s, a.toLowerCase(), tier); }
        }
        k = game.log.length; turn('me'); myTurns++;
        if (await waitFor(() => game.log.slice(k).some(l => l.ok), 8000)) mySends++;
        await wait(200);
      }
      const c = game.clicks.length; again.hidden = false;
      if (await waitFor(() => game.clicks.length > c, 5000)) ends++;
      again.hidden = true; await wait(300);
    }
    check('whole games: every one of your turns sends, every game end queues again', mySends === myTurns && ends === 4, `${mySends}/${myTurns} turns, ${ends}/4 game ends`);
    set('pretype', false); set('queue', false);
    await setPrompt('Name a power tool'); await wait(400);

    // 10. Hidden tab: put another tab in front within 20 seconds.
    line('Waiting up to 20s for this tab to be hidden (open another tab in front)...');
    if (await waitFor(() => document.hidden, 20000)) {
      const times = await round('hidden tab, 10 turns', 10);
      const slow = times.filter(t => t > 6000).length;
      check('hidden tab: turns as fast as a visible tab', slow === 0, `${slow} slow turns, longest ${(Math.max(...times) / 1000).toFixed(1)}s`);
    } else line('SKIP hidden tab: the tab stayed in front');
  }
  set('auto', false);

  // Panel size: small by default; a size from the corner handle is kept in settings.size; double-click on the title resets it.
  const P = () => R().querySelector('.p'), size = () => `${P().offsetWidth} x ${P().offsetHeight}`;
  check('panel default size at most 300 x 520', P().offsetWidth <= 300 && P().offsetHeight <= 520, size());
  P().style.width = '260px'; P().style.height = '300px'; await wait(700); // what the corner handle does
  P().style.width = P().style.height = ''; dispatchEvent(new Event('resize')); await wait(100); // put back from settings
  const kept = store.settings.size;
  check('a resized panel keeps its size in settings.size and gets it back', !!kept && kept.w === 260 && kept.h === 300 && size() === '260 x 300', `${JSON.stringify(kept)}, ${size()}`);
  R().querySelector('.bar').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await wait(700);
  check('double-click on the title resets the size', !store.settings.size && !P().style.width && P().offsetWidth === 300, size());

  // The extension reloaded under this page: every chrome.* call throws. The old copy stops for good, quietly, and says so.
  const errs = [], stText = () => R().getElementById('st').textContent;
  addEventListener('error', e => errs.push(e.message)); addEventListener('unhandledrejection', e => errs.push(String(e.reason)));
  const gone = () => { throw new Error('Extension context invalidated.'); };
  Object.assign(chrome.runtime, { id: undefined, sendMessage: gone }); Object.assign(chrome.storage.local, { get: gone, set: gone });
  set('auto', true); set('speed', 5); if (!daily) turn('me');
  const i0 = game.inputs.length, l0 = game.log.length, c0 = game.clicks.length;
  await wait(3000);
  check('extension reloaded: no errors, nothing typed or clicked, status says to reload', !errs.length && game.inputs.length === i0 && game.log.length === l0 && game.clicks.length === c0 && stText() === 'Extension reloaded. Reload this page.',
    `${errs.join('; ')}; ${game.inputs.length - i0} keys, ${game.log.length - l0} sent; "${stText()}"`);
  results.done = true;
  line(`\n${results.pass} passed, ${results.fail} failed`);
})();
