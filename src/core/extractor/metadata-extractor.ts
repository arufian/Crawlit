import { load, type CheerioAPI } from 'cheerio'

export interface PageMetadata {
  title: string
  description: string
  ogTitle: string
  ogDescription: string
  ogImage: string
  sourceURL: string
  statusCode: number
  language: string
}

/** Accepts raw HTML or an already-parsed document, so callers can share one parse. */
function toCheerio(input: string | CheerioAPI): CheerioAPI {
  return typeof input === 'string' ? load(input) : input
}

export function extractMetadata(input: string | CheerioAPI, url: string, statusCode: number): PageMetadata {
  const $ = toCheerio(input)

  return {
    title: $('title').first().text().trim() || $('meta[property="og:title"]').attr('content') || '',
    description: $('meta[name="description"]').attr('content') || '',
    ogTitle: $('meta[property="og:title"]').attr('content') || '',
    ogDescription: $('meta[property="og:description"]').attr('content') || '',
    ogImage: $('meta[property="og:image"]').attr('content') || '',
    sourceURL: url,
    statusCode,
    language: $('html').attr('lang') || '',
  }
}

export function extractLinks(input: string | CheerioAPI, baseUrl: string): string[] {
  const $ = toCheerio(input)
  const links = new Set<string>()
  const base = new URL($('base[href]').attr('href') ?? baseUrl, baseUrl)

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    try {
      const resolved = new URL(href, base)
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        resolved.hash = ''
        links.add(resolved.toString())
      }
    } catch {
      // invalid URL, skip
    }
  })

  return [...links]
}
