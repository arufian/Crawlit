import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { config } from '../lib/config.js'
import { logger } from '../lib/logger.js'
import { healthRoute } from './routes/health.js'
import { scrapeRoute } from './routes/scrape.js'
import { batchRoute } from './routes/batch.js'
import { crawlRoute } from './routes/crawl.js'
import { mapRoute } from './routes/map.js'
import { searchRoute } from './routes/search.js'
import { metricsRoute } from './routes/metrics.js'
import { closePool, prewarmBrowser } from '../core/fetcher/browser-pool.js'
import { closeContentPool } from '../core/extractor/content-pool.js'
import { startCrawlWorker } from '../jobs/crawl-worker.js'
import type { Worker } from 'bullmq'

export async function buildServer() {
  // Batch bodies with 100 URLs + options can exceed the 1 MB default
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 })

  let worker: Worker | null = null

  app.addHook('onReady', async () => {
    worker = startCrawlWorker()
    logger.info({ concurrency: config.CRAWL_CONCURRENCY }, 'Crawl worker started')
    // Don't block startup on Chromium; first browser request just waits for the same launch
    if (config.BROWSER_PREWARM) void prewarmBrowser()
  })

  app.addHook('onClose', async () => {
    await worker?.close()
    await closePool()
    await closeContentPool()
  })

  await app.register(helmet)
  await app.register(cors, { origin: true })
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ success: false, error: 'Rate limit exceeded' }),
  })

  await app.register(healthRoute)
  await app.register(scrapeRoute)
  await app.register(batchRoute)
  await app.register(crawlRoute)
  await app.register(mapRoute)
  await app.register(searchRoute)
  await app.register(metricsRoute)

  return app
}

export async function startServer() {
  const app = await buildServer()
  try {
    await app.listen({ port: config.PORT, host: config.HOST })
    logger.info(`Crawlit running on http://${config.HOST}:${config.PORT}`)
  } catch (err) {
    logger.error(err, 'Failed to start server')
    process.exit(1)
  }

  // Graceful shutdown so Chromium and worker threads don't linger on `docker compose down`
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.info({ signal }, 'Shutting down')
      app.close().finally(() => process.exit(0))
    })
  }
}
