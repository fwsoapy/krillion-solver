// Copies what the extension shares with the site into extension/: match.js, the answer data and the icon.
// Run after node update.js: node build.js. Then reload the extension in chrome://extensions.
const fs = require('fs'), path = require('path');
const ext = path.join(__dirname, 'extension');
if (!fs.existsSync(path.join(__dirname, 'data', 'index.json'))) throw new Error('no data yet: run node update.js first');
fs.copyFileSync(path.join(__dirname, 'match.js'), path.join(ext, 'match.js'));
fs.copyFileSync(path.join(__dirname, 'tiers', 'krillion.png'), path.join(ext, 'icon.png'));
fs.rmSync(path.join(ext, 'data'), { recursive: true, force: true });
fs.cpSync(path.join(__dirname, 'data'), path.join(ext, 'data'), { recursive: true });
const n = JSON.parse(fs.readFileSync(path.join(ext, 'data', 'index.json'), 'utf8')).length;
console.log(`extension/ ready: ${n} prompts. Load it unpacked from chrome://extensions.`);
