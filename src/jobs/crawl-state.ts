import { getRedis } from '../lib/cache.js'

export type CrawlStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface CrawlMeta {
  id: string
  url: string
  status: CrawlStatus
  startedAt: string
  completedAt?: string
  total: number
  completed: number
  options: CrawlOptions
}

export interface CrawlOptions {
  maxDepth: number
  limit: number
  allowedDomains: string[]
  mode: 'http' | 'browser'
  formats: string[]
  onlyMainContent: boolean
  save: boolean
  proxy?: string
}

export interface CrawlPageResult {
  url: string
  markdown?: string
  html?: string
  links?: string[]
  rawHtml?: string
  savedTo?: string
  metadata: {
    title: string
    description: string
    statusCode: number
    sourceURL: string
  }
}

function metaKey(id: string) { return `crawlit:crawl:${id}:meta` }
function resultsKey(id: string) { return `crawlit:crawl:${id}:results` }
function seenKey(id: string) { return `crawlit:crawl:${id}:seen` }

const CRAWL_TTL = 60 * 60 * 24 * 7 // 7 days

export async function createCrawl(id: string, url: string, options: CrawlOptions): Promise<void> {
  const meta: CrawlMeta = {
    id, url, status: 'pending',
    startedAt: new Date().toISOString(),
    total: 0, completed: 0, options,
  }
  const redis = getRedis()
  await redis.set(metaKey(id), JSON.stringify(meta), 'EX', CRAWL_TTL)
}

export async function getMeta(id: string): Promise<CrawlMeta | null> {
  const raw = await getRedis().get(metaKey(id))
  return raw ? (JSON.parse(raw) as CrawlMeta) : null
}

export async function updateMeta(id: string, patch: Partial<CrawlMeta>): Promise<void> {
  const meta = await getMeta(id)
  if (!meta) return
  const updated = { ...meta, ...patch }
  await getRedis().set(metaKey(id), JSON.stringify(updated), 'KEEPTTL')
}

export async function markSeen(id: string, url: string): Promise<boolean> {
  // Returns true if newly added (not seen before)
  const added = await getRedis().sadd(seenKey(id), url)
  await getRedis().expire(seenKey(id), CRAWL_TTL)
  return added === 1
}

export async function seenCount(id: string): Promise<number> {
  return getRedis().scard(seenKey(id))
}

export async function pushResult(id: string, result: CrawlPageResult): Promise<void> {
  const redis = getRedis()
  await redis.rpush(resultsKey(id), JSON.stringify(result))
  await redis.expire(resultsKey(id), CRAWL_TTL)
}

export async function getResults(id: string, offset = 0, limit = 1000): Promise<CrawlPageResult[]> {
  const raw = await getRedis().lrange(resultsKey(id), offset, offset + limit - 1)
  return raw.map((r) => JSON.parse(r) as CrawlPageResult)
}

export async function deleteCrawl(id: string): Promise<void> {
  const redis = getRedis()
  await redis.del(metaKey(id), resultsKey(id), seenKey(id))
}
