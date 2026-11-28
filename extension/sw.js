// Service worker: serves answer data to the panel and opens the panel from the toolbar icon.
// Data comes from the copy bundled with the extension (data/, made by ../build.js). Days newer than that copy are fetched
// from krillion.run, so the panel keeps working on new daily dives without rebuilding the extension.
importScripts('match.js');
const { TIERS } = KrMatch;
const FIRST_DAY = '2026-07-16';
const RETRY_MS = 10 * 60 * 1000; // wait before asking krillion.run again for a day it didn't have
// The collector's Apps Script web app URL (see collector/README.md). Empty: "Contribute answers" sends nothing.
const CONTRIBUTE_URL = 'https://script.google.com/macros/s/AKfycbz0n0fWcs1GwbZi0MFAOv7ymTW-v5jEgY8n0lRvlymPF8ueUirg96Ecfdu8PsIxHpVE/exec';

let bundled = null;           // index.json
const fresh = new Map();      // date -> { entries, prompts } fetched from krillion.run
const missed = new Map();     // date -> time it was missing

const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const diveOf = d => Math.round((Date.parse(d) - Date.parse(FIRST_DAY)) / 864e5) + 1;
const getJSON = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };

async function fetchDay(d) {
  if (fresh.has(d)) return;
  if (Date.now() - (missed.get(d) || 0) < RETRY_MS) return;
  try {
    const day = await getJSON(`https://krillion.run/data/answers/${d}.json`);
    const prompts = day.prompts.map(p => ({ t: p.text, tiers: Object.fromEntries(TIERS.map(t => [t.id, p.tiers[t.id] || []])) }));
    const entries = prompts.map((p, i) => ({ d, n: diveOf(d), p: i + 1, t: p.t, c: TIERS.map(t => p.tiers[t.id].length), g: p.tiers.krillion }));
    fresh.set(d, { entries, prompts });
  } catch {
    missed.set(d, Date.now());
  }
}

async function index() {
  bundled = bundled || await getJSON(chrome.runtime.getURL('data/index.json'));
  const last = bundled[bundled.length - 1].d, today = todayET();
  const want = [];
  for (let d = addDays(last, 1); d <= today && want.length < 14; d = addDays(d, 1)) want.push(d);
  await Promise.all(want.map(fetchDay));
  return bundled.concat(...want.filter(d => fresh.has(d)).map(d => fresh.get(d).entries));
}

async function prompt(d, p) {
  if (fresh.has(d)) return fresh.get(d).prompts[p - 1];
  return getJSON(chrome.runtime.getURL(`data/${d}/p${p}.json`));
}

// The word list (data/words.txt) as one string. The panel asks once per page and keeps it.
async function wordList() {
  const r = await fetch(chrome.runtime.getURL('data/words.txt'));
  if (!r.ok) throw new Error(`words.txt: ${r.status}`);
  return r.text();
}

// Party prompts the archive lacks, with answers (data/party.json, made by ../party.js). The website's copy is refreshed
// every few hours from the collector, so that comes first, at most every 6 hours; on any error the last list or the bundled copy.
const PARTY_URL = 'https://fwsoapy.github.io/krillion-solver/data/party.json';
let partyList = null, partyAt = 0;
const party = async () => {
  if (partyList && Date.now() - partyAt < 6 * 3600e3) return partyList;
  partyAt = Date.now();
  return partyList = await fetch(PARTY_URL, { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject(new Error(`party.json: ${r.status}`)))
    .then(j => Array.isArray(j) && j.length && j.every(p => p && typeof p.t === 'string') ? j : Promise.reject(new Error('bad party.json')))
    .catch(() => partyList || getJSON(chrome.runtime.getURL('data/party.json')).catch(() => []));
};

// Extra prompts bundled only in a local build (data/extra.json, made by ../extra.js). Missing: none.
let extraList = null;
const extra = async () => extraList = extraList || await getJSON(chrome.runtime.getURL('data/extra.json')).catch(() => []);
// Local build flags (data/local.json, from build.js). Missing: none.
const local = () => getJSON(chrome.runtime.getURL('data/local.json')).catch(() => ({}));

// Sends { items: [{ prompt, answers: [{ answer, tier }] }] }. text/plain skips the CORS preflight Apps Script can't answer.
async function contribute(items) {
  if (!CONTRIBUTE_URL) throw new Error('no collector URL set');
  const r = await fetch(CONTRIBUTE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ items }) });
  const j = r.ok ? await r.json() : null;
  if (!j || !j.ok) throw new Error(`collector: ${r.status} ${j ? j.error : ''}`);
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // "sleep": the panel's timer while its tab is hidden (Chrome slows a hidden tab's own timers, not this worker's).
  const job = msg.type === 'index' ? index() : msg.type === 'prompt' ? prompt(msg.d, msg.p)
    : msg.type === 'contribute' ? contribute(msg.items) : msg.type === 'words' ? wordList() : msg.type === 'party' ? party() : msg.type === 'extra' ? extra() : msg.type === 'local' ? local()
    : msg.type === 'sleep' ? new Promise(r => setTimeout(() => r(true), Math.min(Math.max(+msg.ms || 0, 0), 10000))) : null;
  if (!job) return false;
  job.then(data => reply({ data }), err => reply({ error: String(err) }));
  return true; // reply comes later
});

const SITES = /^https:\/\/([a-z0-9-]+\.)?krillion\.io\//i;
chrome.action.onClicked.addListener(async tab => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle' });
  } catch {
    // Tab was open before the extension loaded: add the panel now.
    if (!SITES.test(tab.url || '')) return;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['match.js', 'content.js'] });
  }
});
