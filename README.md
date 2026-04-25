# Crawlit

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-22-green.svg)
![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)

Self-hosted web crawler and scraper. Drop-in replacement for Firecrawl — same API shape, runs on your machine for free.

## Why

Firecrawl is great but costs money at any meaningful volume. Crawlit gives you the same core functionality (scrape, crawl, map, LLM extraction) running locally via Docker.

## Features

- **`/v1/scrape`** — Single page → clean markdown, HTML, links
- **`/v1/crawl`** — Async multi-page crawl with BFS, depth control, domain filtering
- **`/v1/map`** — Fast URL discovery via sitemap.xml + link extraction
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
|---|---|
| `PROXY_URL` | Residential proxy for bot-protected sites, e.g. `http://user:pass@host:port` |

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
