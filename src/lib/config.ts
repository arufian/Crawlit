import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  API_KEYS: z.string().default('').transform((v) =>
    v ? v.split(',').map((k) => k.trim()).filter(Boolean) : []
  ),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CACHE_TTL_SECONDS: z.coerce.number().default(86400),
  BROWSER_POOL_SIZE: z.coerce.number().default(3),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  OUTPUT_DIR: z.string().default('/app/output'),
  PROXY_URL: z.string().optional(),
  STEALTH_MODE: z.coerce.boolean().default(true),
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
