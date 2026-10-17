import { makeCrawlWorker, crawlQueue } from './queue.js'
import type { CrawlJobData } from './queue.js'
import {
  getMeta, setStatus, recordPage, acceptLinks, finishJob,
  type CrawlMeta, type CrawlOptions, type CrawlPageResult,
} from './crawl-state.js'
import { fetchHttp } from '../core/fetcher/http-fetcher.js'
import { scrapePage, type ScrapeData } from '../core/scrape-service.js'
import type { OutputFormat } from '../core/extractor/content.js'
import { crawlPagesTotal } from '../lib/metrics.js'
import { logger } from '../lib/logger.js'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

const _require = createRequire(import.meta.url)
const robotsParser = _require('robots-parser') as (url: string, txt: string) => {
  isAllowed(url: string, ua?: string): boolean | undefined
  isDisallowed(url: string, ua?: string): boolean | undefined
}
type RobotsInstance = ReturnType<typeof robotsParser>

const ROBOTS_CACHE_MAX = 1000
const robotsCache = new Map<string, Promise<RobotsInstance>>()

// Cache the promise so concurrent jobs on a new origin share one robots.txt fetch
function fetchRobots(origin: string): Promise<RobotsInstance> {
  let robots = robotsCache.get(origin)
  if (!robots) {
    const oldest = robotsCache.keys().next().value
    if (robotsCache.size >= ROBOTS_CACHE_MAX && oldest !== undefined) robotsCache.delete(oldest)
    robots = fetchHttp(`${origin}/robots.txt`, 5000)
      .then(({ html, statusCode }) => robotsParser(`${origin}/robots.txt`, statusCode < 400 ? html : ''))
      .catch(() => robotsParser(`${origin}/robots.txt`, ''))
    robotsCache.set(origin, robots)
  }
  return robots
}

// Links to binaries/assets aren't pages — skip them instead of fetching and discarding
const NON_PAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|mp[34]|m4a|wav|ogg|webm|mov|avi|zip|tar|gz|tgz|rar|7z|exe|dmg|pkg|deb|rpm|iso|css|js|mjs|map|woff2?|ttf|otf|eot|pdf|docx?|xlsx?|pptx?)$/i

function filterLinks(links: string[], seedHostname: string, opts: CrawlOptions): string[] {
  const allowed = opts.allowedDomains.length > 0
    ? opts.allowedDomains
    : [seedHostname]
  const include = opts.includePaths?.map((p) => new RegExp(p))
  const exclude = opts.excludePaths?.map((p) => new RegExp(p))

  return links.filter((link) => {
    try {
      const u = new URL(link)
      if (!allowed.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))) return false
      if (NON_PAGE_EXT.test(u.pathname)) return false
      if (include?.length && !include.some((re) => re.test(u.pathname))) return false
      if (exclude?.some((re) => re.test(u.pathname))) return false
      return true
    } catch {
      return false
    }
  })
}

function jobId(crawlId: string, url: string): string {
  return `${crawlId}_${createHash('sha256').update(url).digest('hex').slice(0, 16)}`
}

async function crawlOne(meta: CrawlMeta, url: string, depth: number): Promise<void> {
  const crawlId = meta.id
  if (meta.status === 'cancelled') return

  if (meta.status === 'pending') {
    await setStatus(crawlId, 'running')
  }

  const robots = await fetchRobots(new URL(url).origin)
  if (robots.isAllowed(url, 'Crawlit') === false) {
    logger.debug({ url }, 'Blocked by robots.txt')
    return
  }

  const opts = meta.options
  const wantsLinks = opts.formats.includes('links')
  // Always ask for links: they drive the traversal even if the caller didn't request them
  const formats: OutputFormat[] = wantsLinks ? opts.formats : [...opts.formats, 'links']

  let page: ScrapeData
  try {
    ({ data: page } = await scrapePage({
      url,
      formats,
      onlyMainContent: opts.onlyMainContent,
      timeout: 30000,
      skipCache: false,
      save: opts.save,
      mode: opts.mode,
      ...(opts.proxy !== undefined && { proxy: opts.proxy }),
    }))
  } catch (err) {
    logger.warn({ url, err: err instanceof Error ? err.message : err }, 'Fetch failed during crawl')
    crawlPagesTotal.inc({ status: 'error' })
    await recordPage(crawlId, null)
    return
  }

  const finalUrl = page.metadata.sourceURL || url
  const result: CrawlPageResult = { url: finalUrl, metadata: page.metadata }
  if (page.markdown !== undefined) result.markdown = page.markdown
  if (page.html !== undefined) result.html = page.html
  if (page.rawHtml !== undefined) result.rawHtml = page.rawHtml
  if (page.savedTo !== undefined) result.savedTo = page.savedTo
  if (wantsLinks && page.links) result.links = page.links

  await recordPage(crawlId, result)
  crawlPagesTotal.inc({ status: 'success' })

  // Enqueue children if not at max depth
  if (depth < opts.maxDepth && page.links?.length) {
    const seedHostname = new URL(meta.url).hostname
    const accepted = await acceptLinks(crawlId, filterLinks(page.links, seedHostname, opts), opts.limit)
    if (accepted.length > 0) {
      await crawlQueue.addBulk(accepted.map((link) => ({
        name: 'page',
        data: { crawlId, url: link, depth: depth + 1 },
        opts: { jobId: jobId(crawlId, link) },
      })))
    }
  }
}

export function startCrawlWorker() {
  const worker = makeCrawlWorker(async (job: { data: CrawlJobData }) => {
    const { crawlId, url, depth } = job.data
    const meta = await getMeta(crawlId)
    // Expired, deleted, or created by an older version (different key layout) — nothing to update
    if (!meta) return
    try {
      await crawlOne(meta, url, depth)
    } finally {
      // Per-crawl completion: done when every accepted URL has finished (any outcome)
      const remaining = await finishJob(crawlId, url)
      if (remaining !== null && remaining <= 0) {
        const meta = await getMeta(crawlId)
        if (meta && (meta.status === 'running' || meta.status === 'pending')) {
          await setStatus(crawlId, 'completed')
        }
      }
    }
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Crawl job failed')
  })

  return worker
}
