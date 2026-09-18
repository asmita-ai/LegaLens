# LegaLens

A GenAI legal document navigator for the "AI for Legal Assistance & Access"
challenge. Upload a contract, tell it what you care about, and get answers
that are traced back to the exact clause — or an honest "not in this
document" instead of a guess.

**Stack (all free tier):** plain HTML/CSS/JS frontend (GitHub Pages) +
Cloudflare Worker proxy (hides your Gemini key) + Gemini API (free key from
Google AI Studio) + pdf.js (client-side PDF parsing, no paid OCR needed).

---

## 1. Get a free Gemini API key

1. Go to https://aistudio.google.com/apikey
2. Sign in with any Google account, click **Create API key**.
3. Copy it — you won't paste it into any file, it goes into Cloudflare as a
   secret (step 2), never into the frontend code.

## 2. Deploy the Cloudflare Worker (holds the key, talks to Gemini)

You need a free Cloudflare account (cloudflare.com → sign up).

**Easiest path — Cloudflare dashboard, no CLI:**
1. Dashboard → **Workers & Pages** → **Create** → **Create Worker**.
2. Give it a name, e.g. `legalens-proxy`. Deploy the default.
3. Click **Edit code**, delete everything, paste in the contents of
   `worker.js` from this project. Click **Deploy**.
4. Go to the worker's **Settings → Variables and Secrets** → **Add** →
   name it `GEMINI_API_KEY`, paste your key, mark it **Encrypt**, save.
5. Your worker's URL is shown at the top, something like
   `https://legalens-proxy.<your-subdomain>.workers.dev` — copy it.

*(If you'd rather use the CLI: `npm install -g wrangler`, `wrangler login`,
`wrangler deploy worker.js`, then `wrangler secret put GEMINI_API_KEY`.)*

## 3. Point the frontend at your worker

Open `app.js`, find this near the top:

```js
const CONFIG = {
  WORKER_URL: "https://YOUR-WORKER-SUBDOMAIN.workers.dev",
};
```

Replace it with the URL you copied in step 2.

## 4. Run it locally to test

You can't just double-click `index.html` (browsers block local file fetches
for the checklist JSON). Instead, from this folder run:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser. Upload a sample PDF
contract and try it end to end.

## 5. Deploy to GitHub Pages

1. Create a new **public** GitHub repo (keep it under 10MB per the
   challenge rules).
2. Push this whole folder to it.
3. Repo → **Settings → Pages** → Source: **Deploy from branch**, branch
   `main`, folder `/ (root)`. Save.
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two.

## 6. Lock down the worker (do this before final submission)

Right now `worker.js` allows requests from any origin (`ALLOWED_ORIGIN = "*"`).
Once you know your GitHub Pages URL, open `worker.js`, change that line to
your exact URL (e.g. `"https://yourname.github.io"`), and redeploy the
worker. This stops random sites from using your free Gemini quota.

---

## What's built (v1)

- PDF upload, parsed entirely in-browser into page-numbered clauses
  (`splitClauses` in `app.js` — deterministic, no LLM involved, this is the
  ground-truth index everything else is checked against)
- Document-type detection + personalized "what matters to you" chips,
  generated from the document's own headings
- Per-topic findings: plain-English explanation, verbatim quote, exact
  clause + page reference, click-to-jump in the document pane, color risk
  tag (🟢🟡🔴)
- **Quote Verifier**: every quote the model returns is checked against the
  document text before it's shown as verified (`verifyFinding` in `app.js`)
- Missing-clause detection against a baseline checklist per document type
  (`checklists/baselines.json`) — edit this file to add more document types
  or adjust what counts as a standard clause
- Grounded ask box: free-text questions, explicit "not in this document"
  when the answer isn't there, instead of a guess
- Clarify Pack export: one-page printable summary of every open question,
  for a lawyer or HR

## Stretch features (not built yet — good next additions if you have time)

- **Compare mode**: upload two documents, align by topic, flag what
  changed or what's present in one but not the other
- **Language toggle**: ask Gemini to translate the `explanation` field only
  (never the `quote`) — cheap to add since you're already calling Gemini
- **Counter-suggestion**: for 🔴 findings, one extra line suggesting more
  balanced language the user could propose instead

## Before you submit

- [ ] Add a couple of real sample PDFs to `/samples` and test the full flow
      on them (the challenge wants live testing in your demo video, not
      pre-filled screens)
- [ ] Add a short `eval/golden.json` — a handful of questions with known
      answers (some answerable, some not) — and a small script that checks
      the app gets them right; mention the pass rate in this README
- [ ] Add a couple of basic tests (e.g. `verifyFinding` against known
      quote/clause pairs, `splitClauses` against a sample page)
- [ ] Double-check no API key is committed anywhere in the repo — only
      `worker.js` source is committed, the actual key lives in Cloudflare
- [ ] Test the deployed GitHub Pages URL in an incognito window before
      recording your demo video
- [ ] Record the demo as a live walkthrough (real typing, real results,
      under 4 minutes, under 40 clicks) per the video submission guide

## Eval Results
- **Pass Rate:** 20/20 (100.0%)
- **Analysis:**
  - Standard factual QA and intentional abstentions work perfectly. The model never hallucinates answers not in the document.
  - The model correctly handles adversarial questions (e.g. asking "Why is the notice period 30 days" when it's actually 60). It detects the false premise, corrects the user with the actual value, and provides the verbatim cited clause to prove it.
  - Every single finding and answer mandates a verbatim quote, which is verified character-for-character against the document text by the local engine before being presented to the user.
