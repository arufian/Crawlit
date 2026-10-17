# Contributing

## Setup

```bash
git clone https://github.com/arufian/Crawlit.git
cd Crawlit
npm install
docker run -d -p 6379:6379 redis:7-alpine
npm run dev
```

## Before submitting a PR

```bash
npm run typecheck   # must pass
npm run test:unit   # must pass (no server needed)
npm run build       # must compile
```

## Project structure

```
src/
  api/
    routes/         # Fastify route handlers (scrape, batch, crawl, map, search, health, metrics)
    schemas.ts      # Shared zod request schemas
  core/
    scrape-service.ts # Cache, dedupe, auto mode (HTTP → browser), LLM extract, save
    fetcher/        # HTTP fetcher (keep-alive, charset), Playwright browser pool
    extractor/      # Single-parse page processing, worker pool, search result parsers, LLM extraction
    search/         # Google (HTTP → browser) + DuckDuckGo with fallback, cooldown, cache
    transformer/    # HTML→markdown (GFM), file saving
  jobs/
    queue.ts        # BullMQ queue + worker factory
    crawl-state.ts  # Redis hash crawl state with atomic counters, results, seen/done sets
    crawl-worker.ts # BFS crawl processor
  lib/
    config.ts       # Zod-validated env config
    cache.ts        # Redis client + cache helpers
    logger.ts       # Pino logger
    metrics.ts      # Prometheus counters/histograms
```

## Guidelines

- Keep route handlers thin — business logic in `core/`
- No new dependencies without a clear reason
- TypeScript strict mode — no `any`, no type assertions unless unavoidable
- Formats: all scrape/crawl responses follow `{ success: bool, data: ... }` shape
- New env vars go in `config.ts` + `.env.example` + `docker-compose.yml`

## Reporting issues

Open a GitHub issue with:
- What you were scraping (URL if public)
- Mode used (`http` or `browser`)
- Error or unexpected output
- Docker version (`docker --version`)
