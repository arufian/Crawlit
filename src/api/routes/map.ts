import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createRequire } from 'node:module'
import { fetchHttp } from '../../core/fetcher/http-fetcher.js'
import { extractLinks } from '../../core/extractor/metadata-extractor.js'
import normalizeUrl from 'normalize-url'

const _require = createRequire(import.meta.url)
const Sitemapper = (_require('sitemapper') as { default: new(opts?: { timeout?: number }) => { fetch(url: string): Promise<{ sites: string[] }> } }).default

const MapBody = z.object({
  url: z.string().url(),
  limit: z.number().int().min(1).max(50000).default(5000),
  includeSubdomains: z.boolean().default(false),
  // Only return URLs containing this text (case-insensitive), e.g. "blog" or "/docs/"
  search: z.string().max(200).optional(),
  ignoreSitemap: z.boolean().default(false),
})

type MapBodyType = z.infer<typeof MapBody>

function normalize(url: string): string {
  try {
    return normalizeUrl(url, { removeTrailingSlash: true, sortQueryParameters: true })
  } catch {
    return url
  }
}

async function sitemapUrls(sitemapUrl: string, timeoutMs: number): Promise<string[]> {
  try {
    const { sites } = await new Sitemapper({ timeout: timeoutMs }).fetch(sitemapUrl)
    return sites
  } catch {
    return []
  }
}

async function discoverViaSitemap(baseUrl: string, timeoutMs: number): Promise<string[]> {
  const origin = new URL(baseUrl).origin

  // robots.txt may list sitemaps at non-standard paths; fetch it alongside the common locations
  const robotsSitemaps = fetchHttp(`${origin}/robots.txt`, 5000)
    .then(({ html, statusCode }) => statusCode < 400
      ? [...html.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => (m[1] ?? '').trim()).filter(Boolean)
      : [])
    .catch(() => [] as string[])

  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
  ]
  const fromCommon = candidates.map((c) => sitemapUrls(c, timeoutMs))
  const fromRobots = robotsSitemaps.then(async (list) => {
    const extra = [...new Set(list)].filter((u) => !candidates.includes(u)).slice(0, 10)
    return (await Promise.all(extra.map((u) => sitemapUrls(u, timeoutMs)))).flat()
  })

  const all = await Promise.all([...fromCommon, fromRobots])
  return [...new Set(all.flat())]
}

export async function mapRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Body: MapBodyType }>(
    '/v1/map',
    async (req, reply) => {
      const parsed = MapBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(422).send({ success: false, error: parsed.error.format() })
      }

      const { url, limit, includeSubdomains, search, ignoreSitemap } = parsed.data
      const parsedUrl = new URL(url)
      const seedHostname = parsedUrl.hostname

      // Sitemaps and the seed page's own links in parallel; seed links first so they rank on top
      const [sitemap, seed] = await Promise.all([
        ignoreSitemap ? Promise.resolve([] as string[]) : discoverViaSitemap(url, 10000),
        fetchHttp(url, 15000).then(({ html, url: finalUrl }) => [finalUrl, ...extractLinks(html, finalUrl)]).catch(() => null),
      ])

      if (seed === null && sitemap.length === 0) {
        return reply.status(500).send({ success: false, error: 'Failed to fetch page' })
      }
      const urls = [...(seed ?? []), ...sitemap]

      // Normalize + filter by domain
      const needle = search?.toLowerCase()
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
          if (needle && !normalized.toLowerCase().includes(needle)) continue
          filtered.push(normalized)
        } catch {
          // skip invalid
        }
      }

      return reply.send({ success: true, links: filtered, total: filtered.length })
    },
  )
}
