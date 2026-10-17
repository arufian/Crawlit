import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { load, type CheerioAPI } from 'cheerio'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})
// GFM tables, strikethrough, task lists — docs tables survive as markdown tables
turndown.use(gfm)

// Inline data: images are base64 blobs that bloat markdown without adding readable content
turndown.addRule('dropDataImages', {
  filter: (node) => node.nodeName === 'IMG' && (node.getAttribute('src') ?? '').startsWith('data:'),
  replacement: () => '',
})

// Remove noise elements before conversion
export const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'nav', 'header', 'footer', 'svg', 'iframe', 'template',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.ad', '.ads', '.advertisement', '.cookie-banner', '.popup',
]

/** Frameset pages have no <body>; list their frames as links so callers can follow them. */
function framesAsHtml($: CheerioAPI, baseUrl?: string): string {
  const items = $('frame[src]').map((_, el) => {
    const src = $(el).attr('src') ?? ''
    let href = src
    try {
      if (baseUrl) href = new URL(src, baseUrl).toString()
    } catch {
      // keep as-is
    }
    const name = $(el).attr('name') || $(el).attr('title') || src
    return `<li><a href="${href.replace(/"/g, '&quot;')}">${name}</a></li>`
  }).get()
  return items.length ? `<p>This page is a frameset. Frames:</p><ul>${items.join('')}</ul>` : ''
}

/** Converts a full page; mutates `$` when a parsed document is passed in. */
export function htmlToMarkdown(input: string | CheerioAPI, baseUrl?: string): string {
  const $ = typeof input === 'string' ? load(input) : input
  const frames = $('frameset').length ? framesAsHtml($, baseUrl) : ''
  $(NOISE_SELECTORS.join(',')).remove()
  const body = $('body').first()
  const inner = (body.length ? body.html() : $('noframes').html()) ?? ''
  return contentToMarkdown(frames + inner)
}

export function contentToMarkdown(cleanedHtml: string): string {
  if (!cleanedHtml.trim()) return ''
  // Turndown needs a fragment with a root element; a bare document without <body> crashes it
  return collapseBlankLines(turndown.turndown(`<div>${cleanedHtml}</div>`))
}

function collapseBlankLines(md: string): string {
  return md.replace(/\n{3,}/g, '\n\n').trim()
}
