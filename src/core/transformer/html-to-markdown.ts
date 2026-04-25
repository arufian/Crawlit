import TurndownService from 'turndown'
import { load } from 'cheerio'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

// Remove noise elements before conversion
const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.ad', '.ads', '.advertisement', '.cookie-banner', '.popup',
]

export function htmlToMarkdown(html: string): string {
  const $ = load(html)
  NOISE_SELECTORS.forEach((sel) => $(sel).remove())
  const cleaned = $.html() ?? html
  return turndown.turndown(cleaned).trim()
}

export function contentToMarkdown(cleanedHtml: string): string {
  return turndown.turndown(cleanedHtml).trim()
}
