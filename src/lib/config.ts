import { availableParallelism } from 'node:os'
import { z } from 'zod'

// z.coerce.boolean() treats "false" as true — parse env booleans explicitly
const envBool = (def: boolean) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : !['false', '0', 'no', 'off'].includes(String(v).toLowerCase())), z.boolean())

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CACHE_TTL_SECONDS: z.coerce.number().default(86400),
  BROWSER_POOL_SIZE: z.coerce.number().int().min(1).default(3),
  BROWSER_PREWARM: envBool(true),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  OUTPUT_DIR: z.string().default('/app/output'),
  PROXY_URL: z.string().optional(),
  STEALTH_MODE: envBool(true),
  HTTP_USER_AGENT: z.string().default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'),
  MAX_BODY_BYTES: z.coerce.number().int().min(1024).default(15 * 1024 * 1024),
  // HTML → markdown runs in worker threads so big pages don't block the event loop. 0 = inline.
  EXTRACT_WORKERS: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(0).default(Math.max(1, Math.min(4, availableParallelism() - 1)))),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  CRAWL_CONCURRENCY: z.coerce.number().int().min(1).default(10),
  // Max crawl jobs started per second across all crawls. 0 = unlimited.
  CRAWL_RATE_PER_SEC: z.coerce.number().int().min(0).default(10),
  SEARCH_ENGINE: z.enum(['google', 'duckduckgo']).default('google'),
  // Use the other engine when the primary one is blocked (CAPTCHA) or returns nothing
  SEARCH_FALLBACK: envBool(true),
  SEARCH_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(3600),
  OPENAI_API_KEY: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  LLM_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid config:', parsed.error.format())
  process.exit(1)
}

export const config = parsed.data
