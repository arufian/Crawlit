import { processHtml, type ProcessInput } from './content.js'

// Piscina worker entry: one task = one page
export default function run(input: ProcessInput) {
  return processHtml(input)
}
