import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

export interface ExtractedContent {
  title: string
  textContent: string
  excerpt: string
  byline: string | null
  content: string // cleaned HTML
}

// linkedom is ~3-4x faster than JSDOM for Readability with the same output
export function extractMainContent(html: string, url: string): ExtractedContent | null {
  const { document } = parseHTML(html)
  if (!document.documentElement) return null

  // linkedom has no document URL; a <base> lets Readability absolutize relative links/images
  if (!document.querySelector('base[href]') && document.head) {
    const base = document.createElement('base')
    base.setAttribute('href', url)
    document.head.prepend(base)
  }

  let article: ReturnType<Readability['parse']>
  try {
    article = new Readability(document as unknown as Document).parse()
  } catch {
    return null
  }
  if (!article) return null

  return {
    title: article.title ?? '',
    textContent: article.textContent ?? '',
    excerpt: article.excerpt ?? '',
    byline: article.byline ?? null,
    content: article.content ?? '',
  }
}
