import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { fetchHttp } from '../../core/fetcher/http-fetcher.js'
import { fetchBrowser } from '../../core/fetcher/browser-fetcher.js'
import type { BrowserAction } from '../../core/fetcher/browser-fetcher.js'
import { extractMainContent } from '../../core/extractor/readability-extractor.js'
import { extractMetadata, extractLinks } from '../../core/extractor/metadata-extractor.js'
import { htmlToMarkdown, contentToMarkdown } from '../../core/transformer/html-to-markdown.js'
import { extractWithLLM } from '../../core/extractor/llm-extractor.js'
import { cacheKey, cacheGet, cacheSet } from '../../lib/cache.js'
import { authMiddleware } from '../middleware/auth.js'
import { saveMarkdownFile } from '../../core/transformer/save-markdown.js'
import { scrapeTotal, scrapeDuration, cacheHits } from '../../lib/metrics.js'

const BrowserActionSchema = z.object({
  type: z.enum(['click', 'scroll', 'wait', 'type']),
  selector: z.string().optional(),
  text: z.string().optional(),
  delay: z.number().optional(),
})

const ExtractSchema = z.object({
  schema: z.record(z.string(), z.unknown()).optional(),
  prompt: z.string().optional(),
  provider: z.enum(['openai', 'anthropic']).optional(),
  model: z.string().optional(),
})

const ScrapeBody = z.object({
  url: z.string().url(),
  formats: z.array(z.enum(['markdown', 'html', 'links', 'rawHtml'])).default(['markdown']),
  onlyMainContent: z.boolean().default(true),
  timeout: z.number().int().min(1000).max(60000).default(30000),
  skipCache: z.boolean().default(false),
  save: z.boolean().default(false),
  mode: z.enum(['http', 'browser']).default('http'),
  waitFor: z.number().int().min(0).max(15000).optional(),
  actions: z.array(BrowserActionSchema).optional(),
  proxy: z.string().url().optional(),
  extract: ExtractSchema.optional(),
})

type ScrapeBodyType = z.infer<typeof ScrapeBody>

export async function scrapeRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ScrapeBodyType }>(
    '/v1/scrape',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const parsed = ScrapeBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(422).send({ success: false, error: parsed.error.format() })
      }

      const opts = parsed.data
      const key = cacheKey(opts.url, { formats: opts.formats, onlyMainContent: opts.onlyMainContent })
      const timer = scrapeDuration.startTimer({ mode: opts.mode })

      if (!opts.skipCache) {
        const cached = await cacheGet(key)
        if (cached) {
          cacheHits.inc()
          scrapeTotal.inc({ mode: opts.mode, status: 'cached' })
          timer()
          return reply.send({ success: true, data: cached })
        }
      }

      let fetchResult
      try {
        if (opts.mode === 'browser') {
          fetchResult = await fetchBrowser(opts.url, {
            ...(opts.waitFor !== undefined && { waitFor: opts.waitFor }),
            ...(opts.actions !== undefined && { actions: opts.actions as BrowserAction[] }),
            ...(opts.proxy !== undefined && { proxy: opts.proxy }),
            timeoutMs: opts.timeout,
          })
        } else {
          fetchResult = await fetchHttp(opts.url, opts.timeout)
        }
      } catch (err: unknown) {
        scrapeTotal.inc({ mode: opts.mode, status: 'error' })
        timer()
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({ success: false, error: `Fetch failed: ${msg}` })
      }

      const { html, statusCode, url: finalUrl } = fetchResult
      const metadata = extractMetadata(html, finalUrl, statusCode)
      const data: Record<string, unknown> = { metadata }

      if (opts.formats.includes('rawHtml')) {
        data.rawHtml = html
      }

      if (opts.formats.includes('html') || opts.formats.includes('markdown')) {
        if (opts.onlyMainContent) {
          const extracted = extractMainContent(html, finalUrl)
          if (extracted) {
            if (opts.formats.includes('html')) data.html = extracted.content
            if (opts.formats.includes('markdown')) data.markdown = contentToMarkdown(extracted.content)
          } else {
            if (opts.formats.includes('html')) data.html = html
            if (opts.formats.includes('markdown')) data.markdown = htmlToMarkdown(html)
          }
        } else {
          if (opts.formats.includes('html')) data.html = html
          if (opts.formats.includes('markdown')) data.markdown = htmlToMarkdown(html)
        }
      }

      if (opts.formats.includes('links')) {
        data.links = extractLinks(html, finalUrl)
      }

      // LLM extraction (runs after content is ready)
      if (opts.extract && typeof data.markdown === 'string') {
        try {
          data.extract = await extractWithLLM(data.markdown, {
            ...(opts.extract.schema !== undefined && { schema: opts.extract.schema }),
            ...(opts.extract.prompt !== undefined && { prompt: opts.extract.prompt }),
            ...(opts.extract.provider !== undefined && { provider: opts.extract.provider }),
            ...(opts.extract.model !== undefined && { model: opts.extract.model }),
          })
        } catch (err) {
          data.extractError = err instanceof Error ? err.message : 'LLM extraction failed'
        }
      }

      await cacheSet(key, data)

      if (opts.save && typeof data.markdown === 'string') {
        const savedPath = await saveMarkdownFile(data.markdown, metadata)
        data.savedTo = savedPath
      }

      scrapeTotal.inc({ mode: opts.mode, status: 'success' })
      timer()
      return reply.send({ success: true, data })
    }
  )
}
