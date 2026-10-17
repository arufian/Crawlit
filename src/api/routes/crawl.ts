import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { crawlQueue } from '../../jobs/queue.js'
import {
  createCrawl, getMeta, getResults, setStatus,
} from '../../jobs/crawl-state.js'
import { FormatsSchema, ModeSchema } from '../schemas.js'

const RegexString = z.string().max(500).refine((s) => {
  try {
    new RegExp(s)
    return true
  } catch {
    return false
  }
}, 'Invalid regular expression')

const CrawlBody = z.object({
  url: z.string().url(),
  maxDepth: z.number().int().min(1).max(10).default(3),
  limit: z.number().int().min(1).max(10000).default(100),
  allowedDomains: z.array(z.string()).default([]),
  // Regexes matched against the URL path, e.g. ["^/docs/"] or ["/blog/\\d{4}/"]
  includePaths: z.array(RegexString).max(50).optional(),
  excludePaths: z.array(RegexString).max(50).optional(),
  mode: ModeSchema,
  formats: FormatsSchema,
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

      // Seeds the start URL as seen, total=1, pending=1
      await createCrawl(id, opts.url, {
        maxDepth: opts.maxDepth,
        limit: opts.limit,
        allowedDomains: opts.allowedDomains,
        mode: opts.mode,
        formats: opts.formats,
        onlyMainContent: opts.onlyMainContent,
        save: opts.save,
        ...(opts.includePaths !== undefined && { includePaths: opts.includePaths }),
        ...(opts.excludePaths !== undefined && { excludePaths: opts.excludePaths }),
        ...(opts.proxy !== undefined && { proxy: opts.proxy }),
      })

      await crawlQueue.add('page', { crawlId: id, url: opts.url, depth: 0 }, {
        jobId: `${id}_seed`,
      })

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

      const offset = Math.max(0, parseInt(req.query.offset ?? '0', 10) || 0)
      const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit ?? '100', 10) || 100))
      const data = await getResults(req.params.id, offset, limit)
      const nextOffset = offset + data.length

      return reply.send({
        success: true,
        status: meta.status,
        total: meta.total,
        completed: meta.completed,
        failed: meta.failed,
        startedAt: meta.startedAt,
        completedAt: meta.completedAt,
        ...(nextOffset < meta.completed && { next: `/v1/crawl/${meta.id}?offset=${nextOffset}&limit=${limit}` }),
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

      await setStatus(req.params.id, 'cancelled')

      // Remove queued (not-yet-started) jobs for this crawl
      const waiting = await crawlQueue.getJobs(['waiting', 'delayed', 'prioritized'])
      const toRemove = waiting.filter((j) => j.data.crawlId === req.params.id)
      await Promise.all(toRemove.map((j) => j.remove().catch(() => null)))

      return reply.send({ success: true, message: 'Crawl cancelled' })
    },
  )
}
