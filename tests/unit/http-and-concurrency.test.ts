import { describe, it, expect } from 'vitest'
import { decodeBody } from '../../src/core/fetcher/http-fetcher.js'
import { mapLimit, singleflight } from '../../src/lib/concurrency.js'

// "日本語" in Shift_JIS and EUC-JP
const SJIS = [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]
const EUCJP = [0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec]

const bytes = (prefix: string, body: number[], suffix = '') =>
  new Uint8Array([...Buffer.from(prefix, 'latin1'), ...body, ...Buffer.from(suffix, 'latin1')])

describe('decodeBody', () => {
  it('uses the Content-Type charset', () => {
    expect(decodeBody(bytes('<p>', SJIS, '</p>'), 'text/html; charset=Shift_JIS')).toBe('<p>日本語</p>')
    expect(decodeBody(bytes('<p>', EUCJP, '</p>'), 'text/html; charset=EUC-JP')).toBe('<p>日本語</p>')
  })

  it('sniffs <meta charset> when the header has none', () => {
    expect(decodeBody(bytes('<meta charset="shift_jis"><p>', SJIS), 'text/html')).toContain('日本語')
    expect(decodeBody(bytes('<meta http-equiv="Content-Type" content="text/html; charset=x-sjis"><p>', SJIS), '')).toContain('日本語')
  })

  it('defaults to UTF-8 and survives unknown labels', () => {
    expect(decodeBody(new Uint8Array(Buffer.from('<p>héllo 日本</p>')), 'text/html')).toBe('<p>héllo 日本</p>')
    expect(decodeBody(new Uint8Array(Buffer.from('<p>ok</p>')), 'text/html; charset=bogus-charset')).toBe('<p>ok</p>')
  })
})

describe('mapLimit', () => {
  it('preserves order and caps concurrency', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, n * 5))
      active--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })
})

describe('singleflight', () => {
  it('shares one in-flight call per key', async () => {
    const sf = singleflight<number>()
    let calls = 0
    const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return 42 }
    const results = await Promise.all([sf('a', fn), sf('a', fn), sf('b', fn)])
    expect(results).toEqual([42, 42, 42])
    expect(calls).toBe(2)
    // Key is released after completion
    await sf('a', fn)
    expect(calls).toBe(3)
  })
})
