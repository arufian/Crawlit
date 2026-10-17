import { fetchHttp, type FetchResult } from './fetcher/http-fetcher.js'
import { fetchBrowser, type BrowserAction } from './fetcher/browser-fetcher.js'
import { needsBrowser, type OutputFormat, type ProcessedPage } from './extractor/content.js'
import { processHtmlAsync } from './extractor/content-pool.js'
import type { PageMetadata } from './extractor/metadata-extractor.js'
import { extractWithLLM, type LLMExtractOptions } from './extractor/llm-extractor.js'
import { saveMarkdownFile } from './transformer/save-markdown.js'
import { cacheKey, cacheGet, cacheSet } from '../lib/cache.js'
import { singleflight } from '../lib/concurrency.js'
import { scrapeTotal, scrapeDuration, cacheHits } from '../lib/metrics.js'
import { logger } from '../lib/logger.js'

export type FetchMode = 'http' | 'browser' | 'auto'

export interface ScrapeOptions {
  url: string
  formats: OutputFormat[]
  onlyMainContent: boolean
  timeout: number
  skipCache: boolean
  save: boolean
  mode: FetchMode
  waitFor?: number
  waitForSelector?: string
  actions?: BrowserAction[]
  proxy?: string
  extract?: LLMExtractOptions
}

export interface ScrapeData {
  metadata: PageMetadata
  markdown?: string
  html?: string
  links?: string[]
  rawHtml?: string
  extract?: unknown
  extractError?: string
  savedTo?: string
}

export interface ScrapeOutcome {
  data: ScrapeData
  /** Which fetcher produced the content: 'cache' when served from Redis. */
  source: 'http' | 'browser' | 'cache'
}

export class ScrapeFetchError extends Error {}

const PLAIN_TEXT_RE = /^(text\/plain|text\/markdown|text\/x-markdown|application\/json|application\/(ld\+)?json|text\/csv)/i

const dedupe = singleflight<ScrapeOutcome>()

function plainTextPage(fetched: FetchResult, formats: OutputFormat[]): ProcessedPage {
  const metadata: PageMetadata = {
    title: '', description: '', ogTitle: '', ogDescription: '', ogImage: '',
    sourceURL: fetched.url, statusCode: fetched.statusCode, language: '',
  }
  const page: ProcessedPage = { metadata, textLength: fetched.html.length }
  // Raw text / JSON / markdown files are already readable — don't run them through HTML conversion
  if (formats.includes('markdown')) page.markdown = fetched.html
  if (formats.includes('html')) page.html = fetched.html
  if (formats.includes('rawHtml')) page.rawHtml = fetched.html
  if (formats.includes('links')) page.links = []
  return page
}

async function toPage(fetched: FetchResult, opts: ScrapeOptions): Promise<ProcessedPage> {
  if (fetched.contentType && PLAIN_TEXT_RE.test(fetched.contentType)) return plainTextPage(fetched, opts.formats)
  return processHtmlAsync({
    html: fetched.html,
    url: fetched.url,
    statusCode: fetched.statusCode,
    formats: opts.formats,
    onlyMainContent: opts.onlyMainContent,
  })
}

function browserFetch(opts: ScrapeOptions): Promise<FetchResult> {
  return fetchBrowser(opts.url, {
    ...(opts.waitFor !== undefined && { waitFor: opts.waitFor }),
    ...(opts.waitForSelector !== undefined && { waitForSelector: opts.waitForSelector }),
    ...(opts.actions !== undefined && { actions: opts.actions }),
    ...(opts.proxy !== undefined && { proxy: opts.proxy }),
    timeoutMs: opts.timeout,
  })
}

