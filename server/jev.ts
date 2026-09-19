import { z } from 'zod'

import type {
  LiveDecision,
  NliLabel,
  NliPair,
} from '../shared/types.ts'

const API_URL = 'https://api.venice.ai/api/v1/decisions'
const MODEL = 'jev-latest'
const MAX_ATTEMPTS = 6

const LABELS = new Set<NliLabel>([
  'entailment',
  'neutral',
  'contradiction',
])

const CRITERIA: Record<NliLabel, string> = {
  entailment:
    'The hypothesis must be true if the premise is true, without adding unsupported facts.',
  contradiction:
    'The hypothesis must be false if the premise is true; both statements cannot be true together.',
  neutral:
    'The premise does not determine whether the hypothesis is true or false.',
}

const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
})

const answerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
})

export interface JevUsage {
  inputTokens: number
  outputTokens: number
}

interface Options {
  apiKey?: string
  fetchImpl?: typeof fetch
  onUsage?: (usage: JevUsage) => void
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

export class JevNliClient {
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly onUsage?: (usage: JevUsage) => void

  constructor(options: Options = {}) {
    const apiKey = options.apiKey ?? process.env.VENICE_API_KEY
    if (!apiKey) throw new Error('VENICE_API_KEY is required')
    this.apiKey = apiKey
    this.fetchImpl = options.fetchImpl ?? fetch
    this.onUsage = options.onUsage
  }

  async classify(
    pairs: NliPair[],
    signal?: AbortSignal,
  ): Promise<LiveDecision[]> {
    const state = {
      pairs: pairs.map(({ premise, hypothesis }) => ({
        premise,
        hypothesis,
      })),
    }
    const questions = Object.fromEntries(
      pairs.map((_, index) => [
        `pair_${index}`,
        {
          type: 'choice',
          instructions: `Given only pairs[${index}].premise, determine the logical relation of pairs[${index}].hypothesis.`,
          criteria: CRITERIA,
        },
      ]),
    )

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: Response
      try {
        const timeout = AbortSignal.timeout(45_000)
        response = await this.fetchImpl(API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: MODEL, state, questions }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        })
      } catch (error) {
        if (signal?.aborted || attempt === MAX_ATTEMPTS - 1) throw error
        await sleep(400 * 2 ** attempt)
        continue
      }

      if (response.ok) {
        const result = responseSchema.parse(await response.json())
        this.onUsage?.({
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
        })
        return pairs.map((pair, index) => {
          const answer = answerSchema.parse(
            result.answers[`pair_${index}`],
          )
          const label = LABELS.has(answer.choice as NliLabel)
            ? (answer.choice as NliLabel)
            : 'neutral'
          return {
            id: pair.id,
            label,
            confidence: answer.confidence,
            probabilities: {
              entailment: answer.probabilities.entailment ?? 0,
              neutral: answer.probabilities.neutral ?? 0,
              contradiction: answer.probabilities.contradiction ?? 0,
            },
            correct: label === pair.truth,
          }
        })
      }

      const message = await response.text()
      const retryable = response.status === 429 || response.status === 503
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        throw new Error(`Jev returned ${response.status}: ${message}`)
      }
      const retryAfter = Number(response.headers.get('retry-after'))
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1_000
          : 400 * 2 ** attempt,
      )
    }
    throw new Error('Jev retry loop ended unexpectedly')
  }
}
