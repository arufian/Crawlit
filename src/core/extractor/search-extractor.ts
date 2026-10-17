import { load } from 'cheerio'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  position?: number
}

export interface ParsedSerp {
  results: SearchResult[]
  /** The engine served a CAPTCHA / anomaly page instead of results. */
  blocked: boolean
}

// ─── DuckDuckGo (html.duckduckgo.com) ─────────────────────

function decodeDdgUrl(href: string): string {
  let url = href.trim()
  if (url.startsWith('//')) url = `https:${url}`
  // Redirect links look like //duckduckgo.com/l/?uddg=<encoded target>&rut=...
  if (/duckduckgo\.com\/l\//.test(url)) {
    const match = url.match(/[?&]uddg=([^&]+)/)
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1])
      } catch {
        // keep original
      }
    }
  }
  return url
}

export function parseDuckDuckGo(html: string): ParsedSerp {
  const $ = load(html)
  const results: SearchResult[] = []
  const blocked = $('.anomaly-modal, #challenge-form').length > 0

  $('.result').each((_, el) => {
    const $el = $(el)
    // Sponsored results
    if ($el.hasClass('result--ad')) return
    const title = $el.find('.result__title, .result__a').first().text().trim()
    const href = $el.find('.result__a').first().attr('href') ?? ''
    let url = href ? decodeDdgUrl(href) : ''
    if (!/^https?:\/\//.test(url)) {
      // Fall back to the display URL, which has no scheme
      const display = $el.find('.result__url').first().text().trim()
      url = display ? `https://${display.replace(/^https?:\/\//, '')}` : ''
    }
    const snippet = $el.find('.result__snippet').first().text().trim()

    if (title && url) results.push({ title, url, snippet, position: results.length + 1 })
  })

  return { results, blocked }
}

/** @deprecated kept for callers of the old API; use parseDuckDuckGo */
export function extractSearchResults(html: string): SearchResult[] {
  return parseDuckDuckGo(html).results
}

// ─── Google ───────────────────────────────────────────────

export interface GoogleResult extends SearchResult {
  /** Google's opaque /goto token link — resolve with a redirect lookup to get the real URL. */
  needsResolve?: boolean
}

const GOOGLE_HOST_RE = /(^|\.)google\.[a-z.]+$/i

/** Turn a Google result href into a target URL (or a Google redirect URL that must be resolved). */
export function decodeGoogleHref(href: string): { url: string; needsResolve: boolean } | null {
  if (!href) return null
  let u: URL
  try {
    u = new URL(href, 'https://www.google.com')
  } catch {
    return null
  }

  if (!GOOGLE_HOST_RE.test(u.hostname)) {
    return /^https?:$/.test(u.protocol) ? { url: u.toString(), needsResolve: false } : null
  }

  // Classic /url?q=<target> or /url?url=<target>
  if (u.pathname === '/url' || u.pathname === '/goto') {
    const target = u.searchParams.get('q') ?? u.searchParams.get('url') ?? ''
    if (/^https?:\/\//.test(target)) return { url: target, needsResolve: false }
    // Newer /goto?url=<opaque token> — only a redirect lookup reveals the target
    if (target) return { url: `https://www.google.com/goto?url=${encodeURIComponent(target)}`, needsResolve: true }
  }
  return null
}

export function isGoogleBlocked(html: string, finalUrl = ''): boolean {
  if (finalUrl.includes('/sorry/')) return true
  const $ = load(html)
  if ($('#captcha-form, form[action*="/sorry/"], #recaptcha, iframe[src*="recaptcha"]').length > 0) return true
  return /unusual traffic from your computer network/i.test($('body').text())
}

const SNIPPET_SELECTORS = [
  'div.VwiC3b',
  '[data-sncf="1"]',
  'div[style*="-webkit-line-clamp"]',
  'span.aCOpRe',
  'div.IsZvec',
  // Basic (no-JS) HTML layout: first block under the title is the snippet, later ones are sitelinks
  '.InXCmc',
].join(', ')

export function parseGoogle(html: string, finalUrl = ''): { results: GoogleResult[]; blocked: boolean } {
  if (isGoogleBlocked(html, finalUrl)) return { results: [], blocked: true }

  const $ = load(html)
  const root = $('#rso').length ? $('#rso') : $('#search').length ? $('#search') : $('body')
  const results: GoogleResult[] = []
  const seen = new Set<string>()

  root.find('a:has(h3)').each((_, a) => {
    const $a = $(a)
    // Skip "People also ask", carousels and other non-organic blocks
    if ($a.closest('.related-question-pair, g-accordion-expander, g-scrolling-carousel, [data-initq], .ULSxyf g-section-with-header').length) return

    const title = $a.find('h3').first().text().trim()
    const decoded = decodeGoogleHref($a.attr('href') ?? '')
    if (!title || !decoded || seen.has(decoded.url)) return
    seen.add(decoded.url)

    const container = $a.closest('div.MjjYud, div.g, div.Gx5Zad, div[data-hveid]').first()
    let snippet = container.find(SNIPPET_SELECTORS).first().text().trim()
    if (!snippet) {
      // Last resort: the longest text block in the result that isn't the title or URL line
      container.find('div, span').each((_, el) => {
        const $el = $(el)
        if ($el.find('h3, cite').length) return
        const t = $el.text().trim()
        if (t.length > snippet.length && t !== title) snippet = t
      })
    }

    results.push({
      title,
      url: decoded.url,
      snippet: snippet.replace(/\s+/g, ' '),
      position: results.length + 1,
      ...(decoded.needsResolve && { needsResolve: true }),
    })
  })

  return { results, blocked: false }
}
