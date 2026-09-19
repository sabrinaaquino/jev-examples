import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JevNliClient } from '../server/jev.ts'
import type { NliPair } from '../shared/types.ts'

const pair: NliPair = {
  id: 'test-1',
  split: 'test',
  premise: 'A person is playing a guitar.',
  hypothesis: 'Someone is playing an instrument.',
  truth: 'entailment',
  embeddingSimilarity: 0.89,
}

describe('JevNliClient', () => {
  it('maps a typed Choice answer and checks the human label', async () => {
    let inputTokens = 0
    const client = new JevNliClient({
      apiKey: 'test',
      onUsage: (usage) => {
        inputTokens = usage.inputTokens
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: 'jev-latest',
            answers: {
              pair_0: {
                type: 'choice',
                choice: 'entailment',
                probabilities: {
                  entailment: 0.96,
                  neutral: 0.03,
                  contradiction: 0.01,
                },
                confidence: 0.92,
              },
            },
            usage: { input_tokens: 80, output_tokens: 20 },
          }),
          { status: 200 },
        ),
    })

    const result = await client.classify([pair])
    assert.equal(result[0]?.label, 'entailment')
    assert.equal(result[0]?.correct, true)
    assert.equal(inputTokens, 80)
  })
})
