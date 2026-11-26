// Krillion Solver panel, for the daily dive and Puffer Party.
// - Reads the prompt (both modes show it in .prompt), finds it in the daily archive and lists every answer, gem first.
// - Crosses off answers already said: in Puffer Party every accepted answer shows in that player's bubble (.pf-say with
//   class "ok", then "rest"); yours count as soon as you press Enter in the answer box. Resets when the prompt changes.
// - Party has prompts the daily archive doesn't. Every accepted answer seen in your games is saved with its tier (the
//   bubble's --cc color), so a prompt you've seen before has a list next time.
// - Auto answer (off until you switch it on): on your turn it picks a random unused answer from your tier range and types it
//   one key at a time, then presses Enter. It waits until a new question has been up 2 seconds. "Make mistakes" adds
//   typos it fixes and, rarely, first tries an answer said earlier (never the latest ones).
// - Auto queue (off until you switch it on): clicks "Play again" when a party game ends.
// - Works in a hidden tab: waits go through the service worker, which Chrome doesn't slow down.
(() => {
if (globalThis.__krSolver) return;
globalThis.__krSolver = true;
const { TIERS, norm, promptKey, search } = KrMatch;
const LOW_TO_HIGH = [...TIERS].reverse();                 // Plankton first: the order of the range pickers
const SURE = 0.75;                                       // match score needed to pick an archive prompt by itself
const FIRST = 20;                                        // answers shown per tier, and added by each "Show more"
const KEY_MS = [300, 220, 160, 110, 70];                 // average time per key, speed 1 (slow) to 5 (fast)
const THINK_MS = [1500, 1100, 750, 480, 260];            // pause before starting to type
const READ_MS = 2000;                                    // a new question stays up this long before auto answer types
const SHORT = 22;                                        // auto answer prefers answers this long or shorter (the puffer pops fast)
const ICON = id => `https://krillion.io/tiers/${id}.png`;

let INDEX = null, promptText = '', entry = null, sheet = null, ver = 0;
let filter = '', closed = false, collapsed = false, opened = false, busy = false;
let used = new Map();                                    // norm(answer) -> answer as said
let stale = new WeakMap();                               // bubble -> its text when the prompt changed (left over, not about this prompt)
let learned = {};                                        // promptKey -> { norm(answer): [answer, tier] }
let settings = { auto: false, from: 3, to: 5, speed: 3, mistakes: false, queue: false }; // from/to index LOW_TO_HIGH
let promptAt = 0;                                        // when the current question appeared
const shown = {};                                        // tier id -> answers shown

const ask = msg => new Promise((ok, fail) => chrome.runtime.sendMessage(msg, r =>
  chrome.runtime.lastError ? fail(new Error(chrome.runtime.lastError.message)) : r && r.error ? fail(new Error(r.error)) : ok(r.data)));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const isShown = el => el.offsetParent !== null || el.getClientRects().length > 0;
// Chrome slows timers in a hidden tab to once a second or less, which would make typing crawl. The service worker
// isn't slowed, so while this tab is hidden every wait goes through it.
const localSleep = ms => new Promise(r => setTimeout(r, ms));
const sleep = ms => (document.hidden ? ask({ type: 'sleep', ms }).catch(() => localSleep(ms)) : localSleep(ms));
const rand = a => a[Math.floor(Math.random() * a.length)];
let saveTimer = 0;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => chrome.storage.local.set({ settings, learned }), 400); };

