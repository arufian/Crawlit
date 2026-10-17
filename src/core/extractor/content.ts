import { load } from 'cheerio'
import { extractMetadata, extractLinks, type PageMetadata } from './metadata-extractor.js'
import { extractMainContent } from './readability-extractor.js'
import { htmlToMarkdown, contentToMarkdown } from '../transformer/html-to-markdown.js'

export type OutputFormat = 'markdown' | 'html' | 'links' | 'rawHtml'

export interface ProcessInput {
  html: string
  url: string
  statusCode: number
  formats: OutputFormat[]
  onlyMainContent: boolean
}

export interface ProcessedPage {
  metadata: PageMetadata
  markdown?: string
  html?: string
  links?: string[]
  rawHtml?: string
  /** Length of readable text found; used to decide whether a page needs a browser render. */
  textLength: number
}

/**
 * HTML → metadata/links/markdown with a single cheerio parse (previously one per extractor).
 * Pure and synchronous so it can run in a worker thread.
 */
export function processHtml(input: ProcessInput): ProcessedPage {
  const { html, url, statusCode, formats, onlyMainContent } = input
  const $ = load(html)
  const metadata = extractMetadata($, url, statusCode)
  const result: ProcessedPage = { metadata, textLength: 0 }

  if (formats.includes('rawHtml')) result.rawHtml = html
  // Links come from the full page (nav included) before noise removal mutates the tree
  if (formats.includes('links')) result.links = extractLinks($, url)

  const wantsHtml = formats.includes('html')
  const wantsMarkdown = formats.includes('markdown')
  const extracted = onlyMainContent && (wantsHtml || wantsMarkdown) ? extractMainContent(html, url) : null

  if (extracted) {
    result.textLength = extracted.textContent.trim().length
    if (wantsHtml) result.html = extracted.content
    if (wantsMarkdown) result.markdown = contentToMarkdown(extracted.content)
  } else {
    if (wantsHtml) result.html = html
    if (wantsMarkdown) result.markdown = htmlToMarkdown($, url)
    result.textLength = wantsMarkdown ? (result.markdown ?? '').length : $('body').text().trim().length
  }

  return result
}

const JS_SHELL_MARKERS = [
  /<div[^>]+id=["'](root|app|__next|__nuxt|svelte)["'][^>]*>\s*<\/div>/i,
  /enable javascript|javascript is (required|disabled)|you need to enable javascript/i,
  /<noscript>[^<]{0,200}(enable|requires?) javascript/i,
]

/**
 * Heuristic for `mode: "auto"`: should an HTTP fetch be retried in the browser?
 * True for bot-wall status codes and for pages that are mostly an empty JS app shell.
 */
export function needsBrowser(html: string, statusCode: number, textLength: number): boolean {
  if (statusCode === 403 || statusCode === 429 || statusCode === 503) return true
  if (statusCode >= 400) return false
  if (textLength >= 500) return false
  if (JS_SHELL_MARKERS.some((re) => re.test(html))) return true
  // Lots of script, almost no text → client-rendered
  const scriptCount = (html.match(/<script\b/gi) ?? []).length
  return textLength < 200 && scriptCount >= 3
}
