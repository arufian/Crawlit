import { Redis } from 'ioredis'
import { createHash } from 'crypto'
import { config } from './config.js'
import { logger } from './logger.js'

let client: Redis | null = null

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 })
    client.on('error', (err: Error) => logger.warn({ err }, 'Redis error'))
  }
  return client
}

export function cacheKey(url: string, opts: object): string {
  const hash = createHash('sha256').update(url + JSON.stringify(opts)).digest('hex').slice(0, 16)
  return `crawlit:cache:${hash}`
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const val = await getRedis().get(key)
    return val ? (JSON.parse(val) as T) : null
  } catch {
    return null
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = config.CACHE_TTL_SECONDS): Promise<void> {
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds)
  } catch {
    // cache miss ok
  }
}
