# FORGESIGNAL

> Extracts the signal. Renders the verdict. Determines whether a repository has the raw material to produce a product of consequence.

**Live:** [forgesignal.vercel.app](https://forgesignal.vercel.app)

---

## What Is This?

FORGESIGNAL is an AI-powered viability agent that analyzes public GitHub repositories and determines whether they contain the raw material to build a product worth shipping.

It does not just list what could be built. It reasons about whether something *should* be built — factoring in market demand, technical depth, monetization potential, and build scale — then renders a verdict: **GO**, **PASS**, or **REVISIT**.

It also analyzes documents (PDFs and scanned images) for the same purpose.

---

## What You Need

### 1. Anthropic API Key (Required)
FORGESIGNAL uses Claude to reason about repositories and documents. You need an Anthropic API key to use it.

Get yours at [console.anthropic.com](https://console.anthropic.com)

Your key is stored in browser memory only. It is never sent to any server other than Anthropic's API directly.

### 2. GitHub Personal Access Token (Recommended)
Without a token, GitHub limits API requests to 60 per hour — enough for a few analyses. With a classic token, that limit increases to 5,000 per hour.

To generate one:
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Tokens (classic)**
3. Click **Generate new token (classic)**
4. Check only the `public_repo` scope
5. Copy the token starting with `ghp_`

Your token is stored in browser memory only. It never leaves your browser except to authenticate with GitHub's API.

---

## How to Use It

### Viability Agent Tab

1. Paste your Anthropic API key and GitHub token into the key fields at the top
2. Choose your analysis mode — **QUICK** or **DEEP**
3. Paste any public GitHub repository URL
4. Click **RUN AGENT**

### Document Tab

1. Paste your Anthropic API key into the key field
2. Either upload a file (PDF, PNG, JPG, WEBP, GIF) or paste a public URL to a document
3. Click **ANALYZE**

---

## Analysis Modes

### QUICK (~30 seconds)
Reads the repository structure, languages, topics, and a sample of actual file contents. Reasons about viability using Claude's internal knowledge. No live web search. Best for a fast first pass across many repositories.

### DEEP (3–5 minutes)
Does everything QUICK does, plus performs live web searches for current market trends, demand signals, and competitor landscape before rendering a verdict. Best for final evaluation of shortlisted repositories.

---

## What the Output Means

| Output | Description |
|---|---|
| **Consequence Score** | 0–100 rating of the repo's potential to produce a meaningful product |
| **Verdict** | GO / PASS / REVISIT — the agent's recommendation |
| **Repo Summary** | What the repository actually does |
| **Domain Signals** | Key patterns detected in the codebase |
| **Market Intelligence** | Live trend data (DEEP mode only) |
| **Consequence Reasoning** | Why the score was assigned |
| **Build Angles** | Specific product ideas with scale, monetization model, tech stack, and MVP timeline |
| **Competitor Map** | Known competitors and where the gaps are (DEEP mode only) |
| **Risk Factors** | Real blockers to building in this domain |
| **Next Action** | One concrete step to take right now |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| AI Reasoning | Anthropic Claude (claude-sonnet-4) |
| Web Search | Anthropic web search tool (DEEP mode) |
| API Relay | Vercel serverless function |
| Hosting | Vercel |
| Repo Data | GitHub REST API |

---

## Local Development

```bash
git clone https://github.com/IainAmosMelchizedek/FORGESIGNAL.git
cd FORGESIGNAL
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Deployment

FORGESIGNAL auto-deploys to Vercel on every push to `main`.

To deploy manually:
```bash
vercel --prod
```

---

## Issues, Feedback & Contributions

All feedback is welcome — bugs, feature requests, UX issues, analytical inaccuracies, or anything else you encounter while using FORGESIGNAL.

**To report an issue:**
- Open a [GitHub Issue](https://github.com/IainAmosMelchizedek/FORGESIGNAL/issues) — preferred for bugs and feature requests
- Or email directly: **iain@safe-passage-strategies.com**

There are no wrong categories. If something feels off, broken, or could be better — say so.

---

## License

© 2026 Iain Amos Melchizedek. All Rights Reserved.
