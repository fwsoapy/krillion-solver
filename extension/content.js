// Krillion Solver panel, for the daily dive and Puffer Party.
// - Reads the prompt (both modes show it in .prompt), finds it in the daily archive and lists every answer, gem first.
// - Crosses off answers already said: in Puffer Party every accepted answer shows in that player's bubble (.pf-say with
//   class "ok", then "rest"), yours included, so a turned-down answer stays on the list. The daily shows no verdict, so
//   there yours count when you press Enter. Resets when the prompt changes.
// - Party has prompts the daily archive doesn't. Every accepted answer seen in your games is saved with its tier (the
//   bubble's --cc color), so a prompt you've seen before has a list next time. Party prompts in data/party.json (party.js)
//   add their tiers and an "Unrated" list.
// - An answer of yours the game turns down that nobody had said this round is wrong: crossed off and never tried again
//   on that prompt, in later games too. With Contribute on, a party prompt's wrong answers go to the collector too, and
//   data/party.json's "wrong" ones are crossed off the same way.
// - Auto answer (off until you switch it on): on your turn it picks a random unused answer from your tier range (common
//   tiers likelier) and types it in plain letters one key at a time, then presses Enter. A long one goes as its first 2
//   words first, the whole answer only if those are turned down. It waits until a new question has been up 2 seconds. "Make mistakes" adds
//   typos it fixes and, rarely, first tries an answer said earlier (never the latest ones). A prompt with no list: it
//   guesses from the 3 closest daily prompts' lists, or from the word list on a word prompt.
// - Auto queue (off until you switch it on): clicks "Play again" when a party game ends, and "Take a seat" if the game
//   kicked you for idling. If the room filled up meanwhile, it goes to the lobby and clicks Quick Play.
// - Contribute answers (off until you switch it on): party answers learned while it's on, on prompts with no archive list,
//   go to the project's collector (sw.js CONTRIBUTE_URL) at game end and every few minutes, 50 at a time, each
//   prompt+answer once. Only prompt, answer and tier.
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
const ICON = id => `https://krillion.io/tiers/${id}.png`;

let INDEX = null, promptText = '', entry = null, sheet = null, ver = 0;
let closed = false, collapsed = false, opened = false, busy = false, archived = false; // archived: this prompt matched an archive prompt
let used = new Map();                                    // norm(answer) -> answer as said
let mine = { k: '', t: 0 };                              // your last answer sent in party: auto answer skips it a few seconds, until its bubble shows
let longTry = null;                                      // { p, a, k, sk, s, down }: a long answer a (k = norm) tried as its first 2 words s (sk)
let stale = new WeakMap();                               // bubble -> its text when the prompt changed (left over, not about this prompt)
let learned = {};                                        // promptKey -> { norm(answer): [answer, tier] }
let rejected = {}, bad = {};                             // promptKey -> { norm(answer): 1 } turned down / this prompt's
let told = new Set();                                    // norm(answer): this prompt's party.json "wrong" answers
const REJECT_MAX = 200;                                  // per prompt
let PARTY = null, partyAsked = false, party = null, more = []; // data/party.json / this prompt's entry and its untiered answers
let settings = { auto: false, from: 3, to: 5, speed: 3, mistakes: false, queue: false, pretype: false, contribute: false }; // from/to index LOW_TO_HIGH
let outbox = {}, sent = {};                              // promptKey|norm(answer)|tier -> [prompt as shown, answer, tier] / 1
let promptAt = 0;                                        // when the current question appeared
let guess = null;                                        // a prompt with no list: { p, tiers: closest daily prompt's list (null while loading), bad: guesses turned down }
const guesses = {};                                      // 'date/n' -> that daily prompt's tiers
let WORDS = null, wordsAsked = false;                    // the word list (data/words.txt), most common first, loaded for the first word prompt
const shown = {};                                        // tier id -> answers shown

// Reloading the extension leaves this copy running in open tabs with every chrome.* call throwing. Then it stops for good:
// waits never end (so the loop, typing and clicks stop), nothing touches chrome.*, and the status says so.
let dead = false;
function alive() {
  if (!dead) try { dead = !chrome.runtime.id; } catch { dead = true; }
  if (dead) status('Extension reloaded. Reload this page.');
  return !dead;
}
const ask = msg => new Promise((ok, fail) => {
  if (!alive()) return fail(new Error('Extension reloaded.'));
  try {
    chrome.runtime.sendMessage(msg, r => chrome.runtime.lastError ? fail(new Error(chrome.runtime.lastError.message)) : r && r.error ? fail(new Error(r.error)) : ok(r.data));
  } catch (e) { fail(e); }
});
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const isShown = el => el.offsetParent !== null || el.getClientRects().length > 0;
// Chrome slows timers in a hidden tab to once a second or less, which would make typing crawl. The service worker
// isn't slowed, so while this tab is hidden every wait goes through it.
const localSleep = ms => new Promise(r => setTimeout(r, ms));
// A service worker that never answers can't hang a wait: the tab's own (slow) timer ends it too.
const sleep = ms => (!alive() ? new Promise(() => {})
  : document.hidden ? Promise.race([ask({ type: 'sleep', ms }).catch(() => localSleep(ms)), localSleep(ms + 1000)]) : localSleep(ms));
const rand = a => a[Math.floor(Math.random() * a.length)];
let saveTimer = 0;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (alive()) chrome.storage.local.set({ settings, learned, outbox, sent, rejected }).catch(() => {}); }, 400);
};

