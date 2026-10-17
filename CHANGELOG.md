# Changelog

## 1.1.0 — 2026-10-18

Faster, and it can search Google now.

### Added
- **Google web search** in `/v1/search`, the new default engine. It tries Google's lightweight HTML page over plain HTTP first, then the stealth browser, then DuckDuckGo. Blocked paths cool down for 10 minutes. New options: `engine`, `lang`, `country`, `tbs` (time filter), and pagination up to 50 results.
- `scrapeOptions` on `/v1/search`: get the Markdown of every result in the same call.
- Search result cache (`SEARCH_CACHE_TTL_SECONDS`, default 1 hour).
- `POST /v1/batch/scrape`: up to 100 URLs scraped in parallel in one request.
- `mode: "auto"`, the new default for scrape and crawl. It uses plain HTTP and switches to the browser only for JS app shells and bot walls (403/429/503).
- `waitForSelector` scrape option.
- Crawl `includePaths` / `excludePaths` (regex on URL path); crawl status adds `failed` and a `next` page link.
- Map `search` filter and `ignoreSitemap`.
- Markdown tables (GFM). Inline `data:` images are dropped.
- Correct decoding of non-UTF-8 pages (Shift_JIS, EUC-JP, GBK, …).
- Plain-text, Markdown and JSON URLs are returned as-is.
- `/health` reports search engine availability.
- `x-crawlit-source` response header (`http` / `browser` / `cache`).
- `scripts/benchmark.sh` and unit tests (`npm run test:unit`).
- New env settings: `EXTRACT_WORKERS`, `RATE_LIMIT_MAX`, `CRAWL_CONCURRENCY`, `CRAWL_RATE_PER_SEC`, `BROWSER_PREWARM`, `HTTP_USER_AGENT`, `MAX_BODY_BYTES`, `SEARCH_ENGINE`, `SEARCH_FALLBACK`.

### Faster
- Readability runs on linkedom instead of JSDOM: 3–4× faster with the same output.
- One HTML parse per page instead of three. Large pages are processed in worker threads.
- Keep-alive connection pool with compression.
- The browser launches at startup. The pool hands out contexts through a waiter queue instead of 500 ms polling, and tracker/ad hosts are blocked.
- Crawl: the global 2 jobs/s limiter is replaced by a configurable rate (default 10/s) at concurrency 10. Children are enqueued in bulk.
- Map: sitemaps, robots.txt and seed-page links are fetched in parallel.
- Identical concurrent scrapes share one fetch.

### Fixed
- Redirects weren't followed (a 301 page body was returned as content).
- Crawls could never complete when several crawls ran at once, and counters lost updates under concurrency.
- `STEALTH_MODE=false` was read as `true`.
- The browser pool could wait forever when it was full of idle contexts for a different proxy.
- Frameset pages (no `<body>`) crashed Markdown conversion.
- Error pages (4xx/5xx) were cached for 24 hours.
- LLM extraction results were cached without their prompt/schema, so a different `extract` request could get a stale answer.

### Changed
- Default `mode` is now `auto` (was `http`).
- Crawl metadata moved to a new Redis key layout. Crawls started on 1.0 return 404 after upgrading.
- `/v1/map` now includes the seed page's links alongside sitemap URLs.
