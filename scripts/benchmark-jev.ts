import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import 'dotenv/config'

import { JevNliClient } from '../server/jev.ts'
import type { JevUsage } from '../server/jev.ts'
import type { NliLabel, NliPair } from '../shared/types.ts'

const argument = (name: string, fallback: number) => {
  const prefix = `--${name}=`
  const value = process.argv.find((entry) => entry.startsWith(prefix))
  return value ? Number(value.slice(prefix.length)) : fallback
}

const limit = argument('limit', 500)
const batchSize = argument('batch', 48)
const allPairs = (await readFile('data/pairs.jsonl', 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as NliPair)
  .filter((pair) => pair.split === 'test')

const hash = (value: string) => {
  let result = 2166136261
  for (const character of value) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

const pairs = [...allPairs]
  .sort((left, right) => hash(left.id) - hash(right.id))
  .slice(0, limit)
const usage: JevUsage[] = []
const client = new JevNliClient({
  onUsage: (entry) => usage.push(entry),
})
const confusion: Record<NliLabel, Record<NliLabel, number>> = {
  entailment: { entailment: 0, neutral: 0, contradiction: 0 },
  neutral: { entailment: 0, neutral: 0, contradiction: 0 },
  contradiction: { entailment: 0, neutral: 0, contradiction: 0 },
}
let correct = 0
const startedAt = Date.now()

for (let start = 0; start < pairs.length; start += batchSize) {
  const batch = pairs.slice(start, start + batchSize)
  const decisions = await client.classify(batch)
  decisions.forEach((decision, index) => {
    const truth = batch[index]!.truth
    confusion[truth][decision.label] += 1
    if (decision.correct) correct += 1
  })
  console.log(
    `Benchmarked ${Math.min(start + batch.length, pairs.length)}/${pairs.length}`,
  )
}

const inputTokens = usage.reduce(
  (total, entry) => total + entry.inputTokens,
  0,
)
const outputTokens = usage.reduce(
  (total, entry) => total + entry.outputTokens,
  0,
)
const result = {
  generatedAt: new Date().toISOString(),
  examples: pairs.length,
  batchSize,
  requests: usage.length,
  elapsedMs: Date.now() - startedAt,
  accuracy: correct / pairs.length,
  correct,
  inputTokens,
  outputTokens,
  estimatedCostUsd: (inputTokens / 1_000_000) * 0.0525,
  confusion,
}

await writeFile(
  path.resolve(
    process.cwd(),
    `data/jev-benchmark-${pairs.length}-batch-${batchSize}.json`,
  ),
  `${JSON.stringify(result, null, 2)}\n`,
)
console.log(JSON.stringify(result, null, 2))