// ---- panel ----
const host = document.createElement('div');
host.id = 'krillion-solver';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>
  :host { all: initial; }
  .p { --abyss:#050a14; --deep:#0a1426; --shallow:#101d33; --line:#1b2c47; --line-hi:#2c4168; --foam:#e8f1ff; --drift:#9aaccb; --pink:#ff5d8f;
    --krillion:#ffd166; --deepcut:#9d7bff; --rare:#ff5252; --schooler:#4de3ff; --tooclever:#ff9f43; --plankton:#8fa3c4;
    --pixel: VT323, ui-monospace, monospace; --body: system-ui, "Segoe UI", sans-serif;
    position: fixed; top: 76px; right: 14px; z-index: 2147483646; width: 300px; max-height: min(520px, calc(100vh - 96px));
    min-width: 240px; min-height: 160px; max-width: calc(100vw - 16px); resize: both; overflow: auto;
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
  .bar b { font: 400 22px/1 var(--pixel); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
  .ricons { display: flex; justify-content: space-between; margin: 0 -3px; } /* 24px icons centered on the 18px thumbs' stops */
  .ricons img { width: 24px; height: 24px; cursor: pointer; transition: opacity .15s ease; }
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
  @media (prefers-reduced-motion: reduce) { .sw input, .sw input::before, input[type=range]::-webkit-slider-thumb { transition: none; } }
  .st { margin: 0; color: var(--drift); font-size: 12.5px; }
  .p.min .body, .p.min .auto > :nth-child(n+4) { display: none; } /* collapsed: auto switch, tiers, speed only */
  .p.min { height: auto !important; min-height: 0; resize: none; }
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
    <label class="sw">Pre-type<input type="checkbox" role="switch" id="pretype"></label>
    <label class="sw">Make mistakes<input type="checkbox" role="switch" id="mistakes"></label>
    <label class="sw">Auto queue<input type="checkbox" role="switch" id="queue"></label>
    <label class="sw">Contribute answers<input type="checkbox" role="switch" id="contribute"></label>
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

// Drag the panel by its title bar, resize it by its corner. It remembers where you left it and its size, and stays on
// screen when the window shrinks. Its own size: up to the window's height; the default size: up to 520px.
function place(pos) {
  const s = settings.size, top = pos ? Math.min(Math.max(0, pos.y), innerHeight - 44) : 76, room = `calc(100vh - ${top + 16}px)`;
  panel.style.width = s ? s.w + 'px' : ''; panel.style.height = s ? s.h + 'px' : '';
  panel.style.maxHeight = s ? room : pos ? `min(520px, ${room})` : ''; // shrink to fit below where you dropped it
  if (!pos) { panel.style.left = panel.style.top = panel.style.right = ''; return; }
  panel.style.left = Math.min(Math.max(0, pos.x), innerWidth - (panel.offsetWidth || 300)) + 'px';
  panel.style.top = top + 'px';
  panel.style.right = 'auto';
}
// The corner handle writes the new size inline. Pin the left edge (the default hangs off the right) so it grows the way you drag.
new ResizeObserver(() => {
  const w = parseInt(panel.style.width), h = parseInt(panel.style.height), s = settings.size;
  if (!w || !h || (s && s.w === w && s.h === h)) return;
  const r = panel.getBoundingClientRect();
  settings.size = { w, h }; settings.pos = settings.pos || { x: Math.round(r.left), y: Math.round(r.top) };
  place(settings.pos); save();
}).observe(panel);
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
bar.addEventListener('dblclick', ev => { if (ev.target.closest('button')) return; settings.pos = settings.size = null; place(null); save(); });
addEventListener('resize', () => place(settings.pos));
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type !== 'toggle') return;
  closed = !closed && !panel.hidden;
  opened = !closed;
  panel.hidden = closed;
  if (!closed) draw();
});

function showSettings() {
  for (const id of ['auto', 'pretype', 'mistakes', 'queue', 'contribute']) $(id).checked = settings[id];
  const lo = Math.min(settings.from, settings.to), hi = Math.max(settings.from, settings.to);
  $('from').value = settings.from; $('to').value = settings.to;
  $('range').style.setProperty('--lo', lo); $('range').style.setProperty('--hi', hi);
  root.querySelectorAll('.ricons img').forEach((img, i) => img.classList.toggle('off', i < lo || i > hi));
  const short = i => (LOW_TO_HIGH[i].id === 'krillion' ? '1 in a Krillion' : LOW_TO_HIGH[i].name);
  $('rlabel').textContent = lo === hi ? short(lo) : `${short(lo)} to ${short(hi)}`;
  $('speed').value = settings.speed; $('spv').textContent = ['Slow', 'Relaxed', 'Average', 'Quick', 'Fast'][settings.speed - 1];
  $('speed').style.setProperty('--p', `${(settings.speed - 1) * 25}%`);
  $('autoBox').classList.toggle('on', settings.auto);
  status(settings.auto ? 'On.' : 'Off.');
}
const status = text => { if ($('st').textContent !== text) $('st').textContent = text; };
for (const id of ['auto', 'pretype', 'mistakes', 'queue', 'contribute']) $(id).onchange = () => {
  settings[id] = $(id).checked;
  if (id === 'contribute' && !settings.contribute) outbox = {}; // switched off: drop what hasn't gone out yet
  save(); showSettings();
};
for (const id of ['from', 'to', 'speed']) $(id).oninput = () => { settings[id] = +$(id).value; save(); showSettings(); };
// Clicking a tier icon moves the nearer handle to it.
root.querySelector('.ricons').onclick = ev => {
  const i = ev.target.dataset && ev.target.dataset.i;
  if (i === undefined) return;
  const k = Math.abs(i - settings.from) <= Math.abs(i - settings.to) ? 'from' : 'to';
  settings[k] = +i; save(); showSettings();
};
showSettings();

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1400);
}

