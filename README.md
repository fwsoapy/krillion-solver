# Krillion Solver

![Krillion Solver](og.png)

**[Open the solver](https://fwsoapy.github.io/krillion-solver/)**

Type a [Krillion](https://krillion.io) prompt and see every accepted answer, from the One in a Krillion gem down to Plankton. Click an answer to copy it. Tap the mic and say the prompt; it snaps to the closest one, so "2024 winner olympics" still finds the Winter Olympics prompt.

It covers every daily dive since dive #1 on July 16, 2026.

## The extension

`extension/` is a Chrome extension for krillion.io. It reads the prompt off your screen in the daily dive and in Puffer Party and opens a panel with the answers.

- **Crosses off used answers.** In Puffer Party it watches the other players' bubbles and hides every answer someone already gave. Yours drop off when you press Enter.
- **Learns party prompts.** Party mode has prompts the daily dive never used. The extension saves every accepted answer it sees, with its tier, so the next time that prompt comes up you get a list.
- **Auto answer** (off by default). On your turn it picks a random unused answer from the tier range you set, types it one key at a time at the speed you pick, and presses Enter. Switch on "Make mistakes" and it sometimes makes a typo and fixes it, or tries an answer someone already said. Keep it to unrated rooms: in rated ones you move other people's ratings.
- Click any answer to type it into the game's box.

To install it:

1. Run `node build.js`
2. Open `chrome://extensions` and switch on Developer mode
3. Click **Load unpacked** and pick the `extension` folder

After a rebuild, click the reload arrow on the extension's card. New daily dives load by themselves, so you only rebuild to pick up new site code.

## Where the answers come from

Krillion doesn't publish its answer sheets, so `update.js` merges three fan archives:

- [krillion.run](https://krillion.run/answers/archive/) has the full list for each day
- [minutecryptic.today](https://minutecryptic.today/krillion-answers) fills in answers and gems krillion.run missed
- [The Word Finder](https://www.thewordfinder.com/misc-solvers/krillion-answers/) covers the one day krillion.run lacks (Nov 3)

The last 29 days match The Word Finder's official counts to within a handful of answers. 17 small prompts, like "Name a country that borders Brazil", have no gem in any source. The game seems to skip the gem on short closed lists, and the solver says so.

## Run it yourself

The page loads `data/` with `fetch`, so open it from a local server, not as a file:

```bash
python -m http.server 8000
```

Then go to http://localhost:8000.

```bash
node update.js    # download new days and rebuild data/ (cached in .cache/)
node build.js     # copy the data and match.js into extension/
node test.js      # matching, merging, parsing, and a check of every data file
```

`mock-game.html` copies the game's page structure and runs the extension's script against it. Use it to test panel changes without a live game.

## Keeping it current

`.github/workflows/update.yml` runs `update.js` every morning and commits the new day. Turn on Actions for the repo and it keeps the site up to date.

## License

MIT. Not affiliated with Krillion. The tier art belongs to the game.
