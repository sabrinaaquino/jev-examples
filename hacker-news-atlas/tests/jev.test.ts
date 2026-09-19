import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JevClient } from '../server/jev.ts'
import type { HnItem } from '../shared/types.ts'

const item: HnItem = {
  id: '42',
  kind: 'comment',
  title: 'A sample discussion',
  text: 'This is a useful explanation of why the system behaves that way.',
  author: 'pg',
  timestamp: 1_700_000_000,
  year: 2023,
  url: 'https://news.ycombinator.com/item?id=42',
}

const response = (answers: Record<string, unknown>) =>
  new Response(
    JSON.stringify({
      model: 'jev-latest',
      answers,
      usage: { input_tokens: 100, output_tokens: 20 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )

describe('JevClient', () => {
  it('maps Choice answers to baseline classifications', async () => {
    let inputTokens = 0
    const client = new JevClient({
      apiKey: 'test',
      onUsage: (usage) => {
        inputTokens = usage.inputTokens
      },
      fetchImpl: async () =>
        response({
          item_0: {
            type: 'choice',
            choice: 'explanation',
            probabilities: { explanation: 0.92, other: 0.08 },
            confidence: 0.84,
          },
        }),
    })
    const result = await client.classifyBaseline([item])
    assert.equal(result[0]?.category, 'explanation')
    assert.equal(result[0]?.confidence, 0.84)
    assert.equal(inputTokens, 100)
  })

  it('falls back to other for unknown Choice values', async () => {
    const client = new JevClient({
      apiKey: 'test',
      fetchImpl: async () =>
        response({
          item_0: {
            type: 'choice',
            choice: 'future-category',
            probabilities: { 'future-category': 1 },
            confidence: 1,
          },
        }),
    })
    assert.equal((await client.classifyBaseline([item]))[0]?.category, 'other')
  })

  it('maps Noul answers to custom-category probabilities', async () => {
    const client = new JevClient({
      apiKey: 'test',
      fetchImpl: async () =>
        response({ item_0: { type: 'noul', noul: 0.73 } }),
    })
    assert.deepEqual(await client.scoreCustomCategory([item], 'AI anxiety'), [
      { id: '42', probability: 0.73 },
    ])
  })
})
