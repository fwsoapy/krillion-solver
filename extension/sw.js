// Service worker: serves answer data to the panel and opens the panel from the toolbar icon.
// Data comes from the copy bundled with the extension (data/, made by ../build.js). Days newer than that copy are fetched
// from krillion.run, so the panel keeps working on new daily dives without rebuilding the extension.
importScripts('match.js');
const { TIERS } = KrMatch;
const FIRST_DAY = '2026-07-16';
const RETRY_MS = 10 * 60 * 1000; // wait before asking krillion.run again for a day it didn't have

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

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const job = msg.type === 'index' ? index() : msg.type === 'prompt' ? prompt(msg.d, msg.p) : null;
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
