import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'

export interface ExtractedContent {
  title: string
  textContent: string
  excerpt: string
  byline: string | null
  content: string // cleaned HTML
}

export function extractMainContent(html: string, url: string): ExtractedContent | null {
  const dom = new JSDOM(html, { url })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()
  if (!article) return null

  return {
    title: article.title ?? '',
    textContent: article.textContent ?? '',
    excerpt: article.excerpt ?? '',
    byline: article.byline ?? null,
    content: article.content ?? '',
  }
}
