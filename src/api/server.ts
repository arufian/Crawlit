import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { config } from '../lib/config.js'
import { logger } from '../lib/logger.js'
import { healthRoute } from './routes/health.js'
import { scrapeRoute } from './routes/scrape.js'
import { crawlRoute } from './routes/crawl.js'
import { mapRoute } from './routes/map.js'
import { metricsRoute } from './routes/metrics.js'
import { closePool } from '../core/fetcher/browser-pool.js'
import { startCrawlWorker } from '../jobs/crawl-worker.js'
import type { Worker } from 'bullmq'

export async function buildServer() {
  const app = Fastify({ logger: false })

  let worker: Worker | null = null

  app.addHook('onReady', async () => {
    worker = startCrawlWorker()
    logger.info('Crawl worker started')
  })

  app.addHook('onClose', async () => {
    await worker?.close()
    await closePool()
  })

  await app.register(helmet)
  await app.register(cors, { origin: true })
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ success: false, error: 'Rate limit exceeded' }),
  })

  await app.register(healthRoute)
  await app.register(scrapeRoute)
  await app.register(crawlRoute)
  await app.register(mapRoute)
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
}
