import { Piscina } from 'piscina'
import { config } from '../../lib/config.js'
import { logger } from '../../lib/logger.js'
import { processHtml, type ProcessInput, type ProcessedPage } from './content.js'

// Below this size, structured-clone overhead to a worker outweighs the parse cost
const INLINE_MAX_BYTES = 64 * 1024

let pool: Piscina | null = null
let disabled = config.EXTRACT_WORKERS === 0

function getPool(): Piscina {
  if (!pool) {
    // tsx dev runs .ts sources; the Docker build runs compiled .js
    const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js'
    pool = new Piscina({
      filename: new URL(`./content-worker${ext}`, import.meta.url).href,
      minThreads: 1,
      maxThreads: config.EXTRACT_WORKERS,
      idleTimeout: 60_000,
    })
  }
  return pool
}

/** processHtml off the main thread for large pages, so the API stays responsive under load. */
export async function processHtmlAsync(input: ProcessInput): Promise<ProcessedPage> {
  if (disabled || input.html.length < INLINE_MAX_BYTES) return processHtml(input)
  try {
    return (await getPool().run(input)) as ProcessedPage
  } catch (err) {
    // If inline also throws, the page itself is bad — surface that and keep the pool
    const result = processHtml(input)
    // Inline worked, so the worker is broken (e.g. missing TS loader in dev): stop using it
    logger.warn({ err }, 'Extraction worker failed; processing inline from now on')
    disabled = true
    return result
  }
}

export async function closeContentPool(): Promise<void> {
  await pool?.destroy()
  pool = null
}