// ---- panel ----
const host = document.createElement('div');
host.id = 'krillion-solver';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>
  :host { all: initial; }
  .p { --abyss:#050a14; --deep:#0a1426; --shallow:#101d33; --line:#1b2c47; --line-hi:#2c4168; --foam:#e8f1ff; --drift:#9aaccb; --pink:#ff5d8f;
    --krillion:#ffd166; --deepcut:#9d7bff; --rare:#ff5252; --schooler:#4de3ff; --tooclever:#ff9f43; --plankton:#8fa3c4;
    --pixel: VT323, ui-monospace, monospace; --body: system-ui, "Segoe UI", sans-serif;
    position: fixed; top: 76px; right: 14px; z-index: 2147483646; width: 330px; max-height: calc(100vh - 96px);
    display: flex; flex-direction: column; background: rgba(5,10,20,.96); color: var(--foam); border: 1px solid var(--line-hi);
    border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.55); font: 14px/1.4 var(--body); }
  .p[hidden] { display: none; }
  * { box-sizing: border-box; }
  button, input, select { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--pink); outline-offset: 2px; }
  img { image-rendering: pixelated; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 10px; border-bottom: 1px solid var(--line); cursor: grab; touch-action: none; user-select: none; }
  .p.drag { box-shadow: 0 24px 60px rgba(0,0,0,.65); }
  .p.drag .bar { cursor: grabbing; }
  .bar img { width: 26px; height: 26px; }
  .bar b { font: 400 22px/1 var(--pixel); flex: 1; }
  .bar b span { color: var(--krillion); }
  .ib { width: 30px; height: 30px; display: grid; place-items: center; background: none; border: 1px solid transparent; border-radius: 6px; cursor: pointer; color: var(--drift); }
  .ib:hover { background: var(--shallow); border-color: var(--line); color: var(--foam); }
  .auto { padding: 10px 12px; border-bottom: 1px solid var(--line); display: grid; gap: 8px; }
  .auto.on { background: rgba(255,93,143,.07); }
  .sw { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; user-select: none; }
  .sw.main { font-weight: 700; }
  .sw input { appearance: none; -webkit-appearance: none; margin: 0; flex: none; position: relative; width: 36px; height: 20px; border-radius: 999px;
    background: var(--line-hi); cursor: pointer; transition: background-color .15s ease; }
  .sw input::before { content: ""; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--foam);
    box-shadow: 0 1px 2px rgba(0,0,0,.4); transition: transform .18s cubic-bezier(.3,.7,.4,1); }
  .sw input:checked { background: var(--pink); }
  .sw input:checked::before { transform: translateX(16px); }
  .sw:hover input:not(:checked) { background: #3a5280; }
  .field { display: grid; gap: 6px; }
  .lbl { color: var(--drift); font-size: 13px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .lbl b { color: var(--foam); font: 400 18px/1 var(--pixel); white-space: nowrap; }
  .range { position: relative; height: 20px; --lo: 3; --hi: 5; }
  .rtrack { position: absolute; left: 9px; right: 9px; top: 8px; height: 4px; border-radius: 2px; background: var(--line-hi); }
  .rfill { position: absolute; top: 0; bottom: 0; border-radius: 2px; background: var(--pink);
    left: calc(100% * var(--lo) / 5); right: calc(100% * (5 - var(--hi)) / 5); }
  .range input { position: absolute; inset: 0; width: 100%; height: 20px; margin: 0; background: none; pointer-events: none; appearance: none; -webkit-appearance: none; }
  input[type=range]::-webkit-slider-runnable-track { height: 20px; background: none; }
  input[type=range]::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; pointer-events: auto; width: 18px; height: 18px; margin-top: 1px;
    border-radius: 50%; background: var(--foam); border: 3px solid var(--pink); cursor: grab; transition: transform .12s ease; }
  input[type=range]:active::-webkit-slider-thumb { cursor: grabbing; transform: scale(1.15); }
  input[type=range]:focus-visible { outline: none; }
  input[type=range]:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px rgba(255,93,143,.45); }
  .ricons { display: flex; justify-content: space-between; }
  .ricons img { width: 18px; height: 18px; cursor: pointer; transition: opacity .15s ease; }
  .ricons img.off { opacity: .3; }
  input.one { width: 100%; height: 20px; margin: 0; appearance: none; -webkit-appearance: none; background: none; cursor: pointer; }
  input.one::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; margin: 8px 0;
    background: linear-gradient(90deg, var(--pink) var(--p, 50%), var(--line-hi) var(--p, 50%)); }
  input.one::-webkit-slider-thumb { margin-top: -7px; }
  .body { scrollbar-width: thin; scrollbar-color: var(--line-hi) transparent; }
  .body::-webkit-scrollbar { width: 8px; }
  .body::-webkit-scrollbar-thumb { background: var(--line-hi); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
  .body::-webkit-scrollbar-thumb:hover { background-color: var(--drift); }
  .body::-webkit-scrollbar-track { background: transparent; }
  input[type=search]::-webkit-search-cancel-button { appearance: none; -webkit-appearance: none; width: 14px; height: 14px; cursor: pointer;
    background: linear-gradient(45deg, transparent 43%, var(--drift) 43%, var(--drift) 57%, transparent 57%), linear-gradient(-45deg, transparent 43%, var(--drift) 43%, var(--drift) 57%, transparent 57%); }
  @media (prefers-reduced-motion: reduce) { .sw input, .sw input::before, input[type=range]::-webkit-slider-thumb { transition: none; } }
  .st { margin: 0; color: var(--drift); font-size: 12.5px; }
  .p.min .body, .p.min .auto { display: none; }
  .body { overflow-y: auto; padding: 10px 12px 12px; display: grid; gap: 10px; }
  .q { font: 400 22px/1.05 var(--pixel); margin: 0; }
  .meta { margin: 2px 0 0; color: var(--drift); font-size: 12.5px; }
  .gem { display: grid; grid-template-columns: 44px 1fr; gap: 10px; align-items: center; padding: 10px; border: 2px solid var(--krillion); border-radius: 8px;
    background: linear-gradient(135deg, rgba(255,209,102,.16), rgba(255,209,102,.02)); }
  .gem img { width: 44px; height: 44px; }
  .gem small { color: var(--krillion); font-size: 12px; display: block; }
  .gem .none { color: var(--drift); font-size: 13px; }
  .gem button { font: 400 28px/1 var(--pixel); color: var(--krillion); background: none; border: 0; padding: 0; cursor: pointer; text-align: left; overflow-wrap: anywhere; margin-right: 10px; }
  .gem button:hover { text-decoration: underline; }
  .gem button.said { color: var(--drift); text-decoration: line-through; }
  .f { width: 100%; padding: 7px 10px; background: var(--deep); border: 1px solid var(--line-hi); border-radius: 6px; }
  .f:focus { outline: none; border-color: var(--pink); }
  .said-row { color: var(--drift); font-size: 12.5px; margin: 0; }
  .said-row s { color: var(--foam); }
  .t h3 { display: flex; align-items: center; gap: 7px; margin: 0 0 6px; font: 400 20px/1 var(--pixel); color: var(--t); }
  .t h3 img { width: 22px; height: 22px; }
  .t h3 em { font-style: normal; margin-left: auto; color: var(--drift); font: 13px var(--body); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .c { font: 400 17px/1.1 var(--pixel); padding: 3px 7px 4px; border-radius: 4px; cursor: pointer; color: var(--foam);
    background: color-mix(in srgb, var(--t) 13%, transparent); border: 1px solid color-mix(in srgb, var(--t) 45%, transparent); }
  .c:hover { background: color-mix(in srgb, var(--t) 26%, transparent); border-color: var(--t); }
  .more { margin-top: 6px; background: none; border: 1px solid var(--line-hi); border-radius: 5px; padding: 4px 10px; cursor: pointer; color: var(--drift); }
  .more:hover { color: var(--foam); border-color: var(--t); }
  .msg { color: var(--drift); margin: 0; }
  .sug { display: grid; gap: 4px; }
  .sug button { text-align: left; padding: 6px 8px; background: var(--deep); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
  .sug button:hover { border-color: var(--line-hi); background: var(--shallow); }
  .toast { position: absolute; left: 10px; right: 10px; bottom: 10px; padding: 7px 10px; border-radius: 6px; background: var(--foam); color: var(--abyss);
    font-weight: 700; font-size: 13px; opacity: 0; transition: opacity .15s ease; pointer-events: none; }
  .toast.on { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
</style>
<div class="p" hidden>
  <div class="bar">
    <img src="${ICON('krillion')}" alt="">
    <b title="Drag to move. Double-click to put it back.">Krillion <span>Solver</span></b>
    <button class="ib" id="min" type="button" aria-label="Collapse" title="Collapse"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M6 12h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
    <button class="ib" id="x" type="button" aria-label="Close (the toolbar icon opens it again)" title="Close"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
  </div>
  <div class="auto" id="autoBox">
    <label class="sw main">Auto answer on my turn<input type="checkbox" role="switch" id="auto"></label>
    <div class="field">
      <span class="lbl">Tiers <b id="rlabel"></b></span>
      <div class="range" id="range">
        <div class="rtrack"><div class="rfill"></div></div>
        <input type="range" id="from" min="0" max="5" step="1" aria-label="Most common tier to use">
        <input type="range" id="to" min="0" max="5" step="1" aria-label="Rarest tier to use">
      </div>
      <div class="ricons">${LOW_TO_HIGH.map((t, i) => `<img src="${ICON(t.id)}" alt="" title="${t.name}" data-i="${i}">`).join('')}</div>
    </div>
    <div class="field">
      <span class="lbl">Typing speed <b id="spv"></b></span>
      <input type="range" class="one" id="speed" min="1" max="5" step="1" aria-label="Typing speed, 1 slow to 5 fast">
    </div>
    <label class="sw">Make mistakes (typos, rare repeats)<input type="checkbox" role="switch" id="mistakes"></label>
    <label class="sw">Auto queue (clicks Play again)<input type="checkbox" role="switch" id="queue"></label>
    <p class="st" id="st" aria-live="polite"></p>
  </div>
  <div class="body" id="body"></div>
  <div class="toast" id="toast" role="status"></div>
</div>`;
const panel = root.querySelector('.p'), body = root.getElementById('body'), $ = id => root.getElementById(id);
document.documentElement.appendChild(host);
// Keys typed in the panel stay in the panel (the game listens for typing on the page).
for (const t of ['keydown', 'keyup', 'keypress']) host.addEventListener(t, ev => ev.stopPropagation());

$('x').onclick = () => { closed = true; panel.hidden = true; };
$('min').onclick = () => { collapsed = !collapsed; panel.classList.toggle('min', collapsed); };

// Drag the panel by its title bar. It remembers where you left it and stays on screen when the window shrinks.
function place(pos) {
  if (!pos) { panel.style.left = panel.style.top = panel.style.right = panel.style.maxHeight = ''; return; }
  const w = panel.offsetWidth || 330;
  panel.style.left = Math.min(Math.max(0, pos.x), innerWidth - w) + 'px';
  const top = Math.min(Math.max(0, pos.y), innerHeight - 44);
  panel.style.top = top + 'px';
  panel.style.maxHeight = `calc(100vh - ${top + 16}px)`; // shrink to fit below where you dropped it
  panel.style.right = 'auto';
}
const bar = root.querySelector('.bar');
let drag = null;
bar.addEventListener('pointerdown', ev => {
  if (ev.button !== 0 || ev.target.closest('button')) return;
  const r = panel.getBoundingClientRect();
  drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
  bar.setPointerCapture(ev.pointerId);
  panel.classList.add('drag');
  ev.preventDefault();
});
bar.addEventListener('pointermove', ev => { if (drag) place({ x: ev.clientX - drag.dx, y: ev.clientY - drag.dy }); });
const drop = () => {
  if (!drag) return;
  drag = null;
  panel.classList.remove('drag');
  const r = panel.getBoundingClientRect();
  settings.pos = { x: Math.round(r.left), y: Math.round(r.top) };
  save();
};
bar.addEventListener('pointerup', drop);
bar.addEventListener('pointercancel', drop);
bar.addEventListener('dblclick', ev => { if (ev.target.closest('button')) return; settings.pos = null; place(null); save(); });
addEventListener('resize', () => place(settings.pos));
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type !== 'toggle') return;
  closed = !closed && !panel.hidden;
  opened = !closed;
  panel.hidden = closed;
  if (!closed) draw();
});

function showSettings() {
  $('auto').checked = settings.auto; $('mistakes').checked = settings.mistakes; $('queue').checked = settings.queue;
  const lo = Math.min(settings.from, settings.to), hi = Math.max(settings.from, settings.to);
  $('from').value = settings.from; $('to').value = settings.to;
  $('range').style.setProperty('--lo', lo); $('range').style.setProperty('--hi', hi);
  root.querySelectorAll('.ricons img').forEach((img, i) => img.classList.toggle('off', i < lo || i > hi));
  const short = i => (LOW_TO_HIGH[i].id === 'krillion' ? '1 in a Krillion' : LOW_TO_HIGH[i].name);
  $('rlabel').textContent = lo === hi ? short(lo) : `${short(lo)} to ${short(hi)}`;
  $('speed').value = settings.speed; $('spv').textContent = ['Slow', 'Relaxed', 'Average', 'Quick', 'Fast'][settings.speed - 1];
  $('speed').style.setProperty('--p', `${(settings.speed - 1) * 25}%`);
  $('autoBox').classList.toggle('on', settings.auto);
  status(settings.auto ? 'On. Waits for your turn.' : 'Off. Click any answer to type it in yourself.');
}
const status = text => { if ($('st').textContent !== text) $('st').textContent = text; };
for (const id of ['auto', 'mistakes', 'queue']) $(id).onchange = () => { settings[id] = $(id).checked; save(); showSettings(); };
for (const id of ['from', 'to', 'speed']) $(id).oninput = () => { settings[id] = +$(id).value; save(); showSettings(); };
// Clicking a tier icon moves the nearer handle to it.
root.querySelector('.ricons').onclick = ev => {
  const i = ev.target.dataset && ev.target.dataset.i;
  if (i === undefined) return;
  const k = Math.abs(i - settings.from) <= Math.abs(i - settings.to) ? 'from' : 'to';
  settings[k] = +i; save(); showSettings();
};
showSettings();

let toastTimer = 0, filterTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1400);
}

// ---- the game's answer box ----
const setVal = (box, v) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, v);
const gameInput = () => [...document.querySelectorAll('input.ds-input')].find(isShown);
// The answer box when it's your turn: party marks the puffer holder's seat "hold"; the daily shows the box in its form.
function myTurnBox() {
  const box = gameInput();
  if (!box || box.disabled || box.readOnly || !promptText) return null;
  if (document.querySelector('.pf-root')) return document.querySelector('.pf-seat.me.hold') ? box : null;
  return box.closest('form') ? box : null;
}
// Click an answer: put it in the answer box (you still press Enter) and copy it.
function useAnswer(text) {
  const box = gameInput();
  if (box && !box.disabled) {
    setVal(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
  }
  navigator.clipboard.writeText(text).catch(() => {});
  toast(box ? `Typed "${text}". Press Enter to send.` : `Copied "${text}"`);
}

// ---- answer lists ----
// The archive's list for this prompt plus answers learned in your games.
function buildSheet(base) {
  const tiers = Object.fromEntries(TIERS.map(t => [t.id, [...((base && base[t.id]) || [])]]));
  const keys = Object.fromEntries(TIERS.map(t => [t.id, tiers[t.id].map(norm)]));
  const all = new Set(Object.values(keys).flat());
  for (const [k, [a, tier]] of Object.entries(learned[promptKey(promptText)] || {})) {
    if (all.has(k) || !tiers[tier]) continue;
    tiers[tier].push(a); keys[tier].push(k); all.add(k);
  }
  return { tiers, keys, archive: !!base };
}
const unused = id => sheet ? sheet.tiers[id].filter((a, i) => !used.has(sheet.keys[id][i])) : [];

function learn(answer, tier) {
  const pk = promptKey(promptText), k = norm(answer);
  if (!pk || !k || !TIERS.some(t => t.id === tier)) return false;
  const book = learned[pk] || (learned[pk] = {});
  if (book[k]) return false;
  book[k] = [answer, tier];
  save();
  if (sheet && !Object.values(sheet.keys).some(ks => ks.includes(k))) { sheet.tiers[tier].push(answer); sheet.keys[tier].push(k); }
  return true;
}

// ---- drawing ----
function draw() {
  if (closed) return;
  const was = panel.hidden;
  panel.hidden = !promptText && !opened; // opens by itself once a prompt is on screen
  if (was && !panel.hidden) place(settings.pos); // its width is known now
  if (!promptText) { body.innerHTML = '<p class="msg">Waiting for a prompt. Start a dive or a party round.</p>'; return; }
  if (!INDEX || !sheet) { body.innerHTML = `<p class="q">${esc(promptText)}</p><p class="msg">Loading answers…</p>`; return; }

  const f = norm(filter);
  const gems = sheet.tiers.krillion;
  const said = [...used.values()];
  const total = TIERS.reduce((s, t) => s + sheet.tiers[t.id].length, 0);
  const near = !entry ? search(INDEX, promptText, 3) : [];
  body.innerHTML = `
    <div><p class="q">${esc(promptText)}</p><p class="meta">${entry
      ? 'Click an answer to type it in.'
      : total ? 'Party-only prompt. These are answers seen in your games.' : 'Party-only prompt with nothing saved yet. Answers get saved as people say them.'}</p></div>
    ${near.length ? `<div class="sug"><p class="meta">Or use the list from a close daily prompt:</p>${near.map((m, i) => `<button type="button" data-near="${i}">${esc(m.e.t)}</button>`).join('')}</div>` : ''}
    ${entry || gems.length ? `<div class="gem"><img src="${ICON('krillion')}" alt=""><div>
      <small>One in a Krillion, 100 pts</small>
      ${gems.length ? gems.map((g, i) => `<button type="button" class="${used.has(sheet.keys.krillion[i]) ? 'said' : ''}" data-a="${esc(g)}">${esc(g)}</button>`).join('')
        : '<span class="none">No gem on this prompt. Deep Cut is the top score.</span>'}
    </div></div>` : ''}
    ${total ? `<input class="f" id="f" type="search" placeholder="Filter answers" autocomplete="off" spellcheck="false" value="${esc(filter)}">` : ''}
    ${said.length ? `<p class="said-row">Already said, hidden: ${said.map(s => `<s>${esc(s)}</s>`).join(', ')}</p>` : ''}
    ${TIERS.slice(1).map(t => {
      const list = sheet.tiers[t.id], keys = sheet.keys[t.id], all = [];
      for (let i = 0; i < list.length; i++) if (!used.has(keys[i]) && (!f || keys[i].includes(f))) all.push(list[i]);
      if (!all.length) return '';
      const n = shown[t.id] || FIRST;
      return `<section class="t" style="--t:var(--${t.id})">
        <h3><img src="${ICON(t.id)}" alt="">${t.name}<em>${t.score} pts</em></h3>
        <div class="chips">${all.slice(0, n).map(a => `<button type="button" class="c" data-a="${esc(a)}">${esc(a)}</button>`).join('')}</div>
        ${all.length > n ? `<button type="button" class="more" data-more="${t.id}">Show more</button>` : ''}
      </section>`;
    }).join('')}`;
  const box = $('f');
  if (box) box.oninput = () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { filter = box.value; const at = box.selectionStart; draw(); const nb = $('f'); nb.focus(); nb.setSelectionRange(at, at); }, 150);
  };
  body.querySelectorAll('[data-near]').forEach(b => b.onclick = () => pick(near[+b.dataset.near].e));
}
body.addEventListener('click', ev => {
  const a = ev.target.closest('[data-a]');
  if (a) return useAnswer(a.dataset.a);
  const m = ev.target.closest('[data-more]');
  if (m) { shown[m.dataset.more] = (shown[m.dataset.more] || FIRST) + FIRST; draw(); }
});

// Use an archive prompt's answers for what's on screen.
async function pick(e) {
  const v = ++ver;
  entry = e; sheet = null;
  draw();
  try {
    const d = await ask({ type: 'prompt', d: e.d, p: e.p });
    if (v === ver) { sheet = buildSheet(d.tiers); draw(); }
  } catch {
    if (v === ver) { entry = null; sheet = buildSheet(null); draw(); toast('Could not load that answer list.'); }
  }
}

// ---- reading the page ----
function readPrompt() {
  const texts = [...document.querySelectorAll('.prompt')].filter(isShown).map(el => el.textContent.trim())
    .filter(t => t.length > 3 && t.length < 200 && !/^new category$/i.test(t));
  return texts[texts.length - 1] || '';
}
function scan() {
  const text = readPrompt();
  let changed = false;
  if (text && text !== promptText && INDEX) {
    promptText = text; promptAt = Date.now(); used = new Map(); filter = ''; for (const k in shown) delete shown[k];
    stale = new WeakMap();
    for (const el of document.querySelectorAll('.pf-say')) stale.set(el, el.textContent.trim());
    const best = search(INDEX, text, 1)[0];
    if (best && best.s >= SURE) pick(best.e);
    else { ver++; entry = null; sheet = buildSheet(null); changed = true; }
  }
  if (promptText) for (const el of document.querySelectorAll('.pf-say.ok, .pf-say.rest')) {
    const said = el.textContent.trim(), k = norm(said);
    if (!k || stale.get(el) === said) continue;
    const tier = (el.style.getPropertyValue('--cc').match(/--tier-([a-z]+)/) || [])[1];
    if (tier && learn(said, tier)) changed = true;
    if (!used.has(k)) { used.set(k, said); changed = true; }
  }
  if (changed) draw();
}
// Your own answer: what's in the game's box when Enter goes down (yours or auto answer's).
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' || !promptText || !ev.target.matches || !ev.target.matches('input.ds-input')) return;
  const said = ev.target.value.trim(), k = norm(said);
  if (k && !used.has(k)) { used.set(k, said); setTimeout(draw, 0); }
}, true);

// ---- auto answer ----
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function nearKey(ch) {
  const lower = ch.toLowerCase();
  for (const r of ROWS) {
    const i = r.indexOf(lower);
    if (i < 0) continue;
    const n = r[i + (i === 0 ? 1 : i === r.length - 1 ? -1 : Math.random() < 0.5 ? -1 : 1)];
    return ch === lower ? n : n.toUpperCase();
  }
  return null;
}
const keyMs = () => KEY_MS[settings.speed - 1] * (0.6 + Math.random() * 0.8);
function press(box, key) {
  box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  if (key === 'Backspace') {
    setVal(box, box.value.slice(0, -1));
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  } else {
    setVal(box, box.value + key);
    box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: key }));
  }
  box.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}
function pressEnter(box) {
  const down = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
  box.dispatchEvent(down);
  if (!down.defaultPrevented && box.form) box.form.requestSubmit(); // the daily's box sends through its form
  box.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
}
// Types text key by key. Returns false if the turn ended or the prompt changed.
async function typeOut(box, text, still) {
  const letters = [...text].map((c, i) => (i > 0 && nearKey(c) ? i : -1)).filter(i => i >= 0);
  const typoAt = settings.mistakes && letters.length && Math.random() < 0.45 ? rand(letters) : -1;
  for (let i = 0; i < text.length; i++) {
    if (i === typoAt) {
      press(box, nearKey(text[i]));
      const extra = Math.random() < 0.5 && i + 1 < text.length ? 1 : 0; // sometimes notice one key late
      for (let j = 0; j < extra; j++) { await sleep(keyMs()); press(box, text[i + 1 + j]); }
      await sleep(keyMs() * 3);
      for (let j = 0; j <= extra; j++) { press(box, 'Backspace'); await sleep(keyMs() * 0.8); }
    }
    if (!still()) return false;
    press(box, text[i]);
    await sleep(keyMs() + (text[i] === ' ' ? KEY_MS[settings.speed - 1] * 0.5 : 0));
  }
  return still();
}
async function clearBox(box) { while (box.value) { press(box, 'Backspace'); await sleep(keyMs() * 0.5); } }

// A random unused answer: a random tier from the range that has some left, then a random answer in it (short ones first).
function chooseAnswer() {
  const lo = Math.min(settings.from, settings.to), hi = Math.max(settings.from, settings.to);
  let pools = LOW_TO_HIGH.slice(lo, hi + 1).map(t => unused(t.id)).filter(p => p.length);
  if (!pools.length) { // nothing left in range: the closest tier outside it that has answers
    const dist = i => (i < lo ? lo - i : i - hi);
    const out = LOW_TO_HIGH.map((t, i) => ({ i, p: unused(t.id) })).filter(x => x.p.length && (x.i < lo || x.i > hi)).sort((a, b) => dist(a.i) - dist(b.i));
    pools = out.length ? [out[0].p] : [];
  }
  if (!pools.length) return null;
  const pool = rand(pools), short = pool.filter(a => a.length <= SHORT);
  return rand(short.length ? short : pool);
}

async function autoAnswer(box) {
  const p = promptText, still = () => myTurnBox() === box && readPrompt() === p;
  // A short think, but never before the question has been up READ_MS, so you can read it first.
  const think = THINK_MS[settings.speed - 1] * (0.7 + Math.random() * 0.6);
  await sleep(Math.max(think, promptAt + READ_MS + Math.random() * 400 - Date.now()));
  if (!still() || !sheet) return;
  box.focus();
  if (box.value) await clearBox(box);
  const repeats = [...used.values()].slice(0, -2); // never the answer that was just said
  if (settings.mistakes && repeats.length && Math.random() < 0.06) { // now and then: try something said earlier, get turned down, move on
    const r = rand(repeats);
    status(`Mistake on purpose: "${r}" was already said.`);
    if (!await typeOut(box, r, still)) return;
    pressEnter(box);
    await sleep(900 + Math.random() * 400);
    if (!still()) return;
    await clearBox(box);
  }
  const answer = chooseAnswer();
  if (!answer) { status('No unused answers known for this prompt. Type one yourself.'); return; }
  status(`Typing "${answer}"`);
  if (!await typeOut(box, answer, still)) return;
  await sleep(keyMs() * 2);
  if (!still()) return;
  pressEnter(box);
  status(`Sent "${answer}". Waiting for your next turn.`);
  // Wait for the game's verdict, up to 1.5 s: the puffer moves on, or your bubble shows the answer turned down.
  const said = answer.toLowerCase();
  const turnedDown = () => { const b = document.querySelector('.pf-seat.me .pf-say.bad'); return !!b && b.textContent.trim().toLowerCase() === said; };
  for (let i = 0; i < 10 && still() && !turnedDown(); i++) await sleep(150);
}
// Auto queue: when a party game ends, click "Play again" after a moment.
let queueAt = 0;
function autoQueue() {
  const btn = [...document.querySelectorAll('button.ds-next-btn')].find(b => isShown(b) && !b.disabled && /play again/i.test(b.textContent));
  if (!btn) { queueAt = 0; return; }
  if (!queueAt) { queueAt = Date.now() + 1500 + Math.random() * 1500; status('Game over. Queuing again in a moment.'); return; }
  if (Date.now() < queueAt) return;
  queueAt = Date.now() + 5000; // one click, then wait for the page to move on
  btn.click();
  status('Clicked Play again.');
}

function tick() {
  if (settings.queue) autoQueue();
  if (!settings.auto || busy) return;
  const box = myTurnBox();
  if (!box) return;
  if (!sheet) { status('Your turn, but the answer list is still loading.'); return; }
  busy = true;
  autoAnswer(box).catch(() => {}).finally(() => { busy = false; });
}

// ---- start ----
// One loop reads the page and runs auto answer and auto queue, about 7 times a second, hidden tab included.
(async () => {
  for (;;) {
    try { scan(); tick(); } catch (e) { console.warn('Krillion Solver:', e); }
    await (settings.auto || settings.queue ? sleep(150) : localSleep(150));
  }
})();

chrome.storage.local.get(['settings', 'learned']).then(s => {
  if (s.settings) settings = { ...settings, ...s.settings };
  if (s.learned) learned = s.learned;
  showSettings();
  place(settings.pos);
  return ask({ type: 'index' });
}).then(idx => { INDEX = idx; scan(); draw(); }, () => {
  body.innerHTML = '<p class="msg">Could not load the answer archive. Reload the extension.</p>';
});
draw();
})();
