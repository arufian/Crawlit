import { Registry, Counter, Histogram, Gauge } from 'prom-client'

export const registry = new Registry()

export const scrapeTotal = new Counter({
  name: 'crawlit_scrape_total',
  help: 'Total scrape requests',
  labelNames: ['mode', 'status'],
  registers: [registry],
})

export const scrapeDuration = new Histogram({
  name: 'crawlit_scrape_duration_seconds',
  help: 'Scrape request duration',
  labelNames: ['mode'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
})

export const crawlPagesTotal = new Counter({
  name: 'crawlit_crawl_pages_total',
  help: 'Total pages processed in crawl jobs',
  labelNames: ['status'],
  registers: [registry],
})

export const cacheHits = new Counter({
  name: 'crawlit_cache_hits_total',
  help: 'Cache hit count',
  registers: [registry],
})

export const browserPoolActive = new Gauge({
  name: 'crawlit_browser_pool_active',
  help: 'Active browser contexts in pool',
  registers: [registry],
})
