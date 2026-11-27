# Collector

Where the extension's "Contribute answers" sends party prompts and answers. It's a Google Apps Script web app that adds rows to a Google Sheet, so it costs nothing and needs no server. Each row is a time (set by the script), the prompt as shown in the game, the answer and its tier id. Nothing else is sent.

## Deploy

1. Create a new Google Sheet, say "Krillion contributions".
2. In the sheet, open **Extensions > Apps Script**. Delete what's in `Code.gs` and paste in [`Code.gs`](Code.gs) from this folder. Save.
3. Click **Deploy > New deployment**. Pick **Web app** as the type.
4. Set **Execute as** to **Me** and **Who has access** to **Anyone**. Click **Deploy** and allow access when Google asks. The script only gets access to this one sheet.
5. Copy the web app URL (it ends in `/exec`).
6. Paste it into `CONTRIBUTE_URL` at the top of `extension/sw.js`, then reload the extension.

To change the script later, edit it and use **Deploy > Manage deployments > Edit > New version**. That keeps the same URL. A new deployment gets a new URL.

The URL isn't a secret: it ships in the public extension, and anyone who has it can add rows. The script only accepts the six tier ids, prompts up to 200 characters and answers up to 100, and at most 100 answers a request. Delete junk rows by hand.

Values that start with `= + - @` are stored with a leading `'`, so Sheets keeps them as text and never runs them as formulas.

## Get the data

In the sheet, **File > Download > Comma-separated values (.csv)**. The columns are `time, prompt, answer, tier`. The same answer can show up more than once when several people send it.