async function fetchAndProcess(opts: ScrapeOptions): Promise<{ page: ProcessedPage; source: 'http' | 'browser' }> {
  // Browser-only options imply a browser render even in auto mode
  const forceBrowser = opts.mode === 'browser'
    || (opts.mode === 'auto' && (opts.actions?.length || opts.waitForSelector || opts.waitFor))

  if (forceBrowser) {
    return { page: await toPage(await browserFetch(opts), opts), source: 'browser' }
  }

  let httpPage: ProcessedPage | null = null
  let httpError: unknown = null
  let html = ''
  try {
    const fetched = await fetchHttp(opts.url, opts.timeout)
    html = fetched.html
    httpPage = await toPage(fetched, opts)
  } catch (err) {
    httpError = err
  }

  if (opts.mode === 'http') {
    if (!httpPage) throw httpError
    return { page: httpPage, source: 'http' }
  }

  // auto: escalate to the browser when HTTP failed or looks like a JS shell / bot wall
  if (httpPage && !needsBrowser(html, httpPage.metadata.statusCode, httpPage.textLength)) {
    return { page: httpPage, source: 'http' }
  }
  try {
    const page = await toPage(await browserFetch(opts), opts)
    // Keep the HTTP result if the browser didn't actually do better
    if (httpPage && page.textLength < httpPage.textLength) return { page: httpPage, source: 'http' }
    return { page, source: 'browser' }
  } catch (err) {
    if (httpPage) return { page: httpPage, source: 'http' }
    throw httpError ?? err
  }
}

function keyFor(opts: ScrapeOptions): string {
  return cacheKey(opts.url, {
    formats: opts.formats,
    onlyMainContent: opts.onlyMainContent,
    // An explicit browser request must not be answered by a cached plain-HTTP result
    ...(opts.mode === 'browser' && { mode: 'browser' }),
    ...(opts.actions?.length && { actions: opts.actions }),
    ...(opts.waitForSelector && { waitForSelector: opts.waitForSelector }),
    ...(opts.extract && { extract: opts.extract }),
  })
}

async function scrapeUncached(opts: ScrapeOptions, key: string): Promise<ScrapeOutcome> {
  let page: ProcessedPage
  let source: 'http' | 'browser'
  try {
    ({ page, source } = await fetchAndProcess(opts))
  } catch (err) {
    // undici reports every network error as "fetch failed"; the cause says which (ENOTFOUND, timeout, …)
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null
    const detail = cause ? ((cause as NodeJS.ErrnoException).code ?? cause.message) : ''
    const msg = (err instanceof Error ? err.message : String(err)) + (detail ? `: ${detail}` : '')
    logger.warn({ err: msg, url: opts.url }, 'Scrape fetch failed')
    throw new ScrapeFetchError(msg)
  }

  const { textLength: _textLength, ...data } = page as ProcessedPage & ScrapeData

  // LLM extraction (runs after content is ready)
  if (opts.extract && typeof data.markdown === 'string') {
    try {
      data.extract = await extractWithLLM(data.markdown, opts.extract)
    } catch (err) {
      data.extractError = err instanceof Error ? err.message : 'LLM extraction failed'
    }
  }

  // Don't pin error pages (404/5xx/bot walls) in the cache
  if (data.metadata.statusCode < 400) await cacheSet(key, data)

  return { data, source }
}

export async function scrapePage(opts: ScrapeOptions): Promise<ScrapeOutcome> {
  const timer = scrapeDuration.startTimer({ mode: opts.mode })
  const key = keyFor(opts)

  try {
    let outcome: ScrapeOutcome | null = null
    if (!opts.skipCache) {
      const cached = await cacheGet<ScrapeData>(key)
      if (cached) {
        cacheHits.inc()
        outcome = { data: cached, source: 'cache' }
      }
    }
    // Identical concurrent requests share one fetch
    outcome ??= await dedupe(`${key}:${opts.skipCache}`, () => scrapeUncached(opts, key))

    const data = { ...outcome.data }
    if (opts.save && typeof data.markdown === 'string') {
      data.savedTo = await saveMarkdownFile(data.markdown, data.metadata)
    }
    scrapeTotal.inc({ mode: opts.mode, status: outcome.source === 'cache' ? 'cached' : 'success' })
    return { data, source: outcome.source }
  } catch (err) {
    scrapeTotal.inc({ mode: opts.mode, status: 'error' })
    throw err
  } finally {
    timer()
  }
}
