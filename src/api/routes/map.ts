import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createRequire } from 'module'
import { fetchHttp } from '../../core/fetcher/http-fetcher.js'
import { extractLinks } from '../../core/extractor/metadata-extractor.js'
import { authMiddleware } from '../middleware/auth.js'
import normalizeUrl from 'normalize-url'

const _require = createRequire(import.meta.url)
const Sitemapper = (_require('sitemapper') as { default: new(opts?: { timeout?: number }) => { fetch(url: string): Promise<{ sites: string[] }> } }).default

const MapBody = z.object({
  url: z.string().url(),
  limit: z.number().int().min(1).max(50000).default(5000),
  includeSubdomains: z.boolean().default(false),
})

type MapBodyType = z.infer<typeof MapBody>

function normalize(url: string): string {
  try {
    return normalizeUrl(url, { removeTrailingSlash: true, sortQueryParameters: true })
  } catch {
    return url
  }
}

async function discoverViaSitemap(baseUrl: string, timeoutMs: number): Promise<string[]> {
  const sitemapper = new Sitemapper({ timeout: timeoutMs })
  const origin = new URL(baseUrl).origin

  // Try common sitemap locations
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
  ]

  for (const candidate of candidates) {
    try {
      const { sites } = await sitemapper.fetch(candidate)
      if (sites.length > 0) return sites
    } catch {
      // try next
    }
  }

  // Check robots.txt for Sitemap: directive
  try {
    const { html } = await fetchHttp(`${origin}/robots.txt`, 5000)
    const match = html.match(/^Sitemap:\s*(.+)$/im)
    if (match?.[1]) {
      const { sites } = await sitemapper.fetch(match[1].trim())
      if (sites.length > 0) return sites
    }
  } catch {
    // ignore
  }

  return []
}

export async function mapRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: MapBodyType }>(
    '/v1/map',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const parsed = MapBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(422).send({ success: false, error: parsed.error.format() })
      }

      const { url, limit, includeSubdomains } = parsed.data
      const parsedUrl = new URL(url)
      const seedHostname = parsedUrl.hostname

      // Try sitemap first (fast, comprehensive)
      let urls = await discoverViaSitemap(url, 10000)

      // Fall back to link extraction from seed page
      if (urls.length === 0) {
        try {
          const { html } = await fetchHttp(url, 15000)
          urls = extractLinks(html, url)
        } catch {
          return reply.status(500).send({ success: false, error: 'Failed to fetch page' })
        }
      }

      // Normalize + filter by domain
      const seen = new Set<string>()
      const filtered: string[] = []

      for (const raw of urls) {
        if (filtered.length >= limit) break
        try {
          const u = new URL(raw)
          const hostMatch = includeSubdomains
            ? (u.hostname === seedHostname || u.hostname.endsWith(`.${seedHostname}`))
            : u.hostname === seedHostname

          if (!hostMatch) continue

          const normalized = normalize(raw)
          if (seen.has(normalized)) continue
          seen.add(normalized)
          filtered.push(normalized)
        } catch {
          // skip invalid
        }
      }

      return reply.send({ success: true, links: filtered, total: filtered.length })
    },
  )
}
