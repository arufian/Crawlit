import { load } from 'cheerio'

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export function extractSearchResults(html: string): SearchResult[] {
  const $ = load(html)
  const results: SearchResult[] = []

  $('.result').each((_, el) => {
    const $el = $(el)
    const title = $el.find('.result__title, .result__a').first().text().trim()
    const url = $el.find('.result__url').first().text().trim()
      || $el.find('.result__a').first().attr('href')?.trim()
      || ''
    const snippet = $el.find('.result__snippet').first().text().trim()

    if (title && (url || snippet)) {
      // Clean DuckDuckGo redirect URLs
      let cleanUrl = url
      if (cleanUrl.startsWith('//')) cleanUrl = `https:${cleanUrl}`
      if (cleanUrl.startsWith('http://duckduckgo.com/l/')) {
        const match = cleanUrl.match(/uddg=(.+?)(?:&|$)/)
        if (match?.[1]) {
          try {
            cleanUrl = decodeURIComponent(match[1])
          } catch {
            // keep original
          }
        }
      }

      results.push({ title, url: cleanUrl, snippet })
    }
  })

  return results
}
