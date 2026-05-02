import { createRequire } from 'module'
import type { Browser, BrowserContext } from 'playwright-core'
import { config } from '../../lib/config.js'
import { logger } from '../../lib/logger.js'

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
const pool: PooledContext[] = []

const LAUNCH_ARGS = [
  // Required for Docker — Chrome sandbox needs SYS_ADMIN capability
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  // Stealth extras
  '--disable-blink-features=AutomationControlled',
]

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    const launchOpts: Record<string, unknown> = { headless: true, args: LAUNCH_ARGS }
    // Proxy at browser level (applies to all contexts unless overridden per-context)
    if (config.PROXY_URL) {
      launchOpts.proxy = { server: config.PROXY_URL }
    }
    browser = await chromium.launch(launchOpts)
    logger.info('Browser launched')
  }
  return browser
}

export interface AcquireOptions {
  proxy?: string  // per-request proxy override, e.g. 'http://user:pass@host:port'
}

export async function acquireContext(opts: AcquireOptions = {}): Promise<BrowserContext> {
  const proxyKey = opts.proxy ?? config.PROXY_URL ?? ''

  // Reuse a free context with same proxy config
  const available = pool.find(
    (p) => !p.inUse && p.useCount < MAX_USES_PER_CONTEXT && (p.proxy ?? '') === proxyKey,
  )
  if (available) {
    available.inUse = true
    return available.context
  }

  if (pool.length < config.BROWSER_POOL_SIZE) {
    const b = await getBrowser()

    const contextOpts: Record<string, unknown> = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      // Stealth: real browser extra headers
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    }

    // Per-context proxy overrides launch-level proxy
    if (opts.proxy) {
      contextOpts.proxy = { server: opts.proxy }
    }

    const context = await b.newContext(contextOpts)

    // Stealth: hide navigator.webdriver
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
      // @ts-expect-error runtime patch
      window.chrome = { runtime: {} }
    })

    const entry: PooledContext = { context, inUse: true, useCount: 0, ...(proxyKey && { proxy: proxyKey }) }
    pool.push(entry)
    return context
  }

  await new Promise((r) => setTimeout(r, 500))
  return acquireContext(opts)
}

export function releaseContext(context: BrowserContext): void {
  const entry = pool.find((p) => p.context === context)
  if (!entry) return
  entry.useCount++
  entry.inUse = false

  if (entry.useCount >= MAX_USES_PER_CONTEXT) {
    pool.splice(pool.indexOf(entry), 1)
    entry.context.close().catch(() => null)
  }
}

export async function closePool(): Promise<void> {
  await Promise.all(pool.map((p) => p.context.close().catch(() => null)))
  pool.length = 0
  if (browser) {
    await browser.close().catch(() => null)
    browser = null
  }
  logger.info('Browser pool closed')
}
