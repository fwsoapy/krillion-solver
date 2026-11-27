// Copies what the extension shares with the site into extension/: match.js and the answer data.
// Run after node update.js: node build.js. Then reload the extension in chrome://extensions.
const fs = require('fs'), path = require('path');
const ext = path.join(__dirname, 'extension');
if (!fs.existsSync(path.join(__dirname, 'data', 'index.json'))) throw new Error('no data yet: run node update.js first');
// The word list for letter-pattern prompts ("Name an English word containing “bio”"): a-z words of 3+ letters with a vowel,
// most common first, kept in data/words.txt (tracked) and rebuilt here when the frequency list is cached.
// The list comes from film subtitles, so it drops slurs, sexual terms and strong profanity: auto answer types into public
// games. Stems match anywhere in the word; ^ and $ pin the short ones that are inside innocent words (basement, therapist).
const BLOCK = /fuck|shit|cunt|bitch|bastard|whore|slut|cocksuck|^dick|^cocks?$|^twat|^wank|prick|bollock|asshole|^arse(s|d|holes?)?$|^ass$|^asses$|jackass|dumbass|piss|nigg|chink|^spics?$|kike|gook|wetback|raghead|towelhead|beaner|^coons?$|^pakis?$|^japs?$|^wops?$|^yids?$|dago|tranny|fag|dyke|^homos?$|retard|spaz|spastic|mongoloid|midget|porn|puss|penis|vagina|dildo|orgasm|orgy|orgies|blowjob|handjob|^anal$|^anus$|boob|tits|titties|clit|^cums?$|^semen|sperm|^horny|masturbat|ejaculat|^rap(e|ed|es|ing|ist|ists)$|erotic|sexy|sexual|^sex|bdsm|fetish|nude|naked|hooker|^hoes?$|^skank|scrotum|testicle|^nazi|hitler/;
const freq = path.join(__dirname, '.cache', 'freq', 'en_50k.txt');
if (fs.existsSync(freq)) {
  const all = fs.readFileSync(freq, 'utf8').split('\n').map(l => l.split(' ')[0]).filter(w => /^[a-z]{3,}$/.test(w) && /[aeiouy]/.test(w));
  const words = all.filter(w => !BLOCK.test(w));
  fs.writeFileSync(path.join(__dirname, 'data', 'words.txt'), words.join('\n'));
  console.log(`data/words.txt: ${words.length} words (${all.length - words.length} blocked).`);
}
fs.copyFileSync(path.join(__dirname, 'match.js'), path.join(ext, 'match.js'));
fs.rmSync(path.join(ext, 'data'), { recursive: true, force: true });
fs.cpSync(path.join(__dirname, 'data'), path.join(ext, 'data'), { recursive: true });
if (!fs.existsSync(path.join(ext, 'data', 'words.txt'))) console.log('No data/words.txt and no .cache/freq/en_50k.txt (node update.js downloads it): skipped the word list.');
// Party answers (data/party.json, from node party.js) came along with data/.
if (fs.existsSync(path.join(ext, 'data', 'party.json'))) console.log(`extension/data/party.json: ${JSON.parse(fs.readFileSync(path.join(ext, 'data', 'party.json'), 'utf8')).length} party prompts.`);
else console.log('No data/party.json (node party.js makes it): skipped party answers.');
// Extra prompts from a local, unlicensed dump (extra.js): into extension/data/ only, never data/.
if (fs.existsSync(path.join(__dirname, '.cache', 'p0rt1k', 'krillion.sql'))) require('./extra.js')();
const n = JSON.parse(fs.readFileSync(path.join(ext, 'data', 'index.json'), 'utf8')).length;
console.log(`extension/ ready: ${n} prompts. Load it unpacked from chrome://extensions.`);
