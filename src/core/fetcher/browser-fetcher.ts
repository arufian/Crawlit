import type { Page } from 'playwright-core'
import { acquireContext, releaseContext } from './browser-pool.js'
import type { FetchResult } from './http-fetcher.js'

export interface BrowserAction {
  type: 'click' | 'scroll' | 'wait' | 'type'
  selector?: string
  text?: string
  /** ms for 'wait' type */
  delay?: number
}

const BLOCKED_RESOURCES = new Set(['image', 'font', 'media', 'stylesheet'])

// Analytics / ad hosts keep the network busy and delay 'networkidle' without adding content
const BLOCKED_HOSTS = /(^|\.)(google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|adservice\.google\.com|facebook\.net|connect\.facebook\.net|hotjar\.com|segment\.(io|com)|mixpanel\.com|clarity\.ms|newrelic\.com|nr-data\.net|sentry\.io|intercom\.io|optimizely\.com|criteo\.(com|net)|taboola\.com|outbrain\.com|scorecardresearch\.com|amazon-adsystem\.com)$/i

/** Max time to wait for network idle after DOMContentLoaded when no explicit waitFor is given. */
const IDLE_WAIT_MS = 3000

async function runActions(page: Page, actions: BrowserAction[]): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case 'click':
        if (action.selector) await page.click(action.selector, { timeout: 5000 }).catch(() => null)
        break
      case 'scroll':
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        break
      case 'type':
        if (action.selector && action.text) {
          await page.fill(action.selector, action.text, { timeout: 5000 }).catch(() => null)
        }
        break
      case 'wait':
        await page.waitForTimeout(action.delay ?? 1000)
        break
    }
  }
}

function isBlocked(url: string, resourceType: string): boolean {
  if (BLOCKED_RESOURCES.has(resourceType)) return true
  try {
    return BLOCKED_HOSTS.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Run `fn` with a fresh page from the pool; heavy resources and trackers are blocked. */
export async function withPage<T>(fn: (page: Page) => Promise<T>, proxy?: string): Promise<T> {
  const context = await acquireContext({ ...(proxy !== undefined && { proxy }) })
  const page = await context.newPage()
  try {
    await page.route('**/*', (route) => {
      const req = route.request()
      if (isBlocked(req.url(), req.resourceType())) {
        route.abort().catch(() => null)
      } else {
        route.continue().catch(() => null)
      }
    })
    return await fn(page)
  } finally {
    await page.close().catch(() => null)
    releaseContext(context)
  }
}

export async function fetchBrowser(
  url: string,
  options: {
    waitFor?: number
    waitForSelector?: string
    actions?: BrowserAction[]
    timeoutMs?: number
    proxy?: string
  } = {},
): Promise<FetchResult> {
  const { waitFor = 0, waitForSelector, actions = [], timeoutMs = 30000, proxy } = options

  return withPage(async (page) => {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    })

    // Wait for a selector, an explicit delay, or (by default) a short network-idle window
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: Math.min(timeoutMs, 15000) }).catch(() => null)
    }
    if (waitFor > 0) {
      await page.waitForTimeout(waitFor)
    } else if (!waitForSelector) {
      await page.waitForLoadState('networkidle', { timeout: IDLE_WAIT_MS }).catch(() => null)
    }

    await runActions(page, actions)

    const html = await page.content()
    const finalUrl = page.url()
    const statusCode = response?.status() ?? 200
    const headersRaw = response?.headers() ?? {}

    return { html, statusCode, headers: headersRaw, url: finalUrl, contentType: headersRaw['content-type'] ?? 'text/html' }
  }, proxy)
}
