import { describe, it, expect, beforeAll } from 'vitest'

const BASE = process.env.CRAWLIT_BASE_URL ?? 'http://localhost:3000'
const CONCURRENCY = 1000
const RATE_LIMIT = 60 // server's 60 req/min

async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`)
    return res.ok
  } catch {
    return false
  }
}

beforeAll(async () => {
  const ok = await healthCheck()
  if (!ok) {
    throw new Error(`Crawlit not running at ${BASE}. Start with: docker compose up --build -d`)
  }
})

interface LoadResult {
  status: number
  ok: boolean
  rateLimited: boolean
  durationMs: number
}

async function sendRequest(endpoint: string, init?: RequestInit): Promise<LoadResult> {
  const start = Date.now()
  try {
    const res = await fetch(`${BASE}${endpoint}`, init)
    const duration = Date.now() - start
    const body = await res.json().catch(() => ({}))
    const rateLimited =
      res.status === 429 ||
      (body.error && typeof body.error === 'string' && body.error.toLowerCase().includes('rate limit'))
    return { status: res.status, ok: res.ok, rateLimited, durationMs: duration }
  } catch (err) {
    return {
      status: 0,
      ok: false,
      rateLimited: false,
      durationMs: Date.now() - start,
    }
  }
}

function stats(results: LoadResult[]) {
  const ok = results.filter((r) => r.ok).length
  const rateLimited = results.filter((r) => r.rateLimited).length
  const failed = results.length - ok - rateLimited
  const durs = results.map((r) => r.durationMs).sort((a, b) => a - b)
  const p50 = durs[Math.floor(durs.length * 0.5)]
  const p95 = durs[Math.floor(durs.length * 0.95)]
  const p99 = durs[Math.floor(durs.length * 0.99)]
  return {
    total: results.length,
    ok,
    rateLimited,
    failed,
    min: durs[0],
    max: durs[durs.length - 1],
    avg: Math.round(durs.reduce((a, b) => a + b, 0) / durs.length),
    p50,
    p95,
    p99,
  }
}

function logStats(label: string, s: ReturnType<typeof stats>) {
  console.log(`\n  ── ${label} ──`)
  console.log(`  Total:         ${s.total}`)
  console.log(`  OK:            ${s.ok} (${((s.ok / s.total) * 100).toFixed(1)}%)`)
  console.log(`  Rate-limited:  ${s.rateLimited} (${((s.rateLimited / s.total) * 100).toFixed(1)}%)`)
  console.log(`  Failed:        ${s.failed} (${((s.failed / s.total) * 100).toFixed(1)}%)`)
  console.log(`  Latency:       min=${s.min}ms  avg=${s.avg}ms  p50=${s.p50}ms  p95=${s.p95}ms  p99=${s.p99}ms  max=${s.max}ms`)
}

// ── HEALTH CONCURRENT — validates rate limiting ──

describe('Health concurrent', () => {
  it('sends 1000 concurrent health requests — rate limit kicks in', { timeout: 60_000 }, async () => {
    const all = await Promise.allSettled(
      new Array(CONCURRENCY).fill(0).map(() => sendRequest('/health')),
    )
    const results = all
      .filter((r): r is PromiseFulfilledResult<LoadResult> => r.status === 'fulfilled')
      .map((r) => r.value)

    const s = stats(results)
    logStats(`Health ${CONCURRENCY}p`, s)

    // Rate limiting is expected — first ~60 should pass, rest rate-limited
    expect(s.ok).toBeGreaterThan(0)
    expect(s.ok).toBeLessThanOrEqual(RATE_LIMIT + 10) // allow slight overflow
    expect(s.rateLimited).toBeGreaterThan(0)
    expect(s.failed).toBe(0) // no real failures, only rate limiting
  })
})

// ── SCRAPE CONCURRENT ──

describe('Scrape concurrent', () => {
  it('sends 1000 concurrent scrape — rate limit kicks in', { timeout: 120_000 }, async () => {
    const all = await Promise.allSettled(
      new Array(CONCURRENCY).fill(0).map(() =>
        sendRequest('/v1/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'], skipCache: true }),
        }),
      ),
    )
    const results = all
      .filter((r): r is PromiseFulfilledResult<LoadResult> => r.status === 'fulfilled')
      .map((r) => r.value)

    const s = stats(results)
    logStats(`Scrape ${CONCURRENCY}p`, s)

    // Rate limit may be exhausted from prior tests — OK count may be 0
    // Key assertion: no real errors, server handles load without crashing
    expect(s.failed).toBeLessThan(s.total * 0.05) // <5% true failures
    expect(s.rateLimited + s.ok).toBe(s.total) // all requests handled (OK or rate-limited)
  })
})

// ── MAP CONCURRENT ──

describe('Map concurrent', () => {
  it('sends 1000 concurrent map — rate limit kicks in', { timeout: 120_000 }, async () => {
    const all = await Promise.allSettled(
      new Array(CONCURRENCY).fill(0).map(() =>
        sendRequest('/v1/map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com', limit: 5 }),
        }),
      ),
    )
    const results = all
      .filter((r): r is PromiseFulfilledResult<LoadResult> => r.status === 'fulfilled')
      .map((r) => r.value)

    const s = stats(results)
    logStats(`Map ${CONCURRENCY}p`, s)

    // No real errors under concurrent load
    expect(s.failed).toBeLessThan(s.total * 0.05)
    expect(s.rateLimited + s.ok).toBe(s.total)
  })
})

// ── MIXED WORKLOAD ──

describe('Mixed workload', () => {
  it(`sends ${CONCURRENCY} concurrent mixed — rate limit kicks in`, { timeout: 120_000 }, async () => {
    const endpoints = [
      { path: '/health', method: 'GET', body: null },
      { path: '/v1/scrape', method: 'POST', body: { url: 'https://example.com', formats: ['markdown'] } },
      { path: '/v1/map', method: 'POST', body: { url: 'https://example.com', limit: 3 } },
    ]

    const all = await Promise.allSettled(
      new Array(CONCURRENCY).fill(0).map((_, i) => {
        const { path, method, body } = endpoints[i % endpoints.length]
        const init: RequestInit = { method }
        if (body) {
          init.headers = { 'Content-Type': 'application/json' }
          init.body = JSON.stringify(body)
        }
        return sendRequest(path, init)
      }),
    )
    const results = all
      .filter((r): r is PromiseFulfilledResult<LoadResult> => r.status === 'fulfilled')
      .map((r) => r.value)

    const s = stats(results)
    logStats(`Mixed ${CONCURRENCY}p`, s)

    // With 60/min limit, most should be rate-limited. Key: no crashes.
    expect(s.failed).toBeLessThan(s.total * 0.05) // <5% real errors
    expect(s.rateLimited + s.ok).toBe(s.total)

    // Server stays fast under load — p95 under 5 seconds
    expect(s.p95).toBeLessThan(5000)
  })
})
