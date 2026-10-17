import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { webSearch } from '../../core/search/web-search.js'
import { scrapePage } from '../../core/scrape-service.js'
import { mapLimit } from '../../lib/concurrency.js'
import { scrapeTotal, scrapeDuration } from '../../lib/metrics.js'
import { logger } from '../../lib/logger.js'
import { ScrapeOptionsSchema, toScrapeOptions } from '../schemas.js'

const SearchBody = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(10),
  engine: z.enum(['google', 'duckduckgo']).optional(),
  lang: z.string().regex(/^[a-zA-Z-]{2,10}$/).optional(),
  country: z.string().regex(/^[a-zA-Z]{2}$/).optional(),
  tbs: z.string().max(100).optional(),
  timeout: z.number().int().min(1000).max(60000).default(20000),
  skipCache: z.boolean().default(false),
  // Firecrawl-compatible: also scrape each result page and attach its content
  scrapeOptions: ScrapeOptionsSchema.partial({ formats: true }).optional(),
})

type SearchBodyType = z.infer<typeof SearchBody>

export async function searchRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SearchBodyType }>(
    '/v1/search',
    async (req, reply) => {
      const parsed = SearchBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(422).send({ success: false, error: parsed.error.format() })
      }

      const { query, limit, engine, lang, country, tbs, timeout, skipCache, scrapeOptions } = parsed.data
      const timer = scrapeDuration.startTimer({ mode: 'search' })

      try {
        const found = await webSearch({
          query, limit, timeout, skipCache,
          ...(engine !== undefined && { engine }),
          ...(lang !== undefined && { lang }),
          ...(country !== undefined && { country }),
          ...(tbs !== undefined && { tbs }),
        })

        let results: Array<Record<string, unknown>> = found.results.map((r) => ({ ...r }))
        if (scrapeOptions && results.length > 0) {
          const opts = ScrapeOptionsSchema.parse(scrapeOptions)
          results = await mapLimit(found.results, 5, async (r) => {
            try {
              const { data } = await scrapePage(toScrapeOptions(r.url, opts))
              return { ...r, ...data }
            } catch (err) {
              return { ...r, scrapeError: err instanceof Error ? err.message : 'Fetch failed' }
            }
          })
        }

        scrapeTotal.inc({ mode: 'search', status: results.length > 0 ? 'success' : 'empty' })
        return reply.send({
          success: true,
          data: {
            query,
            engine: found.engine,
            results,
            total: results.length,
            ...(found.cached && { cached: true }),
            ...(found.fallbackFrom && { fallbackFrom: found.fallbackFrom }),
            ...(found.blocked && { blocked: true, warning: 'All search engines returned bot checks. Try again later, or set PROXY_URL.' }),
          },
        })
      } catch (err) {
        scrapeTotal.inc({ mode: 'search', status: 'error' })
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ err: msg, query }, 'Search failed')
        return reply.status(500).send({ success: false, error: 'Search failed' })
      } finally {
        timer()
      }
    },
  )
}
