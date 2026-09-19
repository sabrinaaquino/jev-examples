import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import 'dotenv/config'

import { loadCorpusItems } from '../server/corpus.ts'
import { JevClient } from '../server/jev.ts'
import type { JevUsage } from '../server/jev.ts'

const PRICE_PER_MILLION_INPUT_TOKENS_USD = 0.0525
const BASELINE_WALL_CLOCK_MS = 329_167
const INGEST_WALL_CLOCK_MS = 24_969

const numericArgument = (name: string, fallback: number) => {
  const prefix = `--${name}=`
  const argument = process.argv.find((value) => value.startsWith(prefix))
  return argument ? Number(argument.slice(prefix.length)) : fallback
}

const sampleCount = numericArgument('samples', 20)
const batchSize = numericArgument('batch', 48)
const corpus = await loadCorpusItems()

if (!corpus.length) throw new Error('Run `npm run ingest` first.')
if (!process.env.VENICE_API_KEY) {
  throw new Error('Set VENICE_API_KEY to measure representative Jev batches.')
}

const measurements: JevUsage[] = []
const client = new JevClient({
  onUsage: (usage) => measurements.push(usage),
})
const maxStart = Math.max(0, corpus.length - batchSize)

for (let sample = 0; sample < sampleCount; sample += 1) {
  const start = Math.floor((sample / Math.max(1, sampleCount - 1)) * maxStart)
  const batch = corpus.slice(start, start + batchSize)
  await client.classifyBaseline(batch)
  console.log(`Measured ${sample + 1}/${sampleCount} representative batches`)
}

const mean = (values: number[]) =>
  values.reduce((total, value) => total + value, 0) / values.length
const standardDeviation = (values: number[], average: number) =>
  Math.sqrt(
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
      Math.max(1, values.length - 1),
  )

const inputMeasurements = measurements.map((usage) => usage.inputTokens)
const outputMeasurements = measurements.map((usage) => usage.outputTokens)
const meanInputPerBatch = mean(inputMeasurements)
const meanOutputPerBatch = mean(outputMeasurements)
const estimatedBatchCount = corpus.length / batchSize
const estimatedInputTokens = Math.round(meanInputPerBatch * estimatedBatchCount)
const estimatedOutputTokens = Math.round(
  meanOutputPerBatch * estimatedBatchCount,
)
const inputStandardDeviation = standardDeviation(
  inputMeasurements,
  meanInputPerBatch,
)
const inputTokenMargin95 = Math.round(
  1.96 *
    (inputStandardDeviation / Math.sqrt(measurements.length)) *
    estimatedBatchCount,
)
const estimatedCostUsd =
  (estimatedInputTokens / 1_000_000) *
  PRICE_PER_MILLION_INPUT_TOKENS_USD
const costMargin95Usd =
  (inputTokenMargin95 / 1_000_000) *
  PRICE_PER_MILLION_INPUT_TOKENS_USD

const result = {
  generatedAt: new Date().toISOString(),
  corpusItems: corpus.length,
  baselineRequests: 501,
  baselineWallClockMs: BASELINE_WALL_CLOCK_MS,
  ingestWallClockMs: INGEST_WALL_CLOCK_MS,
  pricing: {
    inputPerMillionTokensUsd: PRICE_PER_MILLION_INPUT_TOKENS_USD,
    outputPerMillionTokensUsd: 0,
  },
  estimate: {
    sampledBatches: measurements.length,
    batchSize,
    meanInputTokensPerBatch: Math.round(meanInputPerBatch),
    meanOutputTokensPerBatch: Math.round(meanOutputPerBatch),
    inputTokens: estimatedInputTokens,
    inputTokensMargin95: inputTokenMargin95,
    outputTokens: estimatedOutputTokens,
    costUsd: Number(estimatedCostUsd.toFixed(4)),
    costMargin95Usd: Number(costMargin95Usd.toFixed(4)),
  },
  methodology:
    'Estimated from evenly spaced, production-shaped batches across the corpus. The supplied inference key cannot read the account billing ledger, so cost is not labeled exact.',
}

await writeFile(
  path.resolve(process.cwd(), 'data/run-metrics.json'),
  `${JSON.stringify(result, null, 2)}\n`,
)
console.log(JSON.stringify(result, null, 2))
