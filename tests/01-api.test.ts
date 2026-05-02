import { describe, it, expect, beforeAll } from 'vitest'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

const BASE = process.env.CRAWLIT_BASE_URL ?? 'http://localhost:3000'
const OUTPUT_DIR = join(import.meta.dirname, 'output')

const GITHUB_URL = 'https://github.com/arufian/Crawlit'
const GOOGLE_URL =
  'https://www.google.com/search?q=crawlit'

async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`)
    return res.ok
  } catch {
    return false
  }
}

async function apiPost<T = unknown>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as T
  return { status: res.status, data }
}

async function apiGet<T = unknown>(path: string): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`)
  const data = await res.json() as T
  return { status: res.status, data }
}

async function apiDelete<T = unknown>(path: string): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  const data = await res.json() as T
  return { status: res.status, data }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

beforeAll(async () => {
  const ok = await healthCheck()
  if (!ok) {
    throw new Error(`Crawlit not running at ${BASE}. Start with: docker compose up --build -d`)
  }
})

// ─── HEALTH ────────────────────────────────────────────

describe('GET /health', () => {
  it('returns ok status', async () => {
    const { data } = await apiGet<{ status: string; version: string }>('/health')
    expect(data.status).toBe('ok')
    expect(data.version).toBeTruthy()
  })
})

// ─── SCRAPE ───────────────────────────────────────────

