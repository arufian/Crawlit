import { makeCrawlWorker, crawlQueue } from './queue.js'
import type { CrawlJobData } from './queue.js'
import {
  getMeta, updateMeta, markSeen, seenCount,
  pushResult, type CrawlOptions,
} from './crawl-state.js'
import { fetchHttp } from '../core/fetcher/http-fetcher.js'
import { fetchBrowser } from '../core/fetcher/browser-fetcher.js'
import { extractMainContent } from '../core/extractor/readability-extractor.js'
import { extractMetadata, extractLinks } from '../core/extractor/metadata-extractor.js'
import { htmlToMarkdown, contentToMarkdown } from '../core/transformer/html-to-markdown.js'
import { saveMarkdownFile } from '../core/transformer/save-markdown.js'
import { logger } from '../lib/logger.js'
import { createRequire } from 'module'
import { createHash } from 'crypto'
import { request } from 'undici'

const _require = createRequire(import.meta.url)
const robotsParser = _require('robots-parser') as (url: string, txt: string) => {
  isAllowed(url: string, ua?: string): boolean | undefined
  isDisallowed(url: string, ua?: string): boolean | undefined
}
type RobotsInstance = ReturnType<typeof robotsParser>

const robotsCache = new Map<string, RobotsInstance>()

async function fetchRobots(origin: string): Promise<RobotsInstance> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!
  try {
    const { body } = await request(`${origin}/robots.txt`, { headersTimeout: 5000, bodyTimeout: 5000 })
    const txt = await body.text()
    const robots = robotsParser(`${origin}/robots.txt`, txt)
    robotsCache.set(origin, robots)
    return robots
  } catch {
    const permissive = robotsParser(`${origin}/robots.txt`, '')
    robotsCache.set(origin, permissive)
    return permissive
  }
}

async function scrapeUrl(url: string, opts: CrawlOptions) {
  if (opts.mode === 'browser') {
    return fetchBrowser(url, {
      timeoutMs: 30000,
      ...(opts.proxy !== undefined && { proxy: opts.proxy }),
    })
  }
  return fetchHttp(url, 30000)
}

function filterLinks(links: string[], seedHostname: string, opts: CrawlOptions): string[] {
  const allowed = opts.allowedDomains.length > 0
    ? opts.allowedDomains
    : [seedHostname]

  return links.filter((link) => {
    try {
      const u = new URL(link)
      return allowed.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))
    } catch {
      return false
    }
  })
}

export function startCrawlWorker() {
  const worker = makeCrawlWorker(async (job: { data: CrawlJobData }) => {
    const { crawlId, url, depth } = job.data

    const meta = await getMeta(crawlId)
    if (!meta || meta.status === 'cancelled') return

    if (meta.status === 'pending') {
      await updateMeta(crawlId, { status: 'running' })
    }

    const seen = await seenCount(crawlId)
    if (seen > meta.options.limit) return

    const origin = new URL(url).origin
    const robots = await fetchRobots(origin)
    if (!robots.isAllowed(url, 'Crawlit')) {
      logger.debug({ url }, 'Blocked by robots.txt')
      return
    }

    let fetchResult
    try {
      fetchResult = await scrapeUrl(url, meta.options)
    } catch (err) {
      logger.warn({ url, err }, 'Fetch failed during crawl')
      return
    }

    const { html, statusCode, url: finalUrl } = fetchResult
    const metadata = extractMetadata(html, finalUrl, statusCode)
    const pageResult: Awaited<ReturnType<typeof buildPageResult>> = await buildPageResult(
      html, finalUrl, statusCode, meta.options
    )

    await pushResult(crawlId, pageResult)
    await updateMeta(crawlId, { completed: (meta.completed ?? 0) + 1 })

    // Enqueue children if not at max depth
    if (depth < meta.options.maxDepth) {
      const links = extractLinks(html, finalUrl)
      const seedHostname = new URL(meta.url).hostname
      const filtered = filterLinks(links, seedHostname, meta.options)

      for (const link of filtered) {
        const isNew = await markSeen(crawlId, link)
        if (!isNew) continue

        const currentSeen = await seenCount(crawlId)
        if (currentSeen > meta.options.limit) break

        await crawlQueue.add('page', { crawlId, url: link, depth: depth + 1 }, {
          jobId: `${crawlId}_${createHash('sha256').update(link).digest('hex').slice(0, 16)}`,
        })
        await updateMeta(crawlId, { total: currentSeen })
      }
    }

    // Check if all done: queue drained
    const waiting = await crawlQueue.getWaitingCount()
    const active = await crawlQueue.getActiveCount()
    const currentMeta = await getMeta(crawlId)
    if (waiting === 0 && active <= 1 && currentMeta?.status === 'running') {
      await updateMeta(crawlId, { status: 'completed', completedAt: new Date().toISOString() })
    }
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Crawl job failed')
  })

  return worker
}

async function buildPageResult(
  html: string,
  url: string,
  statusCode: number,
  opts: CrawlOptions,
) {
  const metadata = extractMetadata(html, url, statusCode)
  const result: {
    url: string
    metadata: typeof metadata
    markdown?: string
    html?: string
    links?: string[]
    rawHtml?: string
    savedTo?: string
  } = { url, metadata }

  if (opts.formats.includes('rawHtml')) result.rawHtml = html

  if (opts.formats.includes('html') || opts.formats.includes('markdown')) {
    if (opts.onlyMainContent) {
      const extracted = extractMainContent(html, url)
      if (extracted) {
        if (opts.formats.includes('html')) result.html = extracted.content
        if (opts.formats.includes('markdown')) result.markdown = contentToMarkdown(extracted.content)
      } else {
        if (opts.formats.includes('html')) result.html = html
        if (opts.formats.includes('markdown')) result.markdown = htmlToMarkdown(html)
      }
    } else {
      if (opts.formats.includes('html')) result.html = html
      if (opts.formats.includes('markdown')) result.markdown = htmlToMarkdown(html)
    }
  }

  if (opts.formats.includes('links')) result.links = extractLinks(html, url)

  if (opts.save && result.markdown) {
    result.savedTo = await saveMarkdownFile(result.markdown, metadata)
  }

  return result
}
