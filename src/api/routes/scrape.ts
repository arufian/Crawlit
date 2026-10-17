import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { scrapePage, ScrapeFetchError } from '../../core/scrape-service.js'
import { ScrapeOptionsSchema, toScrapeOptions } from '../schemas.js'

const ScrapeBody = ScrapeOptionsSchema.extend({
  url: z.string().url(),
})

type ScrapeBodyType = z.infer<typeof ScrapeBody>

export async function scrapeRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ScrapeBodyType }>(
    '/v1/scrape',
    async (req, reply) => {
      const parsed = ScrapeBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(422).send({ success: false, error: parsed.error.format() })
      }

      try {
        const { data, source } = await scrapePage(toScrapeOptions(parsed.data.url, parsed.data))
        reply.header('x-crawlit-source', source)
        return reply.send({ success: true, data })
      } catch (err) {
        if (err instanceof ScrapeFetchError) {
          return reply.status(500).send({ success: false, error: 'Fetch failed' })
        }
        throw err
      }
    }
  )
}
