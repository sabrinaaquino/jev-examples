import { readFile, writeFile } from 'node:fs/promises'

import 'dotenv/config'

import type { NliLabel, NliPair } from '../shared/types.ts'

const API_URL = 'https://api.venice.ai/api/v1/embeddings'
const MODEL = 'text-embedding-qwen3-0-6b'
const DIMENSIONS = 256
const PAIRS_PER_BATCH = 192
const CONCURRENCY = 6
const REQUEST_INTERVAL_MS = 150

if (!process.env.VENICE_API_KEY) {
  throw new Error('VENICE_API_KEY is required')
}

const pairs = (await readFile('data/pairs.jsonl', 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as NliPair)
const batches = Array.from(
  { length: Math.ceil(pairs.length / PAIRS_PER_BATCH) },
  (_, index) =>
    pairs.slice(
      index * PAIRS_PER_BATCH,
      (index + 1) * PAIRS_PER_BATCH,
    ),
)
let nextBatch = 0
let completed = 0
let nextStart = Date.now()
let startQueue = Promise.resolve()
let inputTokens = 0

const waitForStart = () => {
  const scheduled = startQueue.then(async () => {
    const wait = Math.max(0, nextStart - Date.now())
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    nextStart = Date.now() + REQUEST_INTERVAL_MS
  })
  startQueue = scheduled.catch(() => undefined)
  return scheduled
}

const decodeVector = (value: string) => {
  const bytes = Buffer.from(value, 'base64')
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  )
}

const cosine = (left: Float32Array, right: Float32Array) => {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  return dot / Math.max(Number.EPSILON, Math.sqrt(leftNorm * rightNorm))
}

const embed = async (batch: NliPair[]) => {
  const input = batch.flatMap((pair) => [pair.premise, pair.hypothesis])
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VENICE_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, br',
      },
      body: JSON.stringify({
        model: MODEL,
        input,
        dimensions: DIMENSIONS,
        encoding_format: 'base64',
      }),
    })
    if (response.ok) {
      const body = (await response.json()) as {
        data: Array<{ index: number; embedding: string }>
        usage: { prompt_tokens: number }
      }
      inputTokens += body.usage.prompt_tokens
      const vectors = body.data
        .sort((left, right) => left.index - right.index)
        .map((row) => decodeVector(row.embedding))
      batch.forEach((pair, index) => {
        pair.embeddingSimilarity = cosine(
          vectors[index * 2]!,
          vectors[index * 2 + 1]!,
        )
      })
      return
    }
    if (
      response.status !== 429 &&
      response.status !== 500 &&
      response.status !== 503
    ) {
      throw new Error(
        `Embedding request failed with ${response.status}: ${await response.text()}`,
      )
    }
    const retryAfter = Number(response.headers.get('retry-after'))
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1_000
          : 500 * 2 ** attempt,
      ),
    )
  }
  throw new Error('Embedding retries exhausted')
}

const startedAt = Date.now()
const worker = async () => {
  while (nextBatch < batches.length) {
    const batch = batches[nextBatch++]
    if (!batch) return
    await waitForStart()
    await embed(batch)
    completed += batch.length
    console.log(`Embedded ${completed.toLocaleString()}/${pairs.length.toLocaleString()} pairs`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

const validation = pairs.filter((pair) => pair.split === 'validation')
const test = pairs.filter((pair) => pair.split === 'test')
const classify = (similarity: number, lower: number, upper: number): NliLabel =>
  similarity < lower
    ? 'contradiction'
    : similarity < upper
      ? 'neutral'
      : 'entailment'

let best = { accuracy: 0, lower: 0, upper: 0 }
for (let lower = -0.2; lower <= 0.9; lower += 0.01) {
  for (let upper = lower + 0.01; upper <= 1; upper += 0.01) {
    const correct = validation.filter(
      (pair) =>
        classify(pair.embeddingSimilarity!, lower, upper) === pair.truth,
    ).length
    const accuracy = correct / validation.length
    if (accuracy > best.accuracy) best = { accuracy, lower, upper }
  }
}

const testCorrect = test.filter(
  (pair) =>
    classify(pair.embeddingSimilarity!, best.lower, best.upper) === pair.truth,
).length
const perLabel = (['entailment', 'neutral', 'contradiction'] as const).map(
  (label) => {
    const values = pairs
      .filter((pair) => pair.truth === label)
      .map((pair) => pair.embeddingSimilarity!)
      .sort((left, right) => left - right)
    return {
      label,
      mean:
        values.reduce((total, value) => total + value, 0) / values.length,
      p10: values[Math.floor(values.length * 0.1)],
      median: values[Math.floor(values.length * 0.5)],
      p90: values[Math.floor(values.length * 0.9)],
    }
  },
)

await writeFile(
  'data/pairs.jsonl',
  `${pairs.map((pair) => JSON.stringify(pair)).join('\n')}\n`,
)
await writeFile(
  'data/embedding-baseline.json',
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      model: MODEL,
      dimensions: DIMENSIONS,
      elapsedMs: Date.now() - startedAt,
      inputTokens,
      estimatedCostUsd: (inputTokens / 1_000_000) * 0.0125,
      validation: best,
      test: {
        accuracy: testCorrect / test.length,
        correct: testCorrect,
        total: test.length,
      },
      perLabel,
    },
    null,
    2,
  )}\n`,
)
console.log('Embedding baseline complete')
