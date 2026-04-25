# Contributing

## Setup

```bash
git clone https://github.com/your-org/crawlit.git
cd crawlit
npm install
docker run -d -p 6379:6379 redis:7-alpine
npm run dev
```

## Before submitting a PR

```bash
npm run typecheck   # must pass
npm run build       # must compile
```

## Project structure

```
src/
  api/
    routes/         # Fastify route handlers (scrape, crawl, map, metrics)
    middleware/     # Auth
  core/
    fetcher/        # HTTP fetcher, Playwright browser pool
    extractor/      # Readability, metadata, LLM extraction
    transformer/    # HTML→markdown, file saving
  jobs/
    queue.ts        # BullMQ queue + worker factory
    crawl-state.ts  # Redis-backed crawl state (meta, results, seen set)
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
