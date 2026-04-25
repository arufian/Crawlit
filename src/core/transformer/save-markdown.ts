import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { config } from '../../lib/config.js'
import type { PageMetadata } from '../extractor/metadata-extractor.js'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function urlToFilePath(url: string): string {
  const parsed = new URL(url)
  const host = parsed.hostname.replace(/^www\./, '')
  const pathParts = parsed.pathname.split('/').filter(Boolean)
  const filename = pathParts.length > 0
    ? slugify(pathParts.join('-')) + '.md'
    : 'index.md'
  return join(host, filename)
}

function buildFrontmatter(metadata: PageMetadata): string {
  const lines = [
    '---',
    `title: "${metadata.title.replace(/"/g, '\\"')}"`,
    `url: "${metadata.sourceURL}"`,
    `scraped_at: "${new Date().toISOString()}"`,
  ]
  if (metadata.description) lines.push(`description: "${metadata.description.replace(/"/g, '\\"')}"`)
  if (metadata.language) lines.push(`language: "${metadata.language}"`)
  lines.push('---', '')
  return lines.join('\n')
}

export async function saveMarkdownFile(
  markdown: string,
  metadata: PageMetadata,
  outputDir = config.OUTPUT_DIR,
): Promise<string> {
  const relPath = urlToFilePath(metadata.sourceURL)
  const absPath = join(outputDir, relPath)
  const dir = absPath.substring(0, absPath.lastIndexOf('/'))

  await mkdir(dir, { recursive: true })

  const content = buildFrontmatter(metadata) + markdown
  await writeFile(absPath, content, 'utf-8')

  return relPath
}
