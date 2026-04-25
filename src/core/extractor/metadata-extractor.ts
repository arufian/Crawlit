import { load } from 'cheerio'

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

export function extractMetadata(html: string, url: string, statusCode: number): PageMetadata {
  const $ = load(html)

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

export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = load(html)
  const links: string[] = []
  const base = new URL(baseUrl)

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    try {
      const resolved = new URL(href, base)
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        resolved.hash = ''
        links.push(resolved.toString())
      }
    } catch {
      // invalid URL, skip
    }
  })

  return [...new Set(links)]
}
