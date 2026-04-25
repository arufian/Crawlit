import { Queue, Worker, QueueEvents } from 'bullmq'
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
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 0 },
    removeOnFail: { count: 100 },
  },
})

export function makeCrawlWorker(
  processor: (job: { data: CrawlJobData }) => Promise<void>,
  concurrency = 5,
): Worker<CrawlJobData> {
  return new Worker<CrawlJobData, void, string>('crawl', processor, {
    connection: REDIS_OPTS,
    concurrency,
    limiter: { max: 2, duration: 1000 },
  })
}

export const crawlQueueEvents = new QueueEvents('crawl', { connection: REDIS_OPTS })
