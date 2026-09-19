import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'

import type {
  AtlasItem,
  CorpusPayload,
  HnItem,
} from '../shared/types.ts'

const DATA_DIRECTORY = path.resolve(process.cwd(), 'data')
const CORPUS_PATH = path.join(DATA_DIRECTORY, 'corpus.jsonl')
const CLASSIFICATIONS_PATH = path.join(
  DATA_DIRECTORY,
  'baseline-classifications.jsonl',
)
const RUN_METRICS_PATH = path.join(DATA_DIRECTORY, 'run-metrics.json')

const readJsonLines = async <T>(filePath: string): Promise<T[]> => {
  if (!existsSync(filePath)) return []
  const rows: T[] = []
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) rows.push(JSON.parse(trimmed) as T)
  }
  return rows
}

let cachedItems: HnItem[] | undefined
let cachedRunMetrics: CorpusPayload['meta']['run'] | undefined

export const loadCorpusItems = async () => {
  if (!cachedItems) cachedItems = await readJsonLines<HnItem>(CORPUS_PATH)
  return cachedItems
}

export const clearCorpusCache = () => {
  cachedItems = undefined
  cachedRunMetrics = undefined
}

const loadRunMetrics = async () => {
  if (cachedRunMetrics) return cachedRunMetrics
  if (!existsSync(RUN_METRICS_PATH)) return undefined
  const source = JSON.parse(await readFile(RUN_METRICS_PATH, 'utf8')) as {
    baselineRequests: number
    baselineWallClockMs: number
    ingestWallClockMs: number
    estimate: {
      inputTokens: number
      outputTokens: number
      costUsd: number
      costMargin95Usd: number
      sampledBatches: number
    }
  }
  cachedRunMetrics = {
    baselineRequests: source.baselineRequests,
    baselineWallClockMs: source.baselineWallClockMs,
    ingestWallClockMs: source.ingestWallClockMs,
    estimatedInputTokens: source.estimate.inputTokens,
    estimatedOutputTokens: source.estimate.outputTokens,
    estimatedCostUsd: source.estimate.costUsd,
    costMargin95Usd: source.estimate.costMargin95Usd,
    sampledBatches: source.estimate.sampledBatches,
  }
  return cachedRunMetrics
}

export const loadAtlas = async (): Promise<CorpusPayload> => {
  const [items, run] = await Promise.all([
    loadCorpusItems(),
    loadRunMetrics(),
  ])
  const atlasItems: AtlasItem[] = items.map((item) => ({
    ...item,
    category: 'unclassified',
    confidence: 0,
    probabilities: {},
  }))
  const years = atlasItems.map((item) => item.year)
  return {
    items: atlasItems,
    meta: {
      total: atlasItems.length,
      classified: 0,
      firstYear: years.length ? Math.min(...years) : 0,
      lastYear: years.length ? Math.max(...years) : 0,
      source: 'Hacker News via the Algolia HN Search API',
      run,
    },
  }
}

export const corpusPaths = {
  dataDirectory: DATA_DIRECTORY,
  corpus: CORPUS_PATH,
  classifications: CLASSIFICATIONS_PATH,
}
