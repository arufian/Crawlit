import { createRequire } from 'node:module'
import type { Browser, BrowserContext } from 'playwright-core'
import { config } from '../../lib/config.js'
import { logger } from '../../lib/logger.js'
import { browserPoolActive } from '../../lib/metrics.js'

const _require = createRequire(import.meta.url)

// playwright-extra wraps playwright chromium with plugin support
const { chromium } = _require('playwright-extra') as {
  chromium: {
    use: (plugin: unknown) => void
    launch: (opts: Record<string, unknown>) => Promise<Browser>
  }
}

if (config.STEALTH_MODE) {
  const StealthPlugin = _require('puppeteer-extra-plugin-stealth')
  chromium.use(StealthPlugin())
  logger.info('Stealth mode enabled')
}

interface PooledContext {
  context: BrowserContext
  inUse: boolean
  useCount: number
  proxy?: string
}

const MAX_USES_PER_CONTEXT = 50

let browser: Browser | null = null
let launching: Promise<Browser> | null = null
const pool: PooledContext[] = []
// FIFO of callers waiting for a free slot; woken on every release
const waiters: Array<() => void> = []

const LAUNCH_ARGS = [
  // Required for Docker — Chrome sandbox needs SYS_ADMIN capability
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-renderer-backgrounding',
  '--mute-audio',
  // Stealth extras
  '--disable-blink-features=AutomationControlled',
]

// Google (and others in the EU) redirect to a consent page without this cookie
const CONSENT_COOKIES = [
  { name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.google.com', path: '/' },
  { name: 'CONSENT', value: 'YES+', domain: '.google.com', path: '/' },
]

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser
  // Concurrent first requests share one launch instead of starting several Chromiums
  launching ??= (async () => {
    const launchOpts: Record<string, unknown> = { headless: true, args: LAUNCH_ARGS }
    // Proxy at browser level (applies to all contexts unless overridden per-context)
    if (config.PROXY_URL) {
      launchOpts.proxy = { server: config.PROXY_URL }
    }
    const b = await chromium.launch(launchOpts)
    b.on('disconnected', () => {
      pool.length = 0
      browserPoolActive.set(0)
    })
    logger.info('Browser launched')
    return b
  })()
  try {
    browser = await launching
    return browser
  } finally {
    launching = null
  }
}

/** Launch Chromium ahead of the first browser request so it doesn't pay the ~1s startup cost. */
export async function prewarmBrowser(): Promise<void> {
  try {
    await getBrowser()
  } catch (err) {
    logger.warn({ err }, 'Browser prewarm failed')
  }
}

export interface AcquireOptions {
  proxy?: string  // per-request proxy override, e.g. 'http://user:pass@host:port'
}

async function createContext(proxy?: string): Promise<BrowserContext> {
  const b = await getBrowser()
  const contextOpts: Record<string, unknown> = {
    userAgent: config.HTTP_USER_AGENT,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // Stealth: real browser extra headers
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  }

  // Per-context proxy overrides launch-level proxy
  if (proxy) {
    contextOpts.proxy = { server: proxy }
  }

  const context = await b.newContext(contextOpts)
  await context.addCookies(CONSENT_COOKIES).catch(() => null)

  // Stealth: hide navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    // @ts-expect-error runtime patch
    window.chrome = { runtime: {} }
  })
  return context
}

function updateGauge() {
  browserPoolActive.set(pool.filter((p) => p.inUse).length)
}

export async function acquireContext(opts: AcquireOptions = {}): Promise<BrowserContext> {
  const proxyKey = opts.proxy ?? config.PROXY_URL ?? ''

  for (;;) {
    // Reuse a free context with same proxy config
    const available = pool.find(
      (p) => !p.inUse && p.useCount < MAX_USES_PER_CONTEXT && (p.proxy ?? '') === proxyKey,
    )
    if (available) {
      available.inUse = true
      updateGauge()
      return available.context
    }

    // Pool full of idle contexts for a different proxy — evict one instead of waiting forever
    if (pool.length >= config.BROWSER_POOL_SIZE) {
      const idle = pool.find((p) => !p.inUse)
      if (idle) {
        pool.splice(pool.indexOf(idle), 1)
        idle.context.close().catch(() => null)
      }
    }

    if (pool.length < config.BROWSER_POOL_SIZE) {
      // Reserve the slot before awaiting so concurrent callers can't overfill the pool
      const entry = { inUse: true, useCount: 0, ...(proxyKey && { proxy: proxyKey }) } as PooledContext
      pool.push(entry)
      try {
        entry.context = await createContext(opts.proxy)
      } catch (err) {
        pool.splice(pool.indexOf(entry), 1)
        waiters.shift()?.()
        throw err
      }
      updateGauge()
      return entry.context
    }

    await new Promise<void>((resolve) => waiters.push(resolve))
  }
}

export function releaseContext(context: BrowserContext): void {
  const entry = pool.find((p) => p.context === context)
  if (entry) {
    entry.useCount++
    entry.inUse = false

    if (entry.useCount >= MAX_USES_PER_CONTEXT) {
      pool.splice(pool.indexOf(entry), 1)
      entry.context.close().catch(() => null)
    }
  }
  updateGauge()
  waiters.shift()?.()
}

export async function closePool(): Promise<void> {
  await Promise.all(pool.map((p) => p.context?.close().catch(() => null)))
  pool.length = 0
  if (browser) {
    await browser.close().catch(() => null)
    browser = null
  }
  logger.info('Browser pool closed')
}
