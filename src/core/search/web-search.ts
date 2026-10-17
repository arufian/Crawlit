import { createHash } from 'node:crypto'
import { fetchHttp, resolveRedirect } from '../fetcher/http-fetcher.js'
import { withPage } from '../fetcher/browser-fetcher.js'
import { parseGoogle, parseDuckDuckGo, type SearchResult } from '../extractor/search-extractor.js'
import { cacheGet, cacheSet } from '../../lib/cache.js'
import { mapLimit } from '../../lib/concurrency.js'
import { config } from '../../lib/config.js'
import { logger } from '../../lib/logger.js'

export type SearchEngine = 'google' | 'duckduckgo'

export interface SearchOptions {
  query: string
  limit: number
  engine?: SearchEngine
  /** UI / result language, e.g. "en", "ja" (Google hl). */
  lang?: string
  /** Country to search from, e.g. "us", "jp" (Google gl). */
  country?: string
  /** Google time filter, e.g. "qdr:d" (day), "qdr:w", "qdr:m", "qdr:y". */
  tbs?: string
  timeout?: number
  skipCache?: boolean
}

export interface SearchResponse {
  results: SearchResult[]
  engine: SearchEngine
  /** Engines that were tried before `engine` and why they were skipped. */
  fallbackFrom?: { engine: SearchEngine; reason: string }[]
  /** Every engine tried was blocked (CAPTCHA / anomaly page). */
  blocked?: boolean
  cached?: boolean
}

export class SearchBlockedError extends Error {}

const GOOGLE_PAGE_SIZE = 10
const GOOGLE_READY_SELECTOR = '#rso, #search, #botstuff, #captcha-form, form[action*="/sorry/"], #recaptcha'
// Google still serves its lightweight no-JS results page to Opera Mini: plain HTTP, ~0.5s, real /url?q= links
const GOOGLE_BASIC_UA = 'Opera/9.80 (J2ME/MIDP; Opera Mini/9.80 (S60; SymbOS; Opera Mobi/23.348; U; en) Presto/2.5.25 Version/10.54'

type Strategy = 'google-http' | 'google-browser' | 'duckduckgo'

// After a CAPTCHA, skip that strategy for a while: retrying immediately is slow and prolongs the block
const BLOCK_COOLDOWN_MS = 10 * 60 * 1000
const blockedUntil = new Map<Strategy, number>()

function isCoolingDown(s: Strategy): boolean {
  return (blockedUntil.get(s) ?? 0) > Date.now()
}

function markBlocked(s: Strategy): void {
  blockedUntil.set(s, Date.now() + BLOCK_COOLDOWN_MS)
  logger.warn({ strategy: s, minutes: BLOCK_COOLDOWN_MS / 60000 }, 'Search strategy blocked; cooling down')
}

/** Per-strategy availability, for /health. */
export function searchStatus(): Record<Strategy, string> {
  const status = (s: Strategy) => (isCoolingDown(s) ? `blocked until ${new Date(blockedUntil.get(s) ?? 0).toISOString()}` : 'ok')
  return { 'google-http': status('google-http'), 'google-browser': status('google-browser'), duckduckgo: status('duckduckgo') }
}

function googleUrl(opts: SearchOptions, start: number): string {
  const params = new URLSearchParams({ q: opts.query, hl: opts.lang ?? 'en', pws: '0' })
  if (opts.country) params.set('gl', opts.country)
  if (opts.tbs) params.set('tbs', opts.tbs)
  if (start > 0) params.set('start', String(start))
  return `https://www.google.com/search?${params}`
}

async function googleHttpPage(opts: SearchOptions, start: number) {
  const { html, url, statusCode } = await fetchHttp(googleUrl(opts, start), opts.timeout ?? 15000, {
    'user-agent': GOOGLE_BASIC_UA,
    'accept-language': `${opts.lang ?? 'en'};q=0.9`,
    // Skip the EU consent interstitial
    cookie: 'CONSENT=YES+; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
  })
  // Google throttles scrapers with a bare 403/429 rather than a CAPTCHA on this path
  if (statusCode === 403 || statusCode === 429) return { results: [], blocked: true }
  return parseGoogle(html, url)
}

async function googleBrowserPage(opts: SearchOptions, start: number) {
  return withPage(async (page) => {
    await page.goto(googleUrl(opts, start), { waitUntil: 'domcontentloaded', timeout: opts.timeout ?? 20000 })
    // Results are server-rendered once the JS shell boots; don't wait for network idle
    await page.waitForSelector(GOOGLE_READY_SELECTOR, { timeout: 8000 }).catch(() => null)
    return parseGoogle(await page.content(), page.url())
  })
}

