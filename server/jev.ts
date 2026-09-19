import { z } from 'zod'

import { BASE_CATEGORIES, CATEGORY_BY_ID } from '../shared/categories.ts'
import type { Classification, HnItem } from '../shared/types.ts'

const VENICE_API_URL = 'https://api.venice.ai/api/v1/decisions'
const MODEL = 'jev-latest'
const MAX_ATTEMPTS = 6

const choiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
})

const noulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1),
})

const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
})

type JevResponse = z.infer<typeof responseSchema>

export interface JevUsage {
  inputTokens: number
  outputTokens: number
}

interface JevClientOptions {
  apiKey?: string
  fetchImpl?: typeof fetch
  onUsage?: (usage: JevUsage) => void
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const retryDelay = (response: Response, attempt: number) => {
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1_000
  }
  return Math.min(8_000, 400 * 2 ** attempt) + Math.random() * 250
}

const compactItem = (item: HnItem) => ({
  type: item.kind,
  title: item.title,
  ...(item.text === item.title ? {} : { text: item.text.slice(0, 1_200) }),
  year: item.year,
})

export class JevClient {
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly onUsage?: (usage: JevUsage) => void

  constructor(options: JevClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.VENICE_API_KEY
    if (!apiKey) {
      throw new Error('VENICE_API_KEY is required for Jev classification')
    }
    this.apiKey = apiKey
    this.fetchImpl = options.fetchImpl ?? fetch
    this.onUsage = options.onUsage
  }

  private async request(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JevResponse> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: Response
      try {
        const timeoutSignal = AbortSignal.timeout(45_000)
        const requestSignal = signal
          ? AbortSignal.any([signal, timeoutSignal])
          : timeoutSignal
        response = await this.fetchImpl(VENICE_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: requestSignal,
        })
      } catch (error) {
        if (signal?.aborted || attempt === MAX_ATTEMPTS - 1) throw error
        await sleep(400 * 2 ** attempt)
        continue
      }

      if (response.ok) {
        const parsed = responseSchema.parse(await response.json())
        this.onUsage?.({
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
        })
        return parsed
      }

      const message = await response.text()
      const retryable = response.status === 429 || response.status === 503
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        throw new Error(`Jev returned ${response.status}: ${message}`)
      }
      await sleep(retryDelay(response, attempt))
    }
    throw new Error('Jev retry loop ended unexpectedly')
  }

  async classifyBaseline(
    items: HnItem[],
    signal?: AbortSignal,
  ): Promise<Classification[]> {
    const state = { items: items.map(compactItem) }
    const criteria = Object.fromEntries(
      BASE_CATEGORIES.map(({ id, description }) => [id, description]),
    )
    const questions = Object.fromEntries(
      items.map((_, index) => [
        `item_${index}`,
        {
          type: 'choice',
          instructions: `Choose the primary rhetorical role of items[${index}].`,
          criteria,
        },
      ]),
    )
    const response = await this.request(
      { model: MODEL, state, questions },
      signal,
    )
    const classifiedAt = new Date().toISOString()

    return items.map((item, index) => {
      const answer = choiceAnswerSchema.parse(
        response.answers[`item_${index}`],
      )
      return {
        id: item.id,
        category: CATEGORY_BY_ID.has(answer.choice) ? answer.choice : 'other',
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        model: response.model,
        classifiedAt,
      }
    })
  }

  async scoreCustomCategory(
    items: HnItem[],
    category: string,
    signal?: AbortSignal,
  ): Promise<Array<{ id: string; probability: number }>> {
    const normalizedCategory = category.trim().replace(/\s+/g, ' ').slice(0, 120)
    if (!normalizedCategory) throw new Error('A category is required')

    const state = { items: items.map(compactItem) }
    const questions = Object.fromEntries(
      items.map((_, index) => [
        `item_${index}`,
        {
          type: 'noul',
          instructions: {
            task: 'Decide whether the target item primarily expresses or exemplifies the requested category.',
            target: `items[${index}]`,
            category: normalizedCategory,
            guidance:
              'Judge meaning and rhetorical role, not only keyword overlap.',
          },
          criteria: {
            true: `The item is a strong example of "${normalizedCategory}".`,
            false: `The item is not meaningfully an example of "${normalizedCategory}".`,
          },
        },
      ]),
    )
    const response = await this.request(
      { model: MODEL, state, questions },
      signal,
    )

    return items.map((item, index) => {
      const answer = noulAnswerSchema.parse(
        response.answers[`item_${index}`],
      )
      return { id: item.id, probability: answer.noul }
    })
  }
}
