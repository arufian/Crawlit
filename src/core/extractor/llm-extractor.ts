import { generateObject, generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { config } from '../../lib/config.js'

export interface LLMExtractOptions {
  schema?: Record<string, unknown>
  prompt?: string
  provider?: 'openai' | 'anthropic'
  model?: string
}

function buildModel(provider: string, model: string) {
  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: config.ANTHROPIC_API_KEY })
      return anthropic(model)
    }
    default: {
      const openai = createOpenAI({ apiKey: config.OPENAI_API_KEY })
      return openai(model)
    }
  }
}

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const props = schema.properties as Record<string, { type: string; description?: string }> | undefined
  if (!props) return z.object({}).passthrough()

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, def] of Object.entries(props)) {
    let field: z.ZodTypeAny
    switch (def.type) {
      case 'number': field = z.number(); break
      case 'boolean': field = z.boolean(); break
      case 'array': field = z.array(z.unknown()); break
      default: field = z.string()
    }
    if (def.description) field = field.describe(def.description)
    // All fields optional unless required array includes it
    const required = (schema.required as string[] | undefined) ?? []
    shape[key] = required.includes(key) ? field : field.optional()
  }

  return z.object(shape)
}

export async function extractWithLLM(
  markdown: string,
  options: LLMExtractOptions,
): Promise<unknown> {
  const provider = options.provider ?? config.LLM_PROVIDER
  const model = options.model ?? config.LLM_MODEL

  const llmModel = buildModel(provider, model)

  // Schema-guided extraction → structured JSON
  if (options.schema) {
    const zodSchema = jsonSchemaToZod(options.schema)
    const systemPrompt = 'You are a precise data extractor. Extract information from the provided markdown content according to the schema. Only return data that is explicitly present in the content.'
    const userPrompt = options.prompt
      ? `${options.prompt}\n\nContent:\n${markdown}`
      : `Extract structured data from this content:\n\n${markdown}`

    const { object } = await generateObject({
      model: llmModel,
      schema: zodSchema as z.ZodObject<Record<string, z.ZodTypeAny>>,
      system: systemPrompt,
      prompt: userPrompt,
    })
    return object
  }

  // Prompt-only → free text
  const { text } = await generateText({
    model: llmModel,
    prompt: options.prompt
      ? `${options.prompt}\n\nContent:\n${markdown}`
      : markdown,
  })
  return { text }
}
