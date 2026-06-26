# Crawlit

<p align="center">
  <img src="logo.svg" width="120" alt="Crawlit logo"/>
</p>

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-22-green.svg)
![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)

Self-hosted web crawler and scraper. Drop-in replacement for Firecrawl — same API shape, runs on your machine for free.

## Why

The AI web scraping landscape is crowded with tools like Firecrawl, Crawl4AI, Jina Reader, ScrapeGraphAI, Apify, and Bright Data. Most charge per page, require complex setup, or lock you into their ecosystem.

**Crawlit is different:**

- **Free forever** — MIT-licensed, open-source, no per-page costs, no API credits
- **Self-hosted** — Runs on your machine via Docker. Your data stays yours.
- **Firecrawl-compatible** — Same API shape (`/v1/scrape`, `/v1/crawl`, `/v1/map`), so migration is trivial
- **AI Agent Ready** — Use [crawlit-skill](https://github.com/arufian/crawlit-skill) to let Claude Code, Codex, OpenCode, and other AI assistants control Crawlit directly
- **Full control** — No rate limits, no usage caps, no vendor lock-in

**When to choose Crawlit:**

- You're scraping at volume and don't want to pay $16-$599/month (Firecrawl) or manage complex infrastructure (Apify, Bright Data)
- You want a self-hosted alternative to Jina Reader or Crawl4AI with a cleaner API
- You need AI agent integration without building custom tooling
- You value simplicity: one `docker compose up` and you're live

Crawlit gives you the same core functionality as the paid tools (scrape, crawl, map, LLM extraction, stealth browser) — running locally for free.

## Comparison

How Crawlit stacks up against other AI web scraping tools:

| | Crawlit | [Crawl4AI](https://github.com/unclecode/crawl4ai) | [Jina Reader](https://jina.ai/reader/) | [Firecrawl](https://firecrawl.dev) | [Apify](https://apify.com) |
|---|---|---|---|---|---|
| **License** | MIT | Apache 2.0 | Proprietary (free tier) | AGPL-3.0 (OSS) / Proprietary (Cloud) | Proprietary |
| **Self-hosted** | $0 | $0 | $0 (limited) | $0 (complex setup, AGPL) | $0 (limited) |
| **Cloud (Free)** | — | — | 50K credits/mo | 1,000 pages/mo | $5 credits/mo |
| **Cloud (Paid)** | — | — | Pay-per-use | **$16/mo** (5K) · **$83/mo** (100K) · **$333/mo** (500K) | **$39/mo** (Starter) · **$199/mo** (Scale) |
| **Shape** | Docker Compose, API-first | Python library, CLI | URL prefix API (`r.jina.ai`) | Managed REST API | Platform + marketplace |
| **API compatibility** | Firecrawl-compatible | Custom API | Custom API | Reference API | Custom API |
| **Browser mode** | Playwright + stealth | Playwright | Yes | Playwright | Playwright + custom |
| **LLM extraction** | OpenAI + Anthropic | OpenAI + Anthropic | No | OpenAI + Anthropic | Via Actors |
| **AI Agent integration** | [crawlit-skill](https://github.com/arufian/crawlit-skill) | Manual | Manual | Manual | Manual |
| **Queue** | BullMQ (Redis) | Async Python | Managed | Managed | Managed |
| **Cache** | Redis | Optional | Managed | Managed | Managed |

**Key takeaway:** Crawlit is the only tool that combines:
- Free, MIT-licensed, self-hosted
- Firecrawl-compatible API (easy migration)
- Built-in AI agent integration
- No per-page costs or usage limits

Crawl4AI is also free and open-source, but uses a Python library approach. Jina Reader is simple but proprietary with usage limits. Firecrawl and Apify charge per page beyond free tiers. If you scrape at any real volume, self-hosting Crawlit saves hundreds to thousands per month.

### Annual cost at scale

How much you'd pay per year at different scraping volumes:

| Pages/mo | Crawlit | Crawl4AI (self-host) | Jina Reader | Firecrawl | Apify |
|---|---|---|---|---|---|
| 100 | $0 | $0 | $0 (free tier) | $0 (free tier) | $0 (free credits) |
| 1,000 | $0 | $0 | ~$50/yr | $0 (free tier) | ~$468/yr |
| 3,000 | $0 | $0 | ~$150/yr | **$192/yr** (Hobby) | ~$468/yr |
| 10,000 | $0 | $0 | ~$500/yr | **$996/yr** (Standard) | ~$2,388/yr |
| 50,000 | $0 | $0 | ~$2,500/yr | **$3,996/yr** (Growth) | ~$2,388/yr |
| 100,000 | $0 | $0 | ~$5,000/yr | **$3,996/yr** (Standard) | ~$2,388/yr |
| 500,000 | $0 | $0 | ~$25,000/yr | **$3,996/yr** (Standard) | ~$2,388/yr |

> Crawlit and Crawl4AI are free when self-hosted. Jina Reader pricing estimated at $0.05-0.10 per 1K characters. Firecrawl assumes annual billing. Apify pricing based on Starter plan with additional usage.

## Features

- **AI Agent Integration** — Control via [crawlit-skill](https://github.com/arufian/crawlit-skill) for Claude Code, Codex, OpenCode, and more
- **`/v1/scrape`** — Single page → clean markdown, HTML, links
- **`/v1/crawl`** — Async multi-page crawl with BFS, depth control, domain filtering
- **`/v1/map`** — Fast URL discovery via sitemap.xml + link extraction
- **`/v1/search`** — Web search via DuckDuckGo (returns title, URL, snippet)
- **Stealth browser** — Playwright + puppeteer-extra-plugin-stealth for JS-heavy sites
- **Proxy support** — Per-request residential proxy for bot-protected sites
- **LLM extraction** — Schema-guided JSON extraction via OpenAI or Anthropic
- **Save to disk** — Markdown files with YAML frontmatter, ready for LLM context
- **Redis caching** — Avoid re-fetching the same pages
- **Prometheus metrics** — `/metrics` endpoint

## Requirements

- Docker + Docker Compose

That's it. No other dependencies needed on your machine.

## Installation

```bash
git clone https://github.com/your-org/crawlit.git
cd crawlit
cp .env.example .env
```

Edit `.env` if you want to set API keys or a proxy. Everything has sensible defaults so you can skip this for local use.

## Usage

### Start

```bash
docker compose up --build
```

First run downloads the Chromium binary inside the container (~90MB). Subsequent starts are fast.

```bash
docker compose up        # start
docker compose down      # stop (data persists)
docker compose down -v   # stop + wipe Redis data
```

The API runs on `http://localhost:3000`.

---

## AI Agent Integration

Let your AI coding assistant control Crawlit. The [crawlit-skill](https://github.com/arufian/crawlit-skill) provides a consistent interface for AI agents to scrape, crawl, and map websites.

**Works with:**
- Claude Code
- OpenAI Codex
- OpenCode
- Any MCP-compatible AI tool

**Install:**

```bash
git clone https://github.com/arufian/crawlit-skill.git
cd crawlit-skill
# Follow installation instructions for your AI tool
```

Once installed, your AI agent can:
- Scrape single pages: "Get the content of https://example.com"
- Crawl entire sites: "Scrape all docs under https://docs.example.com"
- Map URLs: "What pages exist on https://example.com?"
- Extract structured data: "Get all product prices from this page"

See the [crawlit-skill repo](https://github.com/arufian/crawlit-skill) for full documentation.

---

## API

### Scrape a single page

```bash
curl -X POST http://localhost:3000/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "links"]
  }'
```

**Request body**

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | Page to scrape |
| `formats` | array | `["markdown"]` | `markdown`, `html`, `links`, `rawHtml` |
| `onlyMainContent` | boolean | `true` | Strip nav/ads via Mozilla Readability |
| `mode` | string | `"http"` | `http` (fast) or `browser` (JS rendering) |
| `waitFor` | number | — | ms to wait after page load (browser mode) |
| `actions` | array | — | Click/scroll/type actions (browser mode) |
| `proxy` | string | — | Proxy URL, e.g. `http://user:pass@host:port` |
| `save` | boolean | `false` | Save markdown to `./output/<host>/<path>.md` |
| `extract` | object | — | LLM extraction (see below) |
| `skipCache` | boolean | `false` | Bypass Redis cache |
| `timeout` | number | `30000` | Request timeout in ms |

**Example: browser mode with actions**

```bash
curl -X POST http://localhost:3000/v1/scrape \
  -d '{
    "url": "https://example.com",
    "mode": "browser",
    "waitFor": 2000,
    "actions": [
      { "type": "click", "selector": ".load-more" },
      { "type": "scroll" }
    ],
    "formats": ["markdown"],
    "save": true
  }'
```

**Example: LLM extraction**

```bash
curl -X POST http://localhost:3000/v1/scrape \
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

---

### Crawl multiple pages

```bash
# Start crawl
curl -X POST http://localhost:3000/v1/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.example.com",
    "maxDepth": 2,
    "limit": 100,
    "formats": ["markdown"],
    "save": true
  }'

# Returns: { "success": true, "id": "<crawl-id>", "url": "/v1/crawl/<crawl-id>" }
```

```bash
# Poll status
curl http://localhost:3000/v1/crawl/<crawl-id>

# Returns: { "status": "running", "completed": 12, "total": 47, "data": [...] }
```

```bash
# Cancel
curl -X DELETE http://localhost:3000/v1/crawl/<crawl-id>
```

**Request body**

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | string | required | Seed URL |
| `maxDepth` | number | `3` | Max link depth from seed |
| `limit` | number | `100` | Max pages to crawl |
| `allowedDomains` | array | `[]` | Restrict to these domains (default: seed domain) |
| `mode` | string | `"http"` | `http` or `browser` |
| `formats` | array | `["markdown"]` | Output formats |
| `onlyMainContent` | boolean | `true` | Readability extraction |
| `save` | boolean | `false` | Save each page to `./output/` |
| `proxy` | string | — | Proxy for all pages in this crawl |

---

### Map URLs (no content fetch)

```bash
curl -X POST http://localhost:3000/v1/map \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://docs.example.com",
    "limit": 1000
  }'

# Returns: { "success": true, "links": [...], "total": 342 }
```

Tries `sitemap.xml` first, falls back to link extraction from the seed page.

---

### Search the web

```bash
curl -X POST http://localhost:3000/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "crawlit firecrawl alternative",
    "limit": 5
  }'

# Returns: { "success": true, "data": { "query": "...", "results": [...], "total": 3 } }
```

Searches via DuckDuckGo's HTML endpoint. Returns title, URL, and snippet for each result. Supports `limit` (1–50, default 10). May be rate-limited with heavy use.

---

### Saved files

When `save: true`, files land in `./output/` on your host machine (Docker volume mount):

```
output/
  docs.example.com/
    getting-started.md
    api-reference.md
    ...
```

Each file has YAML frontmatter:

```markdown
---
title: "Getting Started"
url: "https://docs.example.com/getting-started"
scraped_at: "2026-04-25T10:00:00.000Z"
description: "..."
language: "en"
---

## Getting Started

...page content as clean markdown...
```

---

## Configuration

Copy `.env.example` to `.env` if needed (all optional for local use):

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|---|
| `PROXY_URL` | Residential proxy for bot-protected sites, e.g. `http://user:pass@host:port` |
| `OPENAI_API_KEY` | OpenAI API key (for LLM extraction) |
| `ANTHROPIC_API_KEY` | Anthropic API key (for LLM extraction) |
| `LLM_PROVIDER` | `openai` (default) or `anthropic` |
| `LLM_MODEL` | Model name, default `gpt-4o-mini` |

---

## Bot-protected sites (Akamai, Cloudflare)

`mode: "browser"` with `STEALTH_MODE=true` handles basic JS challenges and fingerprint checks.

For enterprise-grade protection (Akamai, Cloudflare Enterprise), you also need a residential proxy:

```bash
# .env
PROXY_URL=http://user:pass@residential-proxy-host:port
```

Or per-request:

```bash
curl -X POST http://localhost:3000/v1/scrape \
  -d '{
    "url": "https://protected-site.com",
    "mode": "browser",
    "proxy": "http://user:pass@host:port"
  }'
```

Residential proxies: [Oxylabs](https://oxylabs.io), [BrightData](https://brightdata.com), [IPRoyal](https://iproyal.com).

---

## Metrics

Prometheus metrics at `http://localhost:3000/metrics`.

```
crawlit_scrape_total{mode, status}
crawlit_scrape_duration_seconds{mode}
crawlit_crawl_pages_total{status}
crawlit_cache_hits_total
crawlit_browser_pool_active
```

---

## Development

```bash
npm install
npm run dev        # start with hot reload (no Docker, needs local Redis)
npm run typecheck  # TypeScript check
npm test           # run all tests (API integration + load)
npm run test:api   # API integration tests only
npm run test:load  # Load test only (1000 concurrent)
npm run build      # compile to dist/
```

Start Redis locally for dev:

```bash
docker run -d -p 6379:6379 redis:7-alpine
```

---

## Architecture

```
POST /v1/scrape ──► HTTP fetcher (undici)     ──► Readability ──► Turndown ──► markdown
                    Browser fetcher (Playwright)

POST /v1/crawl  ──► BullMQ queue (Redis)
                     └─ Worker: fetch → extract → pushResult → enqueue children

POST /v1/map    ──► sitemap.xml parser → link extractor

POST /v1/search  ──► DuckDuckGo HTML → cheerio parser → JSON results
```

- **Fastify** — API server
- **Playwright + playwright-extra** — headless browser with stealth
- **Mozilla Readability + Turndown** — HTML → clean markdown
- **BullMQ** — job queue for async crawling
- **Redis** — cache + queue backend (persisted via Docker volume)
- **Vercel AI SDK** — LLM extraction

---

## License

MIT
