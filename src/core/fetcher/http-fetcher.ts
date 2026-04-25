import { request } from 'undici'

const DEFAULT_UA = 'Mozilla/5.0 (compatible; Crawlit/1.0; +https://github.com/your-org/crawlit)'

export interface FetchResult {
  html: string
  statusCode: number
  headers: Record<string, string>
  url: string
}

export async function fetchHttp(url: string, timeoutMs = 30000): Promise<FetchResult> {
  const { statusCode, headers, body } = await request(url, {
    method: 'GET',
    headers: {
      'user-agent': DEFAULT_UA,
      accept: 'text/html,application/xhtml+xml,*/*',
      'accept-language': 'en-US,en;q=0.9',
    },
    bodyTimeout: timeoutMs,
    headersTimeout: timeoutMs,
  })

  const html = await body.text()
  const flatHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v) flatHeaders[k] = Array.isArray(v) ? v.join(', ') : v
  }

  return { html, statusCode, headers: flatHeaders, url }
}
