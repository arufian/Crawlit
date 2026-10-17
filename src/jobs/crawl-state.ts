import { getRedis } from '../lib/cache.js'
import type { PageMetadata } from '../core/extractor/metadata-extractor.js'
import type { FetchMode } from '../core/scrape-service.js'
import type { OutputFormat } from '../core/extractor/content.js'

export type CrawlStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface CrawlMeta {
  id: string
  url: string
  status: CrawlStatus
  startedAt: string
  completedAt?: string
  /** URLs accepted into the crawl (≤ options.limit). */
  total: number
  completed: number
  failed: number
  /** Jobs enqueued but not yet finished; the crawl is done when this reaches 0. */
  pending: number
  options: CrawlOptions
}

export interface CrawlOptions {
  maxDepth: number
  limit: number
  allowedDomains: string[]
  mode: FetchMode
  formats: OutputFormat[]
  onlyMainContent: boolean
  save: boolean
  includePaths?: string[]
  excludePaths?: string[]
  proxy?: string
}

export interface CrawlPageResult {
  url: string
  markdown?: string
  html?: string
  links?: string[]
  rawHtml?: string
  savedTo?: string
  metadata: PageMetadata
}

// Meta lives in a hash so counters update atomically (HINCRBY) under concurrent workers.
// New key name: older string-typed ":meta" keys would make HGETALL fail with WRONGTYPE.
function infoKey(id: string) { return `crawlit:crawl:${id}:info` }
function resultsKey(id: string) { return `crawlit:crawl:${id}:results` }
function seenKey(id: string) { return `crawlit:crawl:${id}:seen` }
function doneKey(id: string) { return `crawlit:crawl:${id}:done` }

const CRAWL_TTL = 60 * 60 * 24 * 7 // 7 days

export async function createCrawl(id: string, url: string, options: CrawlOptions): Promise<void> {
  await getRedis().multi()
    .hset(infoKey(id), {
      id, url, status: 'pending',
      startedAt: new Date().toISOString(),
      // The seed URL counts as accepted and pending
      total: 1, completed: 0, failed: 0, pending: 1,
      options: JSON.stringify(options),
    })
    .expire(infoKey(id), CRAWL_TTL)
    .sadd(seenKey(id), url)
    .expire(seenKey(id), CRAWL_TTL)
    .exec()
}

export async function getMeta(id: string): Promise<CrawlMeta | null> {
  const h = await getRedis().hgetall(infoKey(id))
  if (!h.id) return null
  return {
    id: h.id,
    url: h.url ?? '',
    status: (h.status ?? 'pending') as CrawlStatus,
    startedAt: h.startedAt ?? '',
    ...(h.completedAt && { completedAt: h.completedAt }),
    total: Number(h.total ?? 0),
    completed: Number(h.completed ?? 0),
    failed: Number(h.failed ?? 0),
    pending: Number(h.pending ?? 0),
    options: JSON.parse(h.options ?? '{}') as CrawlOptions,
  }
}

export async function setStatus(id: string, status: CrawlStatus): Promise<void> {
  const fields: Record<string, string> = { status }
  if (status === 'completed' || status === 'cancelled' || status === 'failed') fields.completedAt = new Date().toISOString()
  await getRedis().hset(infoKey(id), fields)
}

/** Store a page result (or count a failure) in one round trip. */
export async function recordPage(id: string, result: CrawlPageResult | null): Promise<void> {
  const tx = getRedis().multi()
  if (result) {
    tx.rpush(resultsKey(id), JSON.stringify(result)).expire(resultsKey(id), CRAWL_TTL).hincrby(infoKey(id), 'completed', 1)
  } else {
    tx.hincrby(infoKey(id), 'failed', 1)
  }
  await tx.exec()
}

/**
 * Mark links as seen and reserve slots under the crawl limit atomically.
 * Returns the links the caller should enqueue (already counted in total + pending).
 */
export async function acceptLinks(id: string, links: string[], limit: number): Promise<string[]> {
  if (links.length === 0) return []
  const redis = getRedis()
  const pipe = redis.pipeline()
  for (const link of links) pipe.sadd(seenKey(id), link)
  const added = (await pipe.exec()) ?? []
  const fresh = links.filter((_, i) => added[i]?.[1] === 1)
  if (fresh.length === 0) return []

  const after = await redis.hincrby(infoKey(id), 'total', fresh.length)
  const before = after - fresh.length
  const allowed = Math.max(0, Math.min(fresh.length, limit - before))
  const tx = redis.multi()
  if (allowed < fresh.length) tx.hincrby(infoKey(id), 'total', allowed - fresh.length)
  if (allowed > 0) tx.hincrby(infoKey(id), 'pending', allowed)
  await tx.exec()
  return fresh.slice(0, allowed)
}

/**
 * Mark a job finished exactly once (safe under BullMQ retries) and return the remaining
 * pending count, or null if this URL was already finished.
 */
export async function finishJob(id: string, url: string): Promise<number | null> {
  const redis = getRedis()
  const res = await redis.multi().sadd(doneKey(id), url).expire(doneKey(id), CRAWL_TTL).exec()
  if (res?.[0]?.[1] !== 1) return null
  return redis.hincrby(infoKey(id), 'pending', -1)
}

export async function getResults(id: string, offset = 0, limit = 1000): Promise<CrawlPageResult[]> {
  const raw = await getRedis().lrange(resultsKey(id), offset, offset + limit - 1)
  return raw.map((r) => JSON.parse(r) as CrawlPageResult)
}

export async function deleteCrawl(id: string): Promise<void> {
  await getRedis().del(infoKey(id), resultsKey(id), seenKey(id), doneKey(id))
}
