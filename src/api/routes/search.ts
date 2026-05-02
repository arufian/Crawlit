import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { request } from 'undici'
import { extractSearchResults } from '../../core/extractor/search-extractor.js'
import { scrapeTotal, scrapeDuration } from '../../lib/metrics.js'
import { logger } from '../../lib/logger.js'

const SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const SearchBody = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(10),
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

      const { query, limit } = parsed.data
      const timer = scrapeDuration.startTimer({ mode: 'search' })

      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        const { statusCode, body } = await request(url, {
          method: 'GET',
          headers: {
            'user-agent': SEARCH_UA,
            accept: 'text/html,application/xhtml+xml,*/*',
            'accept-language': 'en-US,en;q=0.9',
            'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
          },
          bodyTimeout: 15000,
          headersTimeout: 15000,
        })
        const html = await body.text()
        const results = extractSearchResults(html).slice(0, limit)

        scrapeTotal.inc({ mode: 'search', status: 'success' })
        timer()
        return reply.send({ success: true, data: { query, results, total: results.length } })
      } catch (err) {
        scrapeTotal.inc({ mode: 'search', status: 'error' })
        timer()
        const msg = err instanceof Error ? err.message : String(err)
        logger.error({ err: msg, query }, 'Search failed')
        return reply.status(500).send({ success: false, error: 'Search failed' })
      }
    },
  )
}