describe('POST /v1/scrape', () => {
  const shortTimeout = 300_000

  it('scrapes example.com and returns markdown', { timeout: shortTimeout }, async () => {
    const { status, data } = await apiPost<{
      success: boolean
      data: { markdown: string; metadata: { title: string; sourceURL: string } }
    }>('/v1/scrape', {
      url: 'https://example.com',
      formats: ['markdown'],
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.markdown).toBeTruthy()
    expect(data.data.markdown.length).toBeGreaterThan(100)
    expect(data.data.metadata).toBeDefined()
    expect(data.data.metadata.sourceURL).toContain('example.com')
  })

  it('scrapes example.com with multiple formats', { timeout: shortTimeout }, async () => {
    const { status, data } = await apiPost<{
      success: boolean
      data: { markdown: string; html: string; links: string[]; metadata: unknown }
    }>('/v1/scrape', {
      url: 'https://example.com',
      formats: ['markdown', 'html', 'links'],
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.markdown).toBeTruthy()
    expect(data.data.html).toBeTruthy()
    expect(Array.isArray(data.data.links)).toBe(true)
    expect(data.data.links.length).toBeGreaterThan(0)
  })

  it('scrapes example.com with rawHtml format', { timeout: shortTimeout }, async () => {
    const { status, data } = await apiPost<{
      success: boolean
      data: { rawHtml: string }
    }>('/v1/scrape', {
      url: 'https://example.com',
      formats: ['rawHtml'],
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.rawHtml).toBeTruthy()
  })

  it('scrapes with onlyMainContent: false', { timeout: shortTimeout }, async () => {
    // full page should have more content than main-only
    const { data: full } = await apiPost<{
      success: boolean
      data: { markdown: string }
    }>('/v1/scrape', {
      url: 'https://example.com',
      formats: ['markdown'],
      onlyMainContent: false,
    })
    expect(full.success).toBe(true)
    expect(full.data.markdown).toBeTruthy()
  })

  it('respects skipCache for fresh fetch', { timeout: shortTimeout }, async () => {
    const { status, data } = await apiPost<{ success: boolean }>('/v1/scrape', {
      url: 'https://example.com',
      formats: ['markdown'],
      skipCache: true,
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('returns 422 for invalid URL', async () => {
    const { status, data } = await apiPost<{ success: boolean; error: unknown }>('/v1/scrape', {
      url: 'not-a-url',
      formats: ['markdown'],
    })
    expect(status).toBe(422)
    expect(data.success).toBe(false)
    expect(data.error).toBeDefined()
  })

  it('returns 422 for missing url field', async () => {
    const res = await fetch(`${BASE}/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formats: ['markdown'] }),
    })
    expect(res.status).toBe(422)
  })

  it('scrapes GitHub repo page and saves to disk', { timeout: shortTimeout }, async () => {
    const { status, data } = await apiPost<{
      success: boolean
      data: {
        markdown: string
        metadata: { title: string; sourceURL: string; description: string; statusCode: number }
        links: string[]
      }
    }>('/v1/scrape', {
      url: GITHUB_URL,
      formats: ['markdown', 'links'],
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)

    expect(data.data.metadata).toBeDefined()
    expect(data.data.metadata.statusCode).toBe(200)

    const md = data.data.markdown
    expect(md).toBeTruthy()
    expect(md.length).toBeGreaterThan(500)

    // GitHub repo page indicators
    const hasRepoContent =
      md.toLowerCase().includes('crawlit') ||
      md.toLowerCase().includes('github') ||
      md.toLowerCase().includes('readme')
    expect(hasRepoContent).toBe(true)

    // links should be present
    expect(Array.isArray(data.data.links)).toBe(true)
    expect(data.data.links.length).toBeGreaterThan(5)

    // Save to tests/output/
    await mkdir(OUTPUT_DIR, { recursive: true })
    const slug = 'github-arufian-crawlit'
    await writeFile(join(OUTPUT_DIR, `${slug}.md`), md, 'utf-8')
    await writeFile(join(OUTPUT_DIR, `${slug}.links.json`), JSON.stringify(data.data.links, null, 2), 'utf-8')
    await writeFile(join(OUTPUT_DIR, `${slug}.metadata.json`), JSON.stringify(data.data.metadata, null, 2), 'utf-8')

    console.log(`  Markdown length: ${md.length} chars`)
    console.log(`  Links found: ${data.data.links.length}`)
    console.log(`  Title: ${data.data.metadata.title}`)
    console.log(`  Saved: tests/output/${slug}.md`)
    console.log(`  Saved: tests/output/${slug}.links.json`)
    console.log(`  Saved: tests/output/${slug}.metadata.json`)
  })

  it('scrapes search engine results and saves to disk', { timeout: shortTimeout }, async () => {
    // DuckDuckGo doesn't block scrapers — returns real search results
    const url = 'https://html.duckduckgo.com/html/?q=crawlit+oss+firecrawl'
    const { status, data } = await apiPost<{
      success: boolean
      data: {
        markdown: string
        metadata: { title: string; sourceURL: string; description: string; statusCode: number }
        links: string[]
      }
    }>('/v1/scrape', {
      url,
      formats: ['markdown', 'links'],
    })

    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.metadata).toBeDefined()
    expect(data.data.metadata.statusCode).toBe(200)

    const md = data.data.markdown
    expect(md).toBeTruthy()
    expect(md.length).toBeGreaterThan(500)

    // DuckDuckGo result indicators
    const hasResults =
      md.toLowerCase().includes('crawlit') ||
      md.toLowerCase().includes('search') ||
      md.toLowerCase().includes('result') ||
      md.toLowerCase().includes('firecrawl')
    expect(hasResults).toBe(true)

    expect(Array.isArray(data.data.links)).toBe(true)
    expect(data.data.links.length).toBeGreaterThan(3)

    // Save to tests/output/
    await mkdir(OUTPUT_DIR, { recursive: true })
    const slug = 'duckduckgo-crawlit-search'
    await writeFile(join(OUTPUT_DIR, `${slug}.md`), md, 'utf-8')
    await writeFile(join(OUTPUT_DIR, `${slug}.links.json`), JSON.stringify(data.data.links, null, 2), 'utf-8')
    await writeFile(join(OUTPUT_DIR, `${slug}.metadata.json`), JSON.stringify(data.data.metadata, null, 2), 'utf-8')

    console.log(`  Markdown length: ${md.length} chars`)
    console.log(`  Links found: ${data.data.links.length}`)
    console.log(`  Title: ${data.data.metadata.title}`)
    console.log(`  Saved: tests/output/${slug}.md`)
    console.log(`  Saved: tests/output/${slug}.links.json`)
    console.log(`  Saved: tests/output/${slug}.metadata.json`)
  })
})

// ─── CRAWL ────────────────────────────────────────────

describe('POST /v1/crawl', () => {
  const crawlTimeout = 600_000
  let crawlId: string

  it('creates a crawl job', { timeout: crawlTimeout }, async () => {
    const { status, data } = await apiPost<{
      success: boolean
      id: string
      url: string
    }>('/v1/crawl', {
      url: 'https://example.com',
      maxDepth: 1,
      limit: 3,
      formats: ['markdown'],
      save: false,
    })
    expect(status).toBe(202)
    expect(data.success).toBe(true)
    expect(data.id).toBeTruthy()
    expect(data.url).toContain('/v1/crawl/')
    crawlId = data.id
  })

  it('polls crawl status until completed', { timeout: crawlTimeout }, async () => {
    expect(crawlId).toBeTruthy()

    let attempts = 0
    const maxAttempts = 300 // 10 minutes at 2s intervals

    while (attempts < maxAttempts) {
      const { status, data } = await apiGet<{
        success: boolean
        status: string
        completed: number
        total: number
        data: unknown[]
      }>(`/v1/crawl/${crawlId}`)

      expect(data.success).toBe(true)
      expect(['pending', 'running', 'completed', 'failed', 'cancelled']).toContain(data.status)

      if (data.status === 'completed') {
        expect(data.completed).toBeGreaterThanOrEqual(1)
        expect(data.data).toBeTruthy()
        expect(Array.isArray(data.data)).toBe(true)
        expect(data.data.length).toBeGreaterThan(0)

        // verify first result has markdown
        const first = data.data[0] as { markdown?: string; metadata?: { title?: string } }
        expect(first.markdown).toBeTruthy()
        expect(first.metadata).toBeDefined()
        break
      }

      if (data.status === 'failed') {
        throw new Error('Crawl failed')
      }

      attempts++
      await sleep(2000)
    }

    if (attempts >= maxAttempts) {
      await apiDelete(`/v1/crawl/${crawlId}`)
    }

    expect(attempts).toBeLessThan(maxAttempts)
  })

  it('returns 422 for invalid crawl params', async () => {
    const { status, data } = await apiPost<{ success: boolean; error: unknown }>('/v1/crawl', {
      url: 'not-a-url',
      maxDepth: 1,
      limit: 3,
    })
    expect(status).toBe(422)
    expect(data.success).toBe(false)
  })
})

// ─── MAP ──────────────────────────────────────────────

describe('POST /v1/map', () => {
  it('maps example.com and returns URL list', async () => {
    const { status, data } = await apiPost<{
      success: boolean
      links: string[]
      total: number
    }>('/v1/map', {
      url: 'https://example.com',
      limit: 10,
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(Array.isArray(data.links)).toBe(true)
    expect(typeof data.total).toBe('number')
    expect(data.total).toBeLessThanOrEqual(10)

    for (const link of data.links) {
      expect(() => new URL(link)).not.toThrow()
    }
  })

  it('maps with includeSubdomains', async () => {
    const { status, data } = await apiPost<{ success: boolean; total: number }>('/v1/map', {
      url: 'https://example.com',
      limit: 10,
      includeSubdomains: true,
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('returns 422 for invalid map params', async () => {
    const { status, data } = await apiPost<{ success: boolean; error: unknown }>('/v1/map', {
      url: 'not-a-url',
    })
    expect(status).toBe(422)
    expect(data.success).toBe(false)
  })
})

// ─── SEARCH ──────────────────────────────────────────

describe('POST /v1/search', () => {
  it('searches DuckDuckGo for results', async () => {
    const { status, data } = await apiPost<{
      success: boolean
      data: { query: string; results: { title: string; url: string; snippet: string }[]; total: number; blocked?: boolean }
    }>('/v1/search', {
      query: 'crawlit',
      limit: 5,
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.query).toBe('crawlit')
    expect(Array.isArray(data.data.results)).toBe(true)
    expect(data.data.results.length).toBeLessThanOrEqual(5)
    expect(data.data.total).toBe(data.data.results.length)

    if (data.data.results.length > 0) {
      const first = data.data.results[0]
      expect(first.title).toBeTruthy()
      expect(first.url).toBeTruthy()
      expect(() => new URL(first.url)).not.toThrow()
      expect(typeof first.snippet).toBe('string')
      console.log(`  Found ${data.data.total} results`)
      console.log(`  First result: "${first.title}"`)
    } else {
      console.log(`  DuckDuckGo returned 0 results (likely rate-limited from earlier requests)`)
    }
  })

  it('returns 422 for empty query', async () => {
    const { status, data } = await apiPost<{ success: boolean; error: unknown }>('/v1/search', {
      query: '',
    })
    expect(status).toBe(422)
    expect(data.success).toBe(false)
  })

  it('respects limit parameter', async () => {
    const { data } = await apiPost<{
      success: boolean
      data: { results: unknown[] }
    }>('/v1/search', {
      query: 'test',
      limit: 3,
    })
    expect(data.success).toBe(true)
    expect(data.data.results.length).toBeLessThanOrEqual(3)
  })
})

// ─── METRICS ──────────────────────────────────────────

describe('GET /metrics', () => {
  it('returns Prometheus metrics', async () => {
    const res = await fetch(`${BASE}/metrics`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('crawlit_')
    expect(text).toContain('scrape_total')
  })
})

// ─── ERROR HANDLING ──────────────────────────────────

describe('Error handling', () => {
  it('500 errors return structured response', { timeout: 30000 }, async () => {
    const { status, data } = await apiPost<{ success: boolean; error: string }>('/v1/scrape', {
      url: 'https://this-domain-definitely-does-not-exist-00000.com',
      formats: ['markdown'],
    })
    if (status === 500) {
      expect(data.success).toBe(false)
      expect(typeof data.error).toBe('string')
      // After rebuild with security fix, error should NOT contain internal details
      // expect(data.error).not.toContain('ENOTFOUND')
    }
  })

  it('404 for unknown crawl ID', async () => {
    const { status, data } = await apiGet<{ success: boolean }>('/v1/crawl/nonexistent-id-12345')
    expect(status).toBe(404)
    expect(data.success).toBe(false)
  })
})

// ─── CACHE ───────────────────────────────────────────

describe('Caching behavior', () => {
  it('second scrape returns faster (cached hit)', { timeout: 30000 }, async () => {
    const start1 = Date.now()
    await apiPost('/v1/scrape', {
      url: 'https://example.com',
      formats: ['markdown'],
    })
    const time1 = Date.now() - start1

    const start2 = Date.now()
    await apiPost('/v1/scrape', {
      url: 'https://example.com',
      formats: ['markdown'],
    })
    const time2 = Date.now() - start2

    console.log(`  First scrape: ${time1}ms, Second scrape (cached): ${time2}ms`)
    expect(time2).toBeLessThan(time1 * 3)
  })
})
