import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'

import type { CorpusPayload, NliPair } from '../shared/types.ts'

const DATA = path.resolve(process.cwd(), 'data')

const readJson = async <T>(name: string): Promise<T | undefined> => {
  const file = path.join(DATA, name)
  if (!existsSync(file)) return undefined
  return JSON.parse(await readFile(file, 'utf8')) as T
}

let cachedPairs: NliPair[] | undefined

export const loadPairs = async () => {
  if (cachedPairs) return cachedPairs
  const file = path.join(DATA, 'pairs.jsonl')
  const rows: NliPair[] = []
  const lines = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  for await (const line of lines) {
    if (line.trim()) rows.push(JSON.parse(line) as NliPair)
  }
  cachedPairs = rows
  return rows
}

export const loadCorpus = async (): Promise<CorpusPayload> => {
  const pairs = await loadPairs()
  const [meta, embedding, jev] = await Promise.all([
    readJson<{
      source: string
      license: string
      labels: CorpusPayload['meta']['labels']
    }>('corpus-meta.json'),
    readJson<{
      model: string
      elapsedMs: number
      estimatedCostUsd: number
      test: { accuracy: number }
      perLabel: NonNullable<
        CorpusPayload['meta']['embeddingBaseline']
      >['perLabel']
    }>('embedding-baseline.json'),
    readJson<{
      accuracy: number
      examples: number
      batchSize: number
    }>('jev-benchmark-500-batch-16.json'),
  ])

  if (!meta) throw new Error('Corpus metadata is missing')
  return {
    items: pairs,
    meta: {
      total: pairs.length,
      source: meta.source,
      license: meta.license,
      labels: meta.labels,
      embeddingModel: embedding?.model,
      embeddingBaseline: embedding && {
        accuracy: embedding.test.accuracy,
        elapsedMs: embedding.elapsedMs,
        costUsd: embedding.estimatedCostUsd,
        perLabel: embedding.perLabel,
      },
      jevBenchmark: jev && {
        accuracy: jev.accuracy,
        examples: jev.examples,
        batchSize: jev.batchSize,
      },
    },
  }
}
