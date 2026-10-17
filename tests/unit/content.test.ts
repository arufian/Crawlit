import { describe, it, expect } from 'vitest'
import { processHtml, needsBrowser } from '../../src/core/extractor/content.js'

const para = '<p>' + 'Crawlit turns web pages into clean markdown for language models. '.repeat(12) + '</p>'

const page = `<!doctype html><html lang="en"><head>
  <title>Docs Page</title>
  <meta name="description" content="A test page">
  <meta property="og:image" content="https://example.com/og.png">
  </head><body>
  <nav><a href="/nav-only">Nav</a></nav>
  <article>
    <h1>Getting started</h1>
    ${para}
    <p>See the <a href="/guide/install">install guide</a> and <img src="img/diagram.png" alt="diagram">.</p>
    <p><img src="data:image/png;base64,${'A'.repeat(500)}" alt="inline"></p>
    <table><thead><tr><th>Option</th><th>Default</th></tr></thead>
      <tbody><tr><td>mode</td><td>auto</td></tr></tbody></table>
    ${para}
  </article>
  <footer>Footer text</footer>
</body></html>`

describe('processHtml', () => {
  const result = processHtml({
    html: page,
    url: 'https://example.com/docs/start',
    statusCode: 200,
    formats: ['markdown', 'links', 'html'],
    onlyMainContent: true,
  })

  it('extracts metadata', () => {
    expect(result.metadata).toMatchObject({
      title: 'Docs Page',
      description: 'A test page',
      ogImage: 'https://example.com/og.png',
      sourceURL: 'https://example.com/docs/start',
      statusCode: 200,
      language: 'en',
    })
  })

  it('collects absolute links from the whole page, nav included', () => {
    expect(result.links).toEqual(expect.arrayContaining([
      'https://example.com/nav-only',
      'https://example.com/guide/install',
    ]))
  })

  it('produces main-content markdown with absolute links, GFM tables, no data: images', () => {
    const md = result.markdown!
    expect(md).toContain('# Getting started')
    expect(md).toContain('[install guide](https://example.com/guide/install)')
    expect(md).toContain('https://example.com/docs/img/diagram.png')
    expect(md).toMatch(/\| Option \| Default \|/)
    expect(md).toMatch(/\| mode \| auto \|/)
    expect(md).not.toContain('data:image')
    expect(md).not.toContain('Footer text')
    expect(md).not.toContain('Nav')
  })

  it('reports readable text length', () => {
    expect(result.textLength).toBeGreaterThan(500)
  })

  it('falls back to full-page markdown without onlyMainContent', () => {
    const full = processHtml({ html: page, url: 'https://example.com/', statusCode: 200, formats: ['markdown'], onlyMainContent: false })
    expect(full.markdown).toContain('Getting started')
    // Noise elements are still stripped
    expect(full.markdown).not.toContain('Footer text')
    expect(full.links).toBeUndefined()
  })
})

describe('frameset pages', () => {
  const frameset = '<html><head><title>阿部寛のホームページ</title></head><frameset cols="18,82"><frame src="menu.htm" name="left"><frame src="top.htm" name="right"><noframes><body>no frames</body></noframes></frameset></html>'

  it.each([true, false])('converts without crashing and lists frames as links (onlyMainContent=%s)', (onlyMainContent) => {
    const r = processHtml({ html: frameset, url: 'http://abehiroshi.la.coocan.jp/', statusCode: 200, formats: ['markdown'], onlyMainContent })
    expect(r.metadata.title).toBe('阿部寛のホームページ')
    expect(r.markdown).toContain('[left](http://abehiroshi.la.coocan.jp/menu.htm)')
    expect(r.markdown).toContain('[right](http://abehiroshi.la.coocan.jp/top.htm)')
  })
})

describe('needsBrowser', () => {
  it('escalates bot-wall status codes', () => {
    expect(needsBrowser('<html></html>', 403, 0)).toBe(true)
    expect(needsBrowser('<html></html>', 503, 0)).toBe(true)
  })

  it('does not escalate real 404s or text-rich pages', () => {
    expect(needsBrowser('<html></html>', 404, 0)).toBe(false)
    expect(needsBrowser(page, 200, 2000)).toBe(false)
  })

  it('escalates empty SPA shells', () => {
    expect(needsBrowser('<html><body><div id="root"></div><script src="/app.js"></script></body></html>', 200, 0)).toBe(true)
    expect(needsBrowser('<html><body><noscript>You need to enable JavaScript to run this app.</noscript></body></html>', 200, 40)).toBe(true)
    expect(needsBrowser('<script></script><script></script><script></script><p>hi</p>', 200, 2)).toBe(true)
  })
})
