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

export async function fetchBrowser(
  url: string,
  options: {
    waitFor?: number
    actions?: BrowserAction[]
    timeoutMs?: number
    proxy?: string
  } = {},
): Promise<FetchResult> {
  const { waitFor = 0, actions = [], timeoutMs = 30000, proxy } = options
  const context = await acquireContext({ ...(proxy !== undefined && { proxy }) })
  const page = await context.newPage()

  try {
    // Block heavy resources for speed
    await page.route('**/*', (route) => {
      if (BLOCKED_RESOURCES.has(route.request().resourceType())) {
        route.abort().catch(() => null)
      } else {
        route.continue().catch(() => null)
      }
    })

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    })

    // Wait for network idle or explicit delay
    if (waitFor > 0) {
      await page.waitForTimeout(waitFor)
    } else {
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null)
    }

    await runActions(page, actions)

    const html = await page.content()
    const finalUrl = page.url()
    const statusCode = response?.status() ?? 200
    const headersRaw = response?.headers() ?? {}

    return { html, statusCode, headers: headersRaw, url: finalUrl }
  } finally {
    await page.close().catch(() => null)
    releaseContext(context)
  }
}
