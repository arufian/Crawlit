import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { crawlQueue } from '../../jobs/queue.js'
import {
  createCrawl, getMeta, getResults, updateMeta, markSeen, deleteCrawl,
} from '../../jobs/crawl-state.js'
const CrawlBody = z.object({
  url: z.string().url(),
  maxDepth: z.number().int().min(1).max(10).default(3),
  limit: z.number().int().min(1).max(10000).default(100),
  allowedDomains: z.array(z.string()).default([]),
  mode: z.enum(['http', 'browser']).default('http'),
  formats: z.array(z.enum(['markdown', 'html', 'links', 'rawHtml'])).default(['markdown']),
  onlyMainContent: z.boolean().default(true),
  save: z.boolean().default(false),
  proxy: z.string().url().optional(),
})

type CrawlBodyType = z.infer<typeof CrawlBody>

export async function crawlRoute(app: FastifyInstance): Promise<void> {
  // POST /v1/crawl — start crawl
  app.post<{ Body: CrawlBodyType }>(
    '/v1/crawl',
    async (req, reply) => {
      const parsed = CrawlBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(422).send({ success: false, error: parsed.error.format() })
      }

      const opts = parsed.data
      const id = uuidv4()

      await createCrawl(id, opts.url, {
        maxDepth: opts.maxDepth,
        limit: opts.limit,
        allowedDomains: opts.allowedDomains,
        mode: opts.mode,
        formats: opts.formats,
        onlyMainContent: opts.onlyMainContent,
        save: opts.save,
        ...(opts.proxy !== undefined && { proxy: opts.proxy }),
      })

      // Seed the first URL
      await markSeen(id, opts.url)
      await crawlQueue.add('page', { crawlId: id, url: opts.url, depth: 0 }, {
        jobId: `${id}_seed`,
      })
      await updateMeta(id, { total: 1 })

      return reply.status(202).send({
        success: true,
        id,
        url: `/v1/crawl/${id}`,
      })
    },
  )

  // GET /v1/crawl/:id — status + results
  app.get<{ Params: { id: string }; Querystring: { offset?: string; limit?: string } }>(
    '/v1/crawl/:id',
    async (req, reply) => {
      const meta = await getMeta(req.params.id)
      if (!meta) {
        return reply.status(404).send({ success: false, error: 'Crawl not found' })
      }

      const offset = parseInt(req.query.offset ?? '0', 10)
      const limit = parseInt(req.query.limit ?? '100', 10)
      const data = await getResults(req.params.id, offset, limit)

      return reply.send({
        success: true,
        status: meta.status,
        total: meta.total,
        completed: meta.completed,
        startedAt: meta.startedAt,
        completedAt: meta.completedAt,
        data,
      })
    },
  )

  // DELETE /v1/crawl/:id — cancel
  app.delete<{ Params: { id: string } }>(
    '/v1/crawl/:id',
    async (req, reply) => {
      const meta = await getMeta(req.params.id)
      if (!meta) {
        return reply.status(404).send({ success: false, error: 'Crawl not found' })
      }

      await updateMeta(req.params.id, { status: 'cancelled', completedAt: new Date().toISOString() })

      // Remove queued (not-yet-started) jobs for this crawl
      const waiting = await crawlQueue.getJobs(['waiting', 'delayed'])
      const toRemove = waiting.filter((j) => j.data.crawlId === req.params.id)
      await Promise.all(toRemove.map((j) => j.remove()))

      return reply.send({ success: true, message: 'Crawl cancelled' })
    },
  )
}
