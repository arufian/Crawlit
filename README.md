<p align="center">
  <img src="logo.svg" width="110" alt="Crawlit logo"/>
</p>

<h1 align="center">Crawlit</h1>

<p align="center">
  <b>Give your AI agent the web: Google search, scraping and crawling on your own machine.</b><br/>
  Clean Markdown for LLMs. Firecrawl-compatible API. One <code>docker compose up</code>. $0 per page, forever.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"/></a>
  <img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker ready"/>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict"/>
  <img src="https://img.shields.io/badge/Firecrawl-compatible-orange" alt="Firecrawl compatible"/>
  <img src="https://img.shields.io/badge/AI%20agents-Claude%20Code%20%7C%20Codex%20%7C%20OpenCode-8A2BE2" alt="Works with AI agents"/>
</p>

<p align="center">
  <a href="https://labs.arufian.dev/crawlit/">Website</a> ·
  <a href="#quickstart-30-seconds">Quickstart</a> ·
  <a href="#use-it-from-your-ai-agent">AI agent skill</a> ·
  <a href="#api">API</a> ·
  <a href="#benchmarks">Benchmarks</a> ·
  <a href="https://labs.arufian.dev/crawlit/llms.txt">llms.txt</a>
</p>

---

```bash
# Search Google and get every result back as clean Markdown — one request
curl -X POST localhost:3000/v1/search -H 'Content-Type: application/json' \
  -d '{"query": "fastify rate limit plugin", "limit": 3, "scrapeOptions": {"formats": ["markdown"]}}'
```

```jsonc
{
  "success": true,
  "data": {
    "engine": "google",
    "results": [
      {
        "position": 1,
        "title": "fastify/fastify-rate-limit",
        "url": "https://github.com/fastify/fastify-rate-limit",
        "snippet": "A low overhead rate limiter for your routes...",
        "markdown": "# @fastify/rate-limit\n\nA low overhead rate limiter for your routes..."
      }
      // ...
    ]
  }
}
```

## Why Crawlit

AI agents are only as good as what they can read. The hosted options charge per page, cap your usage, or send your browsing through someone else's servers. Crawlit is the same capability as a single container you own:

- **Everything an agent needs in one API.** Search the web, read a page, read 100 pages at once, map a site, or crawl it. You get Markdown back, with no HTML soup.
- **Fast by default.** Plain HTTP when that's enough and a stealth browser only when a page needs JavaScript. A worker-thread extraction pool, keep-alive connections, and a Redis cache.
- **Drop-in for Firecrawl.** `/v1/scrape`, `/v1/crawl` and `/v1/map` take the same requests as Firecrawl, so existing clients work by changing the base URL.
- **Built for agents.** The [crawlit-skill](https://github.com/arufian/crawlit-skill) pack teaches Claude Code, Codex, OpenCode and others to use it instead of their built-in web tools.
- **Free and private.** MIT license, no API key, no per-page billing, and your queries never leave your machine except to the sites you fetch.

## Benchmarks

v1.1 against v1.0, same machine, same network, same requests. Apple M1, 8 cores, Docker Desktop.

| Operation | v1.0 | v1.1 |
|---|---|---|
| **Crawl 40 pages** (books.toscrape.com) | stalled at 2/40 after 330s | **done in 4–7s** |
| **Scrape a 1.1 MB docs page** (Node.js `fs` docs) | 6.6s | **2.8–3.1s** |
| **10 parallel scrapes** (Wikipedia) | 7.5s | **3.6s** |
| **Map a site** (fastify.dev) | 1.1s | **0.7s** |
| **Web search** | 0 results | **5 relevant results** |
| **Repeated search** (cache hit) | — | **~10 ms** |

Where the speed comes from:

- linkedom instead of JSDOM for Readability: 3–4× faster with identical text.
- One HTML parse per page instead of three.
- Extraction runs in worker threads, so a huge page doesn't block other requests.
- The crawl queue was throttled to 2 jobs/s globally and had racy counters. Both are fixed.

Reproduce it yourself against any running instance:

```bash
scripts/benchmark.sh
```

## Quickstart (30 seconds)

You only need Docker.

```bash
git clone https://github.com/arufian/Crawlit.git
cd Crawlit
docker compose up -d --build     # first build downloads Chromium (~90 MB)
curl localhost:3000/health       # {"status":"ok","version":"1.1.0",...}
```

Try it:

```bash
# Any page → Markdown
curl -X POST localhost:3000/v1/scrape -H 'Content-Type: application/json' \
  -d '{"url": "https://en.wikipedia.org/wiki/Web_crawler"}'

# Search Google
curl -X POST localhost:3000/v1/search -H 'Content-Type: application/json' \
  -d '{"query": "best open source web crawler", "limit": 5}'
```

```bash
docker compose down      # stop (cache persists)
docker compose down -v   # stop + wipe Redis data
```

## Use it from your AI agent

Install the [crawlit-skill](https://github.com/arufian/crawlit-skill) and your agent uses Crawlit for all web work: searching, reading docs, and crawling sites.

```bash
# Claude Code
claude plugin marketplace add arufian/crawlit-skill
claude plugin install crawlit@crawlit-skills

# Codex
codex plugin marketplace add arufian/crawlit-skill
codex plugin add crawlit@crawlit-skills

# OpenCode, Cursor, and other agents (GitHub CLI)
gh skill install arufian/crawlit-skill skills/crawlit --agent opencode --scope user
```

Then just ask:

- "Search the web for the latest Playwright Docker best practices and summarize them"
- "Read https://docs.example.com/api and write a client for it"
- "Crawl the docs under https://docs.example.com/guide and save them as markdown"
- "What pages does https://example.com have about pricing?"

Building your own agent? Any HTTP client works. The API is small, JSON in and JSON out, and documented below and in [`llms.txt`](https://labs.arufian.dev/crawlit/llms.txt).

## What you can do

| Endpoint | What it does | Typical time |
|---|---|---|
| [`POST /v1/search`](#search-the-web) | Google search (DuckDuckGo fallback), optional Markdown of every result | 0.5–3s |
| [`POST /v1/scrape`](#scrape-a-single-page) | One URL → Markdown / HTML / links / LLM-extracted JSON | 0.3–3s |
| [`POST /v1/batch/scrape`](#batch-scrape) | Up to 100 URLs in parallel, one request | seconds |
| [`POST /v1/map`](#map-urls-no-content-fetch) | Every URL on a site (sitemaps + links), no content | < 1s |
| [`POST /v1/crawl`](#crawl-multiple-pages) | Async breadth-first crawl with depth, path and domain filters | ~10 pages/s |
| `GET /health` | Status, version, search engine availability | instant |
| `GET /metrics` | Prometheus metrics | instant |

Highlights:

- **Auto mode.** Plain HTTP first, then the stealth browser only for JS apps and bot walls.
- **Clean output.** GFM tables, absolute links, and no base64 image blobs.
- **Any page encoding.** Shift_JIS, EUC-JP and GBK pages decode correctly, and old frameset sites list their frames as links.
- **Speed and reliability.** Redirects are followed, identical concurrent requests are merged, and results are cached in Redis.
- **Optional extras.** Schema-guided LLM extraction (OpenAI or Anthropic), proxy support per request or globally, and Markdown files saved to disk with YAML frontmatter.

---

## API

All endpoints take and return JSON. Base URL: `http://localhost:3000`.

### Scrape a single page

```bash
curl -X POST http://localhost:3000/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "links"]
  }'
```

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | Page to scrape |
| `formats` | array | `["markdown"]` | `markdown`, `html`, `links`, `rawHtml` |
| `onlyMainContent` | boolean | `true` | Strip nav/ads via Mozilla Readability |
| `mode` | string | `"auto"` | `auto` (HTTP, browser only if the page needs it), `http` (HTTP only), or `browser` (always render JS) |
| `waitFor` | number | — | ms to wait after page load (implies browser) |
| `waitForSelector` | string | — | CSS selector to wait for before capturing (implies browser) |
| `actions` | array | — | Click/scroll/type actions (implies browser) |
| `proxy` | string | — | Proxy URL, e.g. `http://user:pass@host:port` |
| `save` | boolean | `false` | Save markdown to `./output/<host>/<path>.md` |
| `extract` | object | — | LLM extraction (see below) |
| `skipCache` | boolean | `false` | Bypass Redis cache |
| `timeout` | number | `30000` | Request timeout in ms |

The `x-crawlit-source` response header says which path produced the content: `http`, `browser`, or `cache`. Redirects are followed and `metadata.sourceURL` is the final URL. Plain-text, Markdown and JSON URLs are returned as-is.

<details>
<summary><b>Example: browser actions</b></summary>

```bash
curl -X POST http://localhost:3000/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "actions": [
      { "type": "click", "selector": ".load-more" },
      { "type": "wait", "delay": 1000 },
      { "type": "scroll" }
    ],
    "formats": ["markdown"],
    "save": true
  }'
```
</details>

<details>
<summary><b>Example: LLM extraction to typed JSON</b></summary>

```bash
curl -X POST http://localhost:3000/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://news.ycombinator.com",
    "formats": ["markdown"],
    "extract": {
      "schema": {
        "type": "object",
        "properties": {
          "topStory": { "type": "string" },
          "points": { "type": "number" }
        },
        "required": ["topStory"]
      },
      "prompt": "Extract the top story title and its points"
    }
  }'
```

Requires `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.
</details>

### Batch scrape

Scrape many URLs in parallel in one request. Accepts every scrape option above, plus `urls` and `concurrency`.

```bash
curl -X POST http://localhost:3000/v1/batch/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com", "https://docs.example.com/start"],
    "formats": ["markdown"],
    "concurrency": 8
  }'

# { "success": true, "total": 2, "completed": 2, "failed": 0,
#   "data": [{ "url": "...", "success": true, "markdown": "...", "metadata": {...} }, ...] }
```

| Field | Type | Default | Description |
|---|---|---|---|
| `urls` | array | required | 1–100 URLs; duplicates are scraped once |
| `concurrency` | number | `8` | Parallel scrapes (1–20) |

Failed URLs appear in `data` with `success: false` and an `error`; the request itself still succeeds. Unlike Firecrawl's async batch API, this endpoint responds when all pages are done.

### Search the web

```bash
curl -X POST http://localhost:3000/v1/search \
  -H "Content-Type: application/json" \
  -d '{ "query": "crawlit firecrawl alternative", "limit": 5 }'

# { "success": true, "data": { "query": "...", "engine": "google",
#   "results": [{ "title": "...", "url": "...", "snippet": "...", "position": 1 }], "total": 5 } }
```

| Field | Type | Default | Description |
|---|---|---|---|
| `query` | string | required | Search query (Google operators like `site:` work) |
| `limit` | number | `10` | 1–50 results (Google pages are fetched in parallel) |
| `engine` | string | `SEARCH_ENGINE` | `google` or `duckduckgo` |
| `lang` | string | `"en"` | Result language, e.g. `ja` |
| `country` | string | — | Two-letter country, e.g. `jp`, `us` |
| `tbs` | string | — | Time filter: `qdr:h`, `qdr:d`, `qdr:w`, `qdr:m`, `qdr:y` |
| `scrapeOptions` | object | — | Scrape every result and attach `markdown`/`metadata` (same fields as `/v1/scrape`) |
| `skipCache` | boolean | `false` | Results are cached for `SEARCH_CACHE_TTL_SECONDS` |

How Google is queried:

1. Plain HTTP to Google's lightweight results page (about 0.5s, direct result URLs).
2. If that is throttled, the stealth browser.
3. If Google is blocked both ways, DuckDuckGo. The response then contains `fallbackFrom` with the reason.

A blocked path is skipped for 10 minutes. `GET /health` shows each path's state. If every engine is blocked, the response has `blocked: true` and empty `results`. Heavy automated searching from one IP gets throttled by Google; set `PROXY_URL` to spread the load.

### Map URLs (no content fetch)

```bash
curl -X POST http://localhost:3000/v1/map \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://docs.example.com", "search": "/guide/" }'

# { "success": true, "links": [...], "total": 42 }
```

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | Site to map |
| `limit` | number | `5000` | Max URLs returned |
| `includeSubdomains` | boolean | `false` | Include `*.host` URLs |
| `search` | string | — | Only return URLs containing this text (case-insensitive) |
| `ignoreSitemap` | boolean | `false` | Use only the seed page's links |

Fetches the common sitemap locations, every `Sitemap:` listed in robots.txt, and the seed page's links in parallel, then merges them.

### Crawl multiple pages

```bash
# Start
curl -X POST http://localhost:3000/v1/crawl \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://docs.example.com", "maxDepth": 2, "limit": 100, "includePaths": ["^/docs/"] }'
# { "success": true, "id": "<crawl-id>", "url": "/v1/crawl/<crawl-id>" }

# Poll (paged; follow "next" until it's absent)
curl http://localhost:3000/v1/crawl/<crawl-id>
# { "status": "running", "completed": 12, "failed": 0, "total": 47, "next": "...", "data": [...] }

# Cancel
curl -X DELETE http://localhost:3000/v1/crawl/<crawl-id>
```

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | Seed URL |
| `maxDepth` | number | `3` | Max link depth from seed |
| `limit` | number | `100` | Max pages to crawl |
| `allowedDomains` | array | `[]` | Restrict to these domains (default: seed domain) |
| `includePaths` | array | — | Only follow URLs whose path matches one of these regexes |
| `excludePaths` | array | — | Skip URLs whose path matches any of these regexes |
| `mode` | string | `"auto"` | `auto`, `http`, or `browser` (see scrape) |
| `formats` | array | `["markdown"]` | Output formats |
| `onlyMainContent` | boolean | `true` | Readability extraction |
| `save` | boolean | `false` | Save each page to `./output/` |
| `proxy` | string | — | Proxy for all pages in this crawl |

Crawls respect robots.txt and skip binary assets (images, archives, PDFs).

### Saved files

With `save: true`, files land in `./output/` on your host (Docker volume), each with YAML frontmatter:

```markdown
---
title: "Getting Started"
url: "https://docs.example.com/getting-started"
scraped_at: "2026-04-25T10:00:00.000Z"
description: "..."
language: "en"
---

## Getting Started
...
```

---

## Comparison

| | Crawlit | [Crawl4AI](https://github.com/unclecode/crawl4ai) | [Jina Reader](https://jina.ai/reader/) | [Firecrawl](https://firecrawl.dev) | [Apify](https://apify.com) |
|---|---|---|---|---|---|
| **License** | MIT | Apache 2.0 | Proprietary (free tier) | AGPL-3.0 (OSS) / Proprietary (Cloud) | Proprietary |
| **Self-hosted** | $0 | $0 | $0 (limited) | $0 (complex setup, AGPL) | $0 (limited) |
| **Cloud (Paid)** | — | — | Pay-per-use | **$16/mo** (5K) · **$83/mo** (100K) · **$333/mo** (500K) | **$39/mo** (Starter) · **$199/mo** (Scale) |
| **Shape** | Docker Compose, API-first | Python library, CLI | URL prefix API (`r.jina.ai`) | Managed REST API | Platform + marketplace |
| **API compatibility** | Firecrawl-compatible | Custom API | Custom API | Reference API | Custom API |
| **Browser mode** | Playwright + stealth, automatic | Playwright | Yes | Playwright | Playwright + custom |
| **LLM extraction** | OpenAI + Anthropic | OpenAI + Anthropic | No | OpenAI + Anthropic | Via Actors |
| **AI agent integration** | [crawlit-skill](https://github.com/arufian/crawlit-skill) | Manual | Manual | Manual | Manual |

Crawlit is the only option that combines all four:

- Free, MIT-licensed, and self-hosted.
- A Firecrawl-compatible API.
- Built-in web search.
- A ready-made agent skill pack.

<details>
<summary><b>Annual cost at scale</b></summary>

| Pages/mo | Crawlit | Crawl4AI (self-host) | Jina Reader | Firecrawl | Apify |
|---|---|---|---|---|---|
| 1,000 | $0 | $0 | ~$50/yr | $0 (free tier) | ~$468/yr |
| 10,000 | $0 | $0 | ~$500/yr | **$996/yr** (Standard) | ~$2,388/yr |
| 100,000 | $0 | $0 | ~$5,000/yr | **$3,996/yr** (Standard) | ~$2,388/yr |
| 500,000 | $0 | $0 | ~$25,000/yr | **$3,996/yr** (Standard) | ~$2,388/yr |

> Jina Reader pricing estimated at $0.05–0.10 per 1K characters. Firecrawl assumes annual billing. Apify pricing based on Starter plan with additional usage.
</details>

## Configuration

Everything works with defaults. To change something, `cp .env.example .env` and edit.

| Variable | Default | Description |
|---|---|---|
| `SEARCH_ENGINE` | `google` | `google` or `duckduckgo` |
| `SEARCH_FALLBACK` | `true` | Try the other engine when the primary is blocked |
| `SEARCH_CACHE_TTL_SECONDS` | `3600` | Search result cache lifetime (`0` disables) |
| `CACHE_TTL_SECONDS` | `86400` | Page cache lifetime |
| `PROXY_URL` | — | Proxy for all requests, e.g. `http://user:pass@host:port` |
| `STEALTH_MODE` | `true` | Stealth patches for the browser |
| `BROWSER_POOL_SIZE` | `3` | Parallel browser contexts |
| `EXTRACT_WORKERS` | CPU count − 1 (max 4) | Worker threads for HTML → Markdown; `0` = main thread |
| `RATE_LIMIT_MAX` | `60` | API requests per minute per client |
| `CRAWL_CONCURRENCY` | `10` | Parallel crawl jobs |
| `CRAWL_RATE_PER_SEC` | `10` | Max crawl jobs started per second (`0` = unlimited) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | — | For LLM extraction |
| `LLM_PROVIDER` / `LLM_MODEL` | `openai` / `gpt-4o-mini` | Default extraction model |

## FAQ

**Is it really free?**
Yes. MIT license, no account, and no API key. It costs only the machine it runs on.

**Do I need to know Node.js?**
No. Docker is the only requirement.

**Does Google block it?**
Light use works fine. Heavy automated searching from one IP gets throttled. Crawlit then falls back to DuckDuckGo automatically, tells you so in `fallbackFrom`, and retries Google after 10 minutes. For heavy use, set `PROXY_URL`.

**Can I use my existing Firecrawl client?**
Mostly. `/v1/scrape`, `/v1/crawl` and `/v1/map` take Firecrawl-style requests: point the base URL at `http://localhost:3000`. Two differences: `/v1/search` returns results under `data.results` instead of a bare `data` array, and `/v1/batch/scrape` is synchronous while Firecrawl's is async.

**What about sites behind Cloudflare or Akamai?**
The stealth browser handles basic challenges. Enterprise bot protection also needs a residential proxy. Set `PROXY_URL`, or pass `proxy` per request.

**Does it respect robots.txt?**
Crawls do. Single scrapes fetch exactly the URL you ask for.

## Development

```bash
npm install
npm run dev          # hot reload (needs Redis: docker run -d -p 6379:6379 redis:7-alpine)
npm run typecheck
npm run test:unit    # no server needed
npm run test:api     # integration tests against a running server
npm run test:load    # 1000-concurrent load test
npm test             # all of the above
```

### Architecture

```
POST /v1/scrape ──► cache / in-flight dedupe
(+ batch/scrape)     └─ auto: HTTP (undici, keep-alive) ──► JS shell or bot wall? ──► browser (Playwright pool)
                          └─ worker thread: cheerio (metadata + links) + linkedom/Readability + Turndown/GFM

POST /v1/crawl  ──► BullMQ queue (Redis)
                     └─ Worker: robots.txt → scrape → recordPage → acceptLinks (atomic limit) → addBulk children

POST /v1/map    ──► sitemaps + robots.txt + seed page links (parallel) → normalize/filter

POST /v1/search ──► Google basic HTML (HTTP) → Google (browser) → DuckDuckGo  ──► cache
```

Built with Fastify, Playwright + playwright-extra (stealth), Mozilla Readability on linkedom, Turndown, Piscina, BullMQ, Redis, the Vercel AI SDK, and Prometheus metrics at `/metrics`.

See [CHANGELOG.md](CHANGELOG.md) for what's new and [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.

## License

MIT. Use it, fork it, ship it.

<p align="center"><sub>If Crawlit saves you a Firecrawl bill, a ⭐ helps other people find it.</sub></p>