// ---- the game's answer box ----
const setVal = (box, v) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, v);
const gameInput = () => [...document.querySelectorAll('input.ds-input')].find(isShown);
// The answer box when it's your turn: party marks the puffer holder's seat "hold" and the box says "your puffer — type!";
// the daily shows the box in its form.
function myTurnBox() {
  const box = gameInput();
  if (!box || box.disabled || box.readOnly || !promptText) return null;
  if (document.querySelector('.pf-root')) return document.querySelector('.pf-seat.me.hold') || /your puffer/i.test(box.placeholder) ? box : null;
  return box.closest('form') ? box : null;
}
// Click an answer: put it in the answer box (you still press Enter) and copy it.
function useAnswer(text) {
  takeOver('you picked an answer');
  text = plain(text);
  const box = gameInput();
  if (box && !box.disabled) {
    setVal(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
  }
  navigator.clipboard.writeText(text).catch(() => {});
  toast(box ? `Typed "${text}"` : `Copied "${text}"`);
}

// ---- answer lists ----
// The archive's list for this prompt plus answers learned in your games.
function buildSheet(base) {
  const tiers = Object.fromEntries(TIERS.map(t => [t.id, [...((base && base[t.id]) || [])]]));
  const keys = Object.fromEntries(TIERS.map(t => [t.id, tiers[t.id].map(norm)]));
  const all = new Set(Object.values(keys).flat());
  for (let [k, [a, tier]] of Object.entries(learned[promptKey(promptText)] || {})) {
    if (!tiers[tier] || keys[tier].includes(k)) continue;
    if (all.has(k)) for (const t of TIERS) { // in the list under another tier: the game's latest rating wins
      const i = keys[t.id].indexOf(k);
      if (i >= 0) { a = tiers[t.id][i]; tiers[t.id].splice(i, 1); keys[t.id].splice(i, 1); }
    }
    tiers[tier].push(a); keys[tier].push(k); all.add(k);
  }
  return { tiers, keys, archive: !!base };
}
const gone = k => used.has(k) || !!bad[k] || told.has(k); // said this round, or turned down on this prompt
const free = k => !!k && !gone(k) &&!(k === mine.k && Date.now() - mine.t < 4000);
const unused = id => sheet ? sheet.tiers[id].filter((a, i) => free(sheet.keys[id][i])) : [];

function learn(answer, tier) {
  const pk = promptKey(promptText), k = norm(answer);
  if (!pk || !k || !TIERS.some(t => t.id === tier)) return false;
  const book = learned[pk] || (learned[pk] = {});
  if (book[k] && book[k][1] === tier) return false;
  book[k] = [answer, tier]; // new, or the game rates it differently now: the latest rating wins
  queue(pk + '|' + k + '|' + tier, answer, tier);
  save();
  if (sheet && !sheet.keys[tier].includes(k)) { // move it to that tier
    for (const t of TIERS) { const i = sheet.keys[t.id].indexOf(k); if (i >= 0) { sheet.keys[t.id].splice(i, 1); sheet.tiers[t.id].splice(i, 1); } }
    sheet.tiers[tier].push(answer); sheet.keys[tier].push(k);
  }
  return true;
}
// Your answer turned down. Already said this round: a repeat. Otherwise wrong for this prompt (and reported, with
// Contribute on). The 2-word try of a long answer is ours, never wrong: the whole answer goes next. True if newly recorded.
function reject(said) {
  const k = norm(said), pk = promptKey(promptText);
  if (longTry && longTry.p === promptText && k === longTry.sk) { longTry.down = true; return false; }
  if (!k || !pk || used.has(k) || bad[k] || Object.keys(bad).length >= REJECT_MAX) return false;
  bad[k] = 1; rejected[pk] = bad; save();
  queue(pk + '|' + k + '|wrong', said, 'wrong');
  return true;
}

// A prompt the archive lacks may be in data/party.json: its tiers join the sheet, its untiered answers go in "more".
const loadParty = () => partyAsked || (partyAsked = true, ask({ type: 'party' }).then(d => { PARTY = d || []; matchParty(); }, () => { PARTY = []; }));
function matchParty() {
  if (!PARTY || archived || entry || !promptText) return;
  const e = PARTY.find(e => same(e, promptText)); // read off the screen, so the same prompt has the same text
  if (!e) return;
  party = e; more = party.more || []; sheet = buildSheet(party.tiers || {});
  told = new Set((party.wrong || []).map(norm).filter(k => k && !used.has(k))); // turned down for others, never accepted
  draw();
}
// The archive prompt on screen: the same prompt (or its alt wording) only. A close one is a different prompt ("ending in
// “-gram”" isn't "ending in “-ism”"), except in the daily dive, which always shows one of today's prompts, so there a
// close match among today's is it.
const same = (e, p) => [e.t, e.a].some(t => t && promptKey(t) === promptKey(p));
function archiveMatch(p) {
  const hit = INDEX.find(e => same(e, p));
  if (hit || isParty()) return hit || null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const near = search(INDEX.filter(e => e.d === today), p, 1)[0];
  return near && near.s >= SURE ? near.e : null;
}

// ---- drawing ----
function draw() {
  if (closed) return;
  const was = panel.hidden;
  panel.hidden = !promptText && !opened; // opens by itself once a prompt is on screen
  if (was && !panel.hidden) place(settings.pos); // its width is known now
  if (!promptText) { body.innerHTML = '<p class="msg">Waiting for a prompt.</p>'; return; }
  if (!INDEX || !sheet) { body.innerHTML = `<p class="q">${esc(promptText)}</p><p class="msg">Loading answers…</p>`; return; }

  const gems = sheet.tiers.krillion;
  const said = [...used.values()];
  const total = TIERS.reduce((s, t) => s + sheet.tiers[t.id].length, 0);
  const near = !entry && !party ? closePrompts(promptText) : [];
  const wrong = [...Object.keys(bad), ...[...told].filter(k => !bad[k])], left = more.filter(a => !gone(norm(a)) && !inTiers(a));
  body.innerHTML = `
    <div><p class="q">${esc(promptText)}</p>${entry ? '' : `<p class="meta">${party ? 'Party prompt.' : total ? 'Party-only prompt.' : 'Party-only prompt. Nothing saved yet.'}</p>`}</div>
    ${near.length ? `<div class="sug"><p class="meta">Close daily prompts:</p>${near.map((m, i) => `<button type="button" data-near="${i}">${esc(m.e.t)}</button>`).join('')}</div>` : ''}
    ${entry || gems.length ? `<div class="gem"><img src="${ICON('krillion')}" alt=""><div>
      <small>One in a Krillion, 100 pts</small>
      ${gems.length ? gems.map((g, i) => `<button type="button" class="${gone(sheet.keys.krillion[i]) ? 'said' : ''}" data-a="${esc(g)}">${esc(g)}</button>`).join('')
        : '<span class="none">No gem on this prompt.</span>'}
    </div></div>` : ''}
    ${said.length ? `<p class="said-row">Already said: ${said.map(s => `<s>${esc(s)}</s>`).join(', ')}</p>` : ''}
    ${wrong.length ? `<p class="said-row">Wrong: ${wrong.map(s => `<s>${esc(s)}</s>`).join(', ')}</p>` : ''}
    ${TIERS.slice(1).map(t => {
      const list = sheet.tiers[t.id], keys = sheet.keys[t.id], all = [];
      for (let i = 0; i < list.length; i++) if (!gone(keys[i])) all.push(list[i]);
      return all.length ? chips(t.id, t.id, `<img src="${ICON(t.id)}" alt="">${t.name}<em>${t.score} pts</em>`, all) : '';
    }).join('')}
    ${chips('more', 'drift', 'Unrated', left)}
    ${!entry && guess && guess.fit.dict && guess.fit.parsed ? chips('words', 'drift', 'Words', words(canGuess, (shown.words || FIRST) + 1)) : ''}`;
  body.querySelectorAll('[data-near]').forEach(b => b.onclick = () => pick(near[+b.dataset.near].e));
}
// One list of answer buttons, FIRST more per "Show more".
function chips(id, color, head, all) {
  if (!all.length) return '';
  const n = shown[id] || FIRST;
  return `<section class="t" style="--t:var(--${color})">
    <h3>${head}</h3>
    <div class="chips">${all.slice(0, n).map(a => `<button type="button" class="c" data-a="${esc(a)}">${esc(a)}</button>`).join('')}</div>
    ${all.length > n ? `<button type="button" class="more" data-more="${id}">Show more</button>` : ''}
  </section>`;
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
    promptText = text; promptAt = Date.now(); used = new Map(); pending = null; guess = null; for (const k in shown) delete shown[k];
    bad = rejected[promptKey(text)] || {}; told = new Set(); party = null; more = [];
    stale = new WeakMap(); settle();
    for (const el of document.querySelectorAll('.pf-say')) stale.set(el, el.textContent.trim());
    const best = archiveMatch(text);
    archived = !!best;
    if (archived) pick(best);
    else {
      ver++; entry = null; sheet = buildSheet(null); changed = true;
      if (PARTY) matchParty(); else loadParty();
      if (!TIERS.some(t => sheet.tiers[t.id].length)) loadGuess(); // nothing saved: have a guess list ready for your turn
    }
  }
  if (promptText) for (const el of document.querySelectorAll('.pf-say.ok, .pf-say.rest')) {
    const said = el.textContent.trim(), k = norm(said);
    if (!k || stale.get(el) === said) continue;
    const tier = (el.style.getPropertyValue('--cc').match(/--tier-([a-z]+)/) || [])[1];
    if (tier && learn(said, tier)) changed = true;
    if (!used.has(k)) { used.set(k, said); lockOn(k); changed = true; }
    if (bad[k]) { delete bad[k]; save(); } // the game took it: it wasn't wrong after all
    told.delete(k);
    // A long answer's 2-word try taken: that answer is done, the whole one never goes.
    if (longTry && longTry.p === promptText && k === longTry.sk && !used.has(longTry.k)) used.set(longTry.k, longTry.a);
  }
  // Your bubble turned down what you last sent (you or auto answer): wrong unless already said (reject checks).
  const no = promptText && document.querySelector('.pf-seat.me .pf-say.bad');
  if (no) { const said = no.textContent.trim(); if (stale.get(no) !== said && norm(said) === mine.k && reject(said)) changed = true; }
  if (changed) draw();
}
// Your own answer: what's in the game's box when Enter goes down (yours or auto answer's). In party it counts once your
// bubble shows it accepted (scan); the daily shows no verdict, so there it counts now.
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' || !promptText || !ev.target.matches || !ev.target.matches('input.ds-input')) return;
  if (ev.isTrusted) takeOver('you sent an answer yourself');
  const said = ev.target.value.trim(), k = norm(said);
  if (k && isParty()) mine = { k, t: Date.now() };
  else if (k && !used.has(k)) { used.set(k, said); setTimeout(draw, 0); }
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
let typed = { v: '', p: '' };                            // what auto answer or pre-type left in the game's box, and for which prompt
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
  typed = { v: box.value, p: promptText };
}
// Sending. The game may miss a send (seen with pre-typed answers), so the sender, run by tick() whatever auto answer or
// pre-type are waiting on, presses send every 250 ms (Enter and the SEND button in turn) while it's your turn, the box
// still holds the answer to send and your bubble shows no verdict on it. A verdict (ok, rest or bad; "caret" is just live
// typing), the box changing, or the turn moving on: it went through, never again.
let toSend = '', sendAt = 0, sends = 0, turnAt = 0;      // turnAt: when your turn started
const verdict = v => { const b = document.querySelector('.pf-seat.me .pf-say:is(.ok, .rest, .bad)'); return !!b && plain(b.textContent) === v; };
function sender(box) {
  const v = box && box.value;
  if (!settings.auto || !v || verdict(v) || Date.now() < sendAt) return;
  // A pre-typed answer auto answer hasn't sent 2 s into your turn: send it anyway.
  const stuck = v === typed.v && !!pending && v === typeText(pending) &&!used.has(norm(v)) && Date.now() - turnAt > 2000 && Date.now() - promptAt >= READ_MS;
  if (v !== toSend && !stuck) return;
  sendAt = Date.now() + 250;
  box.dispatchEvent(new Event('input', { bubbles: true })); // the page may have dropped its copy of the value
  const b = sends++ % 2 ? sendBtn(box) : null;
  if (b) b.click(); else pressEnter(box);
}
// Hands the answer to the sender and waits (up to 3 s) for it to go through.
async function send(box, said) {
  toSend = said; sendAt = 0;
  sender(box);
  for (let i = 0; i < 12 && myTurnBox() === box && box.value === said && !verdict(said); i++) await sleep(250);
}
// The visible SEND button near the answer box, and no other.
function sendBtn(box) {
  for (let el = box.parentElement, i = 0; el && i < 3; el = el.parentElement, i++) {
    const b = [...el.querySelectorAll('button')].find(b => isShown(b) && !b.disabled && /^\W*send\W*$/i.test(b.textContent));
    if (b) return b;
  }
  return null;
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
async function clearBox(box, still = () => true) { while (box.value && still()) { press(box, 'Backspace'); await sleep(keyMs() * 0.5); } }

// An unused answer: a tier from the range that has some left, common ones likelier (Plankton 6 to One in a Krillion 1),
// then its first unused answer (lists are most said first).
function chooseAnswer() {
  const lo = Math.min(settings.from, settings.to), hi = Math.max(settings.from, settings.to);
  let pools = LOW_TO_HIGH.map((t, i) => ({ w: 6 - i, p: unused(t.id) })).slice(lo, hi + 1).filter(x => x.p.length);
  if (!pools.length) { // nothing left in range: party.json's untiered answers (most common first), then the closest tier outside it
    const m = more.find(a => free(norm(a)) && !inTiers(a));
    if (m) return m;
    const dist = i => (i < lo ? lo - i : i - hi);
    const out = LOW_TO_HIGH.map((t, i) => ({ i, p: unused(t.id) })).filter(x => x.p.length && (x.i < lo || x.i > hi)).sort((a, b) => dist(a.i) - dist(b.i));
    pools = out.length ? [{ w: 1, p: out[0].p }] : [];
  }
  if (!pools.length) return null;
  let r = Math.random() * pools.reduce((s, x) => s + x.w, 0);
  return (pools.find(x => (r -= x.w) < 0) || pools[pools.length - 1]).p[0];
}
// The next answer: a long answer's whole form once its 2-word try was turned down, else a new one.
const nextAnswer = () => (longTry && longTry.p === promptText && longTry.down && free(longTry.k) ? longTry.a : null) || chooseAnswer() || guessAnswer();
// Typed text is plain lowercase English letters: the game autocorrects close answers, and fancy characters can break typing.
const ASCII = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd' };
const plain = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[‘’“”–—ßæœøłđ]/g, c => ASCII[c]).replace(/[^\x00-\x7f]/g, '').trim();
// What to type for answer a. In party a long one (3+ words, over 18 characters) goes as its first 2 words first
// (longTry); once those are turned down (reject), the whole answer.
function typeText(a) {
  const t = plain(a), w = t.split(/\s+/), k = norm(a);
  const s = w.length >= 3 && t.length > 18 ? (w[0] + ' ' + w[1].replace(/[^a-z0-9']+$/, '')).trim() : '';
  if (!norm(s) || !isParty() || gone(norm(s))) return t;
  if (longTry && longTry.p === promptText && longTry.k === k) return longTry.down ? t : longTry.s;
  longTry = { p: promptText, a, k, sk: norm(s), s, down: false };
  return s;
}

// The 3 closest daily prompts on the same topic: they share a topic word ("movie", "city"), not just "used in" or a word
// in a "(like …)" example. "Name a term used in baseball" isn't "Name a sauce used in Asian cooking".
const STOP = new Set(('name type kind thing things something someone word words english term terms used use from with that this the and for you ' +
  'your would could find found like other any one can has have are was were its not more than made known famous popular common etc').split(' '));
const stem = w => w.replace(/ies$/, 'y').replace(/(xes|ches|shes|sses)$/, m => m.slice(0, -2)).replace(/([^s])s$/, '$1');
const topics = s => new Set(norm(s.replace(/\(like[^)]*\)/gi, ' ')).split(' ').filter(w => w.length >= 3 && !STOP.has(w)).map(stem));
function closePrompts(p) {
  const mine = topics(p);
  return search(INDEX, p, 40).filter(({ e }) => [...topics(`${e.t} ${e.a || ''}`)].some(w => mine.has(w))).slice(0, 3);
}
// A prompt with no list: guesses come from the 3 closest daily prompts' lists, 2 tries from each, most common first; a word
// prompt's only from the word list. Only auto answer and pre-type use them, so the panel, the sheet and contribute stay as
// they were; answers the game accepts get learned from the bubbles as usual.
function loadGuess() {
  const g = guess = { p: promptText, lists: [], tried: new Set(), fit: fits(promptText) };
  if (g.fit.dict && g.fit.parsed) loadWords();
  if (g.fit.word) return;
  closePrompts(promptText).forEach(({ e }, i) => {
    const id = `${e.d}/${e.p}`;
    g.lists[i] = guesses[id] || null;
    if (!guesses[id]) ask({ type: 'prompt', d: e.d, p: e.p }).then(d => { g.lists[i] = guesses[id] = d.tiers || {}; }, () => { g.lists[i] = {}; });
  });
}
// What the prompt asks of an answer's letters: "starting with “scr”", "ending in -graphy", "with “bio” in it", "three or
// more S's", "exactly two Z's", "a 10-letter word", "5 or more letters", "a double “o”", "double letters", "no “e”",
// "without the letter E", "no vowels", "starts and ends with the same letter", "palindrome". Guesses must pass them all.
// word: says "word", so only the word list answers it. dict: the word list may (a word prompt, or a hyphen form).
// parsed: a rule was read. An unquoted letter ("starts with a silent K") isn't a rule.
const NUMS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function fits(p) {
  const Q = `["'“‘]([^"'”’]+)["'”’]`, N = `(\\d+|${NUMS.join('|')})`, C = `["“‘']?([a-z])["”’']?(?:['’]?s)?\\b`;
  const word = /\bwords?\b/i.test(p), rules = [], re = s => p.match(RegExp(s, 'i'));
  const n = s => (/\d/.test(s) ? +s : NUMS.indexOf(s.toLowerCase())), count = (w, c) => w.split(c.toLowerCase()).length - 1;
  let hyphen = false, m;
  if ((m = re(`\\b(start|begin|end|contain)\\w*(?: with| in)?(?: the letters?)? (?:${Q}|(-\\w+|\\w+-)(?!\\w))`) || re(`\\b(with) (?:${Q}|(\\w+)) in it\\b`))
    && !(/^with$/i.test(m[1]) && m[3] && !word)) {
    const raw = m[2] || m[3], x = norm(raw), how = { start: 'startsWith', begin: 'startsWith', end: 'endsWith' }[m[1].toLowerCase()] || 'includes';
    hyphen = /^-|-$/.test(raw.trim());
    if (x) rules.push(w => w[how](x));
  }
  if ((m = re(`${N} or more ${C}`) || re(`at least ${N} ${C}`))) { const [, k, c] = m; rules.push(w => count(w, c) >= n(k)); }
  if ((m = re(`exactly ${N} ${C}`))) { const [, k, c] = m; rules.push(w => count(w, c) === n(k)); }
  if ((m = re(`${N} or more letters|at least ${N} letters`))) { const k = n(m[1] || m[2]); rules.push(w => w.length >= k); }
  else if ((m = re(`${N} or (?:fewer|less) letters|at most ${N} letters|${N} letters or (?:fewer|less)`))) { const k = n(m[1] || m[2] || m[3]); rules.push(w => w.length <= k); }
  else if ((m = re(`exactly ${N} letters|${N}[- ]letters?\\b`))) { const k = n(m[1] || m[2]); rules.push(w => w.length === k); }
  if ((m = re(`double ${C}`))) { const c = m[1].toLowerCase(); rules.push(w => w.includes(c + c)); }
  else if (re('double letters?')) rules.push(w => /(.)\1/.test(w));
  if (re('\\b(?:no|without(?: any)?) vowels\\b')) rules.push(w => !/[aeiou]/.test(w));
  else if ((m = re(`\\b(?:no|without) (?:the letter |letter |an? )?${C}`))) { const c = m[1].toLowerCase(); rules.push(w => !w.includes(c)); }
  if (re('\\b(?:start|begin)s? and ends? with the same letter')) rules.push(w => w[0] === w[w.length - 1]);
  if (re('palindrom')) rules.push(w => w === [...w].reverse().join(''));
  return Object.assign(a => rules.every(r => r(norm(a))), { word, dict: word || hyphen, parsed: rules.length > 0 });
}
const loadWords = () => wordsAsked || (wordsAsked = true, ask({ type: 'words' }).then(t => { WORDS = t.split('\n'); draw(); }, () => { WORDS = []; }));
// The first n words in the word list that pass ok.
const words = (ok, n) => { const out = []; for (const w of WORDS || []) if (ok(w) && out.push(w) >= n) break; return out; };
const canGuess = a => free(norm(a)) && guess.fit(a);
// An unused guess that fits the prompt, never one turned down on this prompt (free): 2 from each close list in order (so 6 at
// most a prompt), each list's most common first (common tiers first: likelier to be accepted). Then, if the word list may
// answer it, a common word: a random one of the first 10 that fit. No cap a turn: it keeps trying until the turn ends.
function guessAnswer() {
  if (entry || !INDEX) return null;
  if (!guess) loadGuess();
  const locked = guess.lock !== undefined;
  for (const [i, list] of guess.lists.entries()) {
    if (!list) return null; // still loading: keep the order
    const all = flat(list), a = all.find(canGuess);
    if (a && (locked ? i === guess.lock : all.filter(x => guess.tried.has(norm(x))).length < 2)) return a;
  }
  return !locked && guess.fit.dict && guess.fit.parsed ? rand(words(canGuess, 10)) || null : null;
}
const flat = list => LOW_TO_HIGH.flatMap(t => (list || {})[t.id] || []); // most common first
// An answer the game accepted (anyone's) is on a close list: that list is the right one. Guess only from it from now on,
// and don't give up.
function lockOn(k) {
  if (!guess || guess.lock !== undefined) return;
  const i = guess.lists.findIndex(l => flat(l).some(a => norm(a) === k));
  if (i >= 0) guess.lock = i;
}

const think = () => THINK_MS[settings.speed - 1] * (0.7 + Math.random() * 0.6);
const isParty = () => !!document.querySelector('.pf-root');
const inTiers = a => Object.values(sheet.keys).some(ks => ks.includes(norm(a)));
const onSheet = a => inTiers(a) || more.some(m => norm(m) === norm(a)); // false: a guess
// A status about this prompt's answers ("Guessing "x"", "No good guess.") goes back to On./Off. once it's out of date.
const settle = () => { if (/"|^No |^Loading a guess/.test($('st').textContent)) status(settings.auto ? 'On.' : 'Off.'); };

async function autoAnswer(box) {
  const p = promptText, still = () => settings.auto && myTurnBox() === box && readPrompt() === p;
  const ready = pending && !used.has(norm(pending)) ? typeText(pending) : null;
  const preTyped = ready && box.value && ready.startsWith(box.value); // pre-type got all or part of it in already
  // A short think (shorter when it's already typed), but never before the question has been up READ_MS, so you can read it.
  await sleep(Math.max(preTyped ? think() * 0.4 : think(), promptAt + READ_MS + Math.random() * 400 - Date.now()));
  if (!still() || !sheet) return;
  box.focus();
  let answer, said;
  if (preTyped && ready.startsWith(box.value)) {
    answer = pending; said = ready;
    status(`Sending "${ready}"`);
    if (!await typeOut(box, ready.slice(box.value.length), still)) return; // finish it if pre-type got cut off
  } else {
    pending = null;
    if (box.value) await clearBox(box, still);
    answer = nextAnswer();
    if (!answer) { status(!guess ? 'No answers left.' : guess.lists.includes(null) || (guess.fit.dict && guess.fit.parsed && !WORDS) ? 'Loading a guess.' : 'No good guess.'); return; }
    const repeats = [...used.values()].slice(0, -2); // never the answer that was just said
    if (settings.mistakes && repeats.length && Math.random() < 0.06) { // now and then (with something to send after): try something said earlier, get turned down, move on
      const r = plain(rand(repeats));
      status(`Repeating "${r}" on purpose.`);
      if (!await typeOut(box, r, still)) return;
      pressEnter(box);
      await sleep(900 + Math.random() * 400);
      if (!still()) return;
      await clearBox(box, still);
    }
    said = typeText(answer);
    status(`${onSheet(answer) ? 'Typing' : 'Guessing'} "${said}"`);
    if (!await typeOut(box, said, still)) return;
  }
  await sleep(keyMs() * 2);
  if (!still()) return;
  pending = null;
  await send(box, said);
  if (!onSheet(answer) && guess) guess.tried.add(norm(answer)); // the whole answer's key: a 2-word try and the whole one are one guess
  status(`Sent "${said}"`);
  // Wait for the game's verdict, up to 1.5 s: the puffer moves on, or your bubble shows the answer turned down.
  const turnedDown = () => { const b = document.querySelector('.pf-seat.me .pf-say.bad'); return !!b && plain(b.textContent) === said; };
  for (let i = 0; i < 10 && still() && !turnedDown(); i++) await sleep(150);
  if (promptText === p && turnedDown() && reject(said)) draw(); // don't try it again on this prompt
}
// Auto queue: when a party game ends, click "Play again" after a moment. Kicked for idling: click "Take a seat" the same way.
// Your room filled up after that: go to the lobby and click Quick Play (once; never Rated, never "Leave room").
const QUEUE = { again: ['Game over. Queuing again.', 'Clicked Play again.'], seat: ['Taking a seat.'] };
let queueAt = 0, queueFor = '', seatAt = 0;               // seatAt: when auto queue clicked Take a seat, until you're seated
const shownBtn = (sel, re) => [...document.querySelectorAll(sel)].find(b => isShown(b) && !b.disabled && re.test(b.textContent));
const playAgain = () => shownBtn('button.ds-next-btn', /play again/i);
const seatBtn = () => shownBtn('button.ds-begin-btn', /take a seat/i);
// Take a seat with text matching re near it.
function seatBtnBy(re) {
  const b = seatBtn();
  for (let el = b && b.parentElement, i = 0; el && i < 4; el = el.parentElement, i++) if (re.test(el.innerText)) return b;
  return null;
}
// Only with the kick message near the button (not the lobby's join screen), and your name still in the name box.
function takeSeat() { const name = gameInput(); return name && !name.value.trim() ? null : seatBtnBy(/kicked for being idle/i); }
// The lobby trip survives the page load in sessionStorage, for 30 s.
const FULL = 'krSolverFull', QUICK = 'krSolverQuick', HOLD = 30000;
const since = k => Date.now() - (+sessionStorage.getItem(k) || 0);
function toLobby() {
  if (since(FULL) < HOLD) return status('Room full.'); // went to the lobby a moment ago
  sessionStorage.setItem(FULL, Date.now());
  status('Room full. Quick Play.');
  (globalThis.__krGo || (u => location.assign(u)))('https://krillion.io/party'); // the test page stands in for the page load
}
function quickPlay() {
  if (since(FULL) > HOLD) return;
  if (/leave that room before joining/i.test(document.body.innerText)) { sessionStorage.removeItem(FULL); return status('Still in a room. Stopped.'); }
  const b = since(QUICK) > HOLD && shownBtn('button', /^\W*quick play\W*$/i);
  if (!b) return;
  sessionStorage.setItem(QUICK, Date.now());
  b.click();
  status('Clicked Quick Play.');
}
function autoQueue() {
  if (seatAt) { // after Take a seat: seated, the room is full, or nothing for a while
    if (document.querySelector('.pf-seat.me') && !seatBtn()) { seatAt = 0; status('Took a seat.'); }
    else if (seatBtnBy(/this room is full/i)) { seatAt = 0; toLobby(); }
    else if (Date.now() - seatAt > 8000) { seatAt = 0; status('Not seated.'); }
  }
  const btn = playAgain() || takeSeat(), kind = !btn ? '' : btn.matches('.ds-begin-btn') ? 'seat' : 'again';
  if (kind !== queueFor) { // a button showed up or went away
    if (queueFor && $('st').textContent === QUEUE[queueFor][0]) status(settings.auto ? 'On.' : 'Off.'); // gone before the click
    queueFor = kind; queueAt = Date.now() + 1500 + Math.random() * 1500;
    if (kind) status(QUEUE[kind][0]);
    return;
  }
  if (!kind || Date.now() < queueAt) return;
  queueAt = Date.now() + 5000; // one click, then wait for the page to move on
  btn.click();
  if (kind === 'seat') seatAt = Date.now(); else status(QUEUE.again[1]);
}

// Pre-type (party only): while someone else holds the puffer, keep one unused answer typed in the box, ready to send.
// If someone says it first, delete it and type another.
let pending = null, pretypeBlocked = '';
async function pretype(box) {
  const p = promptText, still = () => settings.auto && settings.pretype && readPrompt() === p && gameInput() === box && !myTurnBox();
  const want = pending && !used.has(norm(pending)) ? typeText(pending) : null;
  if (want && box.value === want) return; // ready
  if (box.value) {
    if (pending) status(`"${plain(pending)}" was said. Typing another.`);
    await clearBox(box, still);
    if (!still()) return;
  }
  pending = nextAnswer();
  if (!pending) return;
  await sleep(think());
  if (!still()) return;
  const target = typeText(pending);
  status(`Pre-typing "${target}"`);
  const done = await typeOut(box, target, still);
  // The game may not keep text typed before your turn; then stop trying for this question.
  if (done && box.value !== target) { pretypeBlocked = p; pending = null; status('Pre-type paused: the game clears the box.'); }
  else if (done) status(`Pre-typed "${target}"`);
}

// Contribute answers: newly learned party answers wait in the outbox until the collector takes them.
const SEND_MAX = 50, OUTBOX_MAX = 1000, FLUSH_MS = 5 * 60 * 1000;
let flushing = false, flushAt = 0, over = false;
function queue(key, answer, tier) {
  const n = Object.keys(outbox).length;
  if (!settings.contribute || archived || sent[key] || outbox[key] || answer.length > 100 || n >= OUTBOX_MAX) return;
  if (!n) flushAt = Math.max(flushAt, Date.now() + FLUSH_MS); // the first one waits for game end or a few minutes
  outbox[key] = [promptText, answer, tier];
}
async function flush() {
  const keys = Object.keys(outbox).slice(0, SEND_MAX);
  if (flushing || !keys.length) return;
  flushing = true; flushAt = Date.now() + FLUSH_MS;
  const items = [];
  for (const [prompt, answer, tier] of keys.map(k => outbox[k])) {
    let it = items.find(i => i.prompt === prompt);
    if (!it) items.push(it = { prompt, answers: [] });
    it.answers.push({ answer, tier });
  }
  try {
    await ask({ type: 'contribute', items });
    for (const k of keys) { delete outbox[k]; sent[k] = 1; }
    if (Object.keys(outbox).length) flushAt = Date.now() + 2000; // more left: the next batch goes soon
    save();
  } catch {} finally { flushing = false; } // failed: it stays in the outbox for the next try
}

function tick() {
  if (settings.queue) { autoQueue(); quickPlay(); } else queueFor = '';
  if (settings.contribute) { const end = !!playAgain(); if ((end && !over) || Date.now() >= flushAt) flush(); over = end; }
  const box = myTurnBox(), out = document.querySelector('.pf-seat.me.out');
  if (out) settle();
  turnAt = box ? turnAt || Date.now() : 0;
  sender(box); // before the busy check: nothing auto answer or pre-type wait on can hold up a send
  debug(box);
  if (busy && Date.now() - busyAt > 15000) busy = false; // watchdog: nothing should take this long
  if (busy) return;
  // The question changed (or went away) with our text still in the box: delete it now. Text you typed isn't ours.
  const left = gameInput();
  if (left && left.value && left.value === typed.v && typed.p !== readPrompt()) {
    pending = null;
    return run(() => clearBox(left));
  }
  if (!settings.auto) return;
  if (box) {
    if (!sheet) { status('Answer list still loading.'); return; }
    return run(() => autoAnswer(box));
  }
  const early = !out && settings.pretype && isParty() && sheet && gameInput();
  if (early && !early.disabled && pretypeBlocked !== promptText && Date.now() - promptAt >= READ_MS) run(() => pretype(early));
}
// Runs one job at a time (busy until it ends). A job the watchdog gave up on doesn't clear the next one's busy.
let busyAt = 0;
function run(job) {
  const at = busyAt = Date.now();
  busy = true;
  job().catch(() => {}).finally(() => { if (busyAt === at) busy = false; });
}
// What auto answer thinks, for testing on the real page: <html data-kr-debug="turn=1 busy=0 typed=… verdict=… sends=N">.
function debug(box) {
  const b = document.querySelector('.pf-seat.me .pf-say:is(.ok, .rest, .bad)');
  const d = `turn=${box ? 1 : 0} busy=${busy ? 1 : 0} typed=${typed.v} send=${toSend} verdict=${b ? `${b.className.match(/\b(ok|rest|bad)\b/)[1]}:${b.textContent.trim()}` : '-'} sends=${sends}`;
  if (document.documentElement.dataset.krDebug !== d) document.documentElement.dataset.krDebug = d;
}

// You take over: typing in the game's box yourself, or clicking an answer, switches auto answer off.
// (Auto answer's own key presses are made by script, so the browser marks them untrusted and they don't count.)
function takeOver(why) {
  if (!settings.auto) return;
  settings.auto = false; pending = null;
  save(); showSettings();
  status(`Auto answer is off: ${why}.`);
}
document.addEventListener('input', ev => { if (ev.isTrusted && ev.target.matches && ev.target.matches('input.ds-input')) takeOver('you typed'); }, true);

// ---- start ----
// One loop reads the page and runs auto answer, auto queue and contribute, about 7 times a second, hidden tab included.
(async () => {
  for (;;) {
    if (!alive()) return; // left behind by an extension reload
    try { scan(); tick(); } catch (e) { console.warn('Krillion Solver:', e); }
    await (settings.auto || settings.queue || settings.contribute ? sleep(150) : localSleep(150));
  }
})();

Promise.resolve().then(() => chrome.storage.local.get(['settings', 'learned', 'outbox', 'sent', 'rejected'])).then(s => {
  if (s.settings) settings = { ...settings, ...s.settings };
  if (s.learned) learned = s.learned;
  if (s.rejected) rejected = s.rejected;
  if (s.outbox) outbox = s.outbox;
  if (s.sent) sent = s.sent;
  showSettings();
  place(settings.pos);
  return ask({ type: 'index' });
}).then(idx => { INDEX = idx; scan(); draw(); }, () => {
  body.innerHTML = '<p class="msg">Could not load the answer archive. Reload the extension.</p>';
});
draw();
})();
