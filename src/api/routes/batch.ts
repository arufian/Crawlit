import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { scrapePage } from '../../core/scrape-service.js'
import { mapLimit } from '../../lib/concurrency.js'
import { ScrapeOptionsSchema, toScrapeOptions } from '../schemas.js'

const BatchBody = ScrapeOptionsSchema.extend({
  urls: z.array(z.string().url()).min(1).max(100),
  concurrency: z.number().int().min(1).max(20).default(8),
})

type BatchBodyType = z.infer<typeof BatchBody>

export async function batchRoute(app: FastifyInstance): Promise<void> {
  // POST /v1/batch/scrape — scrape many URLs in parallel in one request (synchronous)
  app.post<{ Body: BatchBodyType }>(
    '/v1/batch/scrape',
    async (req, reply) => {
      const parsed = BatchBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(422).send({ success: false, error: parsed.error.format() })
      }

      const { urls, concurrency, ...opts } = parsed.data
      const unique = [...new Set(urls)]

      const data = await mapLimit(unique, concurrency, async (url) => {
        try {
          const { data: page, source } = await scrapePage(toScrapeOptions(url, opts))
          return { url, success: true, source, ...page }
        } catch (err) {
          return { url, success: false, error: err instanceof Error ? err.message : 'Fetch failed' }
        }
      })

      const failed = data.filter((d) => !d.success).length
      return reply.send({ success: true, total: data.length, completed: data.length - failed, failed, data })
    },
  )
}
