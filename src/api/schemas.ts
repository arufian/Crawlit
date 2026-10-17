import { z } from 'zod'
import type { ScrapeOptions } from '../core/scrape-service.js'
import type { BrowserAction } from '../core/fetcher/browser-fetcher.js'

export const BrowserActionSchema = z.object({
  type: z.enum(['click', 'scroll', 'wait', 'type']),
  selector: z.string().optional(),
  text: z.string().optional(),
  delay: z.number().optional(),
})

export const ExtractSchema = z.object({
  schema: z.record(z.string(), z.unknown()).optional(),
  prompt: z.string().optional(),
  provider: z.enum(['openai', 'anthropic']).optional(),
  model: z.string().optional(),
})

export const FormatsSchema = z.array(z.enum(['markdown', 'html', 'links', 'rawHtml'])).default(['markdown'])

/** 'auto' = plain HTTP first, browser only when the page looks JS-rendered or bot-walled. */
export const ModeSchema = z.enum(['http', 'browser', 'auto']).default('auto')

/** Scrape options shared by /v1/scrape, /v1/batch/scrape and search scrapeOptions (everything except url). */
export const ScrapeOptionsSchema = z.object({
  formats: FormatsSchema,
  onlyMainContent: z.boolean().default(true),
  timeout: z.number().int().min(1000).max(60000).default(30000),
  skipCache: z.boolean().default(false),
  save: z.boolean().default(false),
  mode: ModeSchema,
  waitFor: z.number().int().min(0).max(15000).optional(),
  waitForSelector: z.string().max(500).optional(),
  actions: z.array(BrowserActionSchema).optional(),
  proxy: z.string().url().optional(),
  extract: ExtractSchema.optional(),
})

export type ScrapeOptionsInput = z.infer<typeof ScrapeOptionsSchema>

/** Drop undefined optionals so the result satisfies exactOptionalPropertyTypes. */
export function toScrapeOptions(url: string, o: ScrapeOptionsInput): ScrapeOptions {
  return {
    url,
    formats: o.formats,
    onlyMainContent: o.onlyMainContent,
    timeout: o.timeout,
    skipCache: o.skipCache,
    save: o.save,
    mode: o.mode,
    ...(o.waitFor !== undefined && { waitFor: o.waitFor }),
    ...(o.waitForSelector !== undefined && { waitForSelector: o.waitForSelector }),
    ...(o.actions !== undefined && { actions: o.actions as BrowserAction[] }),
    ...(o.proxy !== undefined && { proxy: o.proxy }),
    ...(o.extract !== undefined && {
      extract: {
        ...(o.extract.schema !== undefined && { schema: o.extract.schema }),
        ...(o.extract.prompt !== undefined && { prompt: o.extract.prompt }),
        ...(o.extract.provider !== undefined && { provider: o.extract.provider }),
        ...(o.extract.model !== undefined && { model: o.extract.model }),
      },
    }),
  }
}
