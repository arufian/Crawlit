import { Agent, fetch } from 'undici'
import { config } from '../../lib/config.js'

export interface FetchResult {
  html: string
  statusCode: number
  headers: Record<string, string>
  url: string
  contentType?: string
}

// Shared keep-alive pool: repeat requests to the same host reuse TCP/TLS connections
const agent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 120_000,
  connections: 64,
})

const CHARSET_RE = /charset\s*=\s*["']?([\w:.-]+)/i
const META_CHARSET_RE = /<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i

function normalizeCharset(label: string | undefined): string | undefined {
  if (!label) return undefined
  const l = label.trim().toLowerCase()
  if (l === 'x-sjis' || l === 'sjis' || l === 'ms932' || l === 'windows-31j' || l === 'cp932') return 'shift_jis'
  return l
}

/**
 * Decode a body using the charset from the Content-Type header, then a <meta charset>
 * sniff of the first bytes, then UTF-8. Keeps Shift_JIS / EUC-JP / GBK pages readable.
 */
export function decodeBody(bytes: Uint8Array, contentType = ''): string {
  let charset = normalizeCharset(contentType.match(CHARSET_RE)?.[1])
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096))
    charset = normalizeCharset(head.match(META_CHARSET_RE)?.[1])
  }
  if (charset && charset !== 'utf-8' && charset !== 'utf8') {
    try {
      return new TextDecoder(charset).decode(bytes)
    } catch {
      // unknown label — fall through to UTF-8
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

// undici's ReadableStream type differs from Node's global one; only async iteration + cancel are used
type ByteStream = AsyncIterable<Uint8Array> & { cancel(): Promise<void> }

async function readCapped(body: ByteStream | null, max: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of body) {
    size += chunk.byteLength
    if (size > max) {
      await body.cancel().catch(() => null)
      throw new Error(`Response body exceeds ${max} bytes`)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function fetchHttp(url: string, timeoutMs = 30000, headers: Record<string, string> = {}): Promise<FetchResult> {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    dispatcher: agent,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': config.HTTP_USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'accept-encoding': 'gzip, deflate, br',
      ...headers,
    },
  })

  const contentType = res.headers.get('content-type') ?? ''
  const bytes = await readCapped(res.body, config.MAX_BODY_BYTES)
  const flatHeaders: Record<string, string> = {}
  res.headers.forEach((v, k) => { flatHeaders[k] = v })

  return {
    html: decodeBody(bytes, contentType),
    statusCode: res.status,
    headers: flatHeaders,
    url: res.url || url,
    contentType,
  }
}

/** Resolve a redirecting URL (e.g. Google's /goto tokens) to its Location without fetching the target. */
export async function resolveRedirect(url: string, timeoutMs = 5000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      dispatcher: agent,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': config.HTTP_USER_AGENT },
    })
    await res.body?.cancel().catch(() => null)
    const loc = res.headers.get('location')
    return loc ? new URL(loc, url).toString() : null
  } catch {
    return null
  }
}