async function searchGoogle(opts: SearchOptions): Promise<SearchResult[]> {
  const pages = Math.min(5, Math.ceil(opts.limit / GOOGLE_PAGE_SIZE))
  const starts = Array.from({ length: pages }, (_, i) => i * GOOGLE_PAGE_SIZE)

  let strategies: Strategy[] = (['google-http', 'google-browser'] as const).filter((s) => !isCoolingDown(s))
  // Everything cooling down: the HTTP path is cheap enough to probe anyway
  if (strategies.length === 0) strategies = ['google-http']

  let parsed: Awaited<ReturnType<typeof googleHttpPage>>[] | null = null
  for (const s of strategies) {
    const fetchPage = s === 'google-http' ? googleHttpPage : googleBrowserPage
    const attempt = await mapLimit(starts, s === 'google-http' ? 5 : 2, (start) => fetchPage(opts, start))
    if (attempt.every((p) => p.blocked)) {
      markBlocked(s)
      continue
    }
    blockedUntil.delete(s)
    if (attempt.some((p) => p.results.length > 0)) {
      parsed = attempt
      break
    }
    parsed ??= attempt
  }
  if (!parsed) throw new SearchBlockedError('Google returned a CAPTCHA page')

  const seen = new Set<string>()
  const merged = parsed.flatMap((p) => p.results).filter((r) => !seen.has(r.url) && seen.add(r.url)).slice(0, opts.limit)

  // Newer SERPs link through opaque /goto tokens; one redirect lookup each reveals the real URL
  const resolved = await mapLimit(merged, 10, async (r) => {
    if (!r.needsResolve) return r
    const target = await resolveRedirect(r.url)
    const { needsResolve: _drop, ...rest } = r
    return { ...rest, url: target ?? r.url }
  })
  return resolved.map((r, i) => ({ title: r.title, url: r.url, snippet: r.snippet, position: i + 1 }))
}

async function searchDuckDuckGo(opts: SearchOptions): Promise<SearchResult[]> {
  if (isCoolingDown('duckduckgo')) throw new SearchBlockedError('DuckDuckGo is cooling down after a bot check')
  const params = new URLSearchParams({ q: opts.query })
  if (opts.country || opts.lang) params.set('kl', `${opts.country ?? 'wt'}-${opts.lang ?? 'wt'}`)
  if (opts.tbs?.startsWith('qdr:')) params.set('df', opts.tbs.slice(4, 5))
  const { html } = await fetchHttp(`https://html.duckduckgo.com/html/?${params}`, opts.timeout ?? 15000)
  const { results, blocked } = parseDuckDuckGo(html)
  if (blocked) {
    markBlocked('duckduckgo')
    throw new SearchBlockedError('DuckDuckGo returned an anomaly (bot check) page')
  }
  return results.slice(0, opts.limit)
}

const ENGINES: Record<SearchEngine, (opts: SearchOptions) => Promise<SearchResult[]>> = {
  google: searchGoogle,
  duckduckgo: searchDuckDuckGo,
}

function searchCacheKey(engine: SearchEngine, opts: SearchOptions): string {
  const raw = JSON.stringify([engine, opts.query, opts.limit, opts.lang, opts.country, opts.tbs])
  return `crawlit:search:${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`
}

export async function webSearch(opts: SearchOptions): Promise<SearchResponse> {
  const primary = opts.engine ?? config.SEARCH_ENGINE
  const chain: SearchEngine[] = config.SEARCH_FALLBACK
    ? [primary, ...(Object.keys(ENGINES) as SearchEngine[]).filter((e) => e !== primary)]
    : [primary]

  const fallbackFrom: { engine: SearchEngine; reason: string }[] = []
  let allBlocked = true

  // Any engine's cached answer beats a fresh network attempt (e.g. a fallback result while Google is blocked)
  if (!opts.skipCache) {
    const cachedAll = await Promise.all(chain.map((engine) => cacheGet<SearchResult[]>(searchCacheKey(engine, opts))))
    for (const [i, cached] of cachedAll.entries()) {
      const engine = chain[i]
      if (engine && cached && cached.length > 0) return { results: cached, engine, cached: true }
    }
  }

  for (const engine of chain) {
    const key = searchCacheKey(engine, opts)
    try {
      const results = await ENGINES[engine](opts)
      if (results.length === 0) {
        allBlocked = false
        fallbackFrom.push({ engine, reason: 'no results' })
        continue
      }
      if (config.SEARCH_CACHE_TTL_SECONDS > 0) await cacheSet(key, results, config.SEARCH_CACHE_TTL_SECONDS)
      return { results, engine, ...(fallbackFrom.length && { fallbackFrom }) }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (!(err instanceof SearchBlockedError)) allBlocked = false
      logger.warn({ engine, query: opts.query, reason }, 'Search engine failed')
      fallbackFrom.push({ engine, reason })
    }
  }

  const last = fallbackFrom.at(-1)?.engine ?? primary
  return {
    results: [],
    engine: last,
    fallbackFrom,
    ...(allBlocked && { blocked: true }),
  }
}
