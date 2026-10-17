import { Queue, Worker } from 'bullmq'
import { config } from '../lib/config.js'

export interface CrawlJobData {
  crawlId: string
  url: string
  depth: number
}

// BullMQ needs its own Redis connection with maxRetriesPerRequest: null
const REDIS_OPTS = { url: config.REDIS_URL, maxRetriesPerRequest: null }

export const crawlQueue = new Queue<CrawlJobData, void, string>('crawl', {
  connection: REDIS_OPTS,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 0 },
    removeOnFail: { count: 100 },
  },
})

export function makeCrawlWorker(
  processor: (job: { data: CrawlJobData }) => Promise<void>,
  concurrency = config.CRAWL_CONCURRENCY,
): Worker<CrawlJobData> {
  return new Worker<CrawlJobData, void, string>('crawl', processor, {
    connection: REDIS_OPTS,
    concurrency,
    ...(config.CRAWL_RATE_PER_SEC > 0 && { limiter: { max: config.CRAWL_RATE_PER_SEC, duration: 1000 } }),
  })
}
