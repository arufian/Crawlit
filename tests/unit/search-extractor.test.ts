import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseGoogle, decodeGoogleHref, isGoogleBlocked, parseDuckDuckGo,
} from '../../src/core/extractor/search-extractor.js'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', name), 'utf8')

describe('parseGoogle', () => {
  it('extracts organic results from a real SERP', () => {
    const { results, blocked } = parseGoogle(fixture('google-serp.html'))
    expect(blocked).toBe(false)
    expect(results.length).toBeGreaterThanOrEqual(8)
    for (const [i, r] of results.entries()) {
      expect(r.position).toBe(i + 1)
      expect(r.title.length).toBeGreaterThan(0)
      expect(r.snippet.length).toBeGreaterThan(20)
      expect(() => new URL(r.url)).not.toThrow()
    }
    expect(results[0]!.title).toBe('rate limiting with @fastify/rate-limit')
    // This SERP uses opaque /goto tokens that must be resolved via redirect
    expect(results.every((r) => r.needsResolve && r.url.startsWith('https://www.google.com/goto?url='))).toBe(true)
  })

  it('extracts results from the basic (no-JS) HTML layout with direct URLs', () => {
    const { results, blocked } = parseGoogle(fixture('google-basic.html'))
    expect(blocked).toBe(false)
    expect(results.length).toBeGreaterThanOrEqual(8)
    expect(results[0]).toMatchObject({
      title: 'fastify/fastify-rate-limit',
      url: 'https://github.com/fastify/fastify-rate-limit',
      snippet: expect.stringContaining('low overhead rate limiter'),
      position: 1,
    })
    // Classic /url?q= links decode directly — no redirect lookups, no Google URLs left
    expect(results.some((r) => r.needsResolve)).toBe(false)
    expect(results.every((r) => !new URL(r.url).hostname.includes('google.'))).toBe(true)
    // Sitelinks are not reported as separate results or mixed into the snippet
    expect(results.filter((r) => r.url.startsWith('https://github.com/fastify/fastify-rate-limit/'))).toHaveLength(0)
    expect(results[0]!.snippet).not.toContain('Releases')
  })

  it('reports CAPTCHA pages as blocked', () => {
    expect(parseGoogle('<html><body>ok</body></html>', 'https://www.google.com/sorry/index?continue=x').blocked).toBe(true)
    expect(isGoogleBlocked('<form id="captcha-form"></form>')).toBe(true)
    expect(isGoogleBlocked('<body>Our systems have detected unusual traffic from your computer network.</body>')).toBe(true)
    expect(isGoogleBlocked(fixture('google-serp.html'))).toBe(false)
  })
})

describe('decodeGoogleHref', () => {
  it('passes through direct external links', () => {
    expect(decodeGoogleHref('https://example.com/a?b=1')).toEqual({ url: 'https://example.com/a?b=1', needsResolve: false })
  })

  it('unwraps classic /url?q= redirects', () => {
    expect(decodeGoogleHref('/url?q=https://example.com/page&sa=U&ved=x')).toEqual({ url: 'https://example.com/page', needsResolve: false })
  })

  it('marks opaque /goto tokens for resolution', () => {
    expect(decodeGoogleHref('/goto?url=CAESabc')).toEqual({ url: 'https://www.google.com/goto?url=CAESabc', needsResolve: true })
  })

  it('ignores internal Google links and non-http schemes', () => {
    expect(decodeGoogleHref('/search?q=more')).toBeNull()
    expect(decodeGoogleHref('javascript:void(0)')).toBeNull()
    expect(decodeGoogleHref('')).toBeNull()
  })
})

describe('parseDuckDuckGo', () => {
  const html = `
    <div class="result results_links"><h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&rut=abc">Example Docs</a></h2>
      <a class="result__url" href="#">example.com/docs</a><a class="result__snippet">Read the docs.</a></div>
    <div class="result result--ad"><a class="result__a" href="https://ads.example">Ad</a></div>
    <div class="result"><a class="result__a" href="https://direct.example/x">Direct</a><a class="result__snippet">Snippet</a></div>`

  it('decodes redirect links and skips ads', () => {
    const { results, blocked } = parseDuckDuckGo(html)
    expect(blocked).toBe(false)
    expect(results).toEqual([
      { title: 'Example Docs', url: 'https://example.com/docs', snippet: 'Read the docs.', position: 1 },
      { title: 'Direct', url: 'https://direct.example/x', snippet: 'Snippet', position: 2 },
    ])
  })

  it('detects the anomaly page', () => {
    expect(parseDuckDuckGo('<div class="anomaly-modal">bots</div>').blocked).toBe(true)
  })
})
