import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'

import 'dotenv/config'

import { corpusPaths, loadCorpusItems } from '../server/corpus.ts'
import { JevClient } from '../server/jev.ts'
import type { Classification } from '../shared/types.ts'

const CONCURRENCY = 8
const REQUEST_START_INTERVAL_MS = 210

const numberArgument = (name: string, fallback?: number) => {
  const prefix = `--${name}=`
  const value = process.argv.find((entry) => entry.startsWith(prefix))
  return value ? Number(value.slice(prefix.length)) : fallback
}

const batchSize = numberArgument('batch', 48)!
const limit = numberArgument('limit')

const readCompletedIds = async () => {
  try {
    const file = await readFile(corpusPaths.classifications, 'utf8')
    return new Set(
      file
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as Classification).id),
    )
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined
    if (code === 'ENOENT') return new Set<string>()
    throw error
  }
}

const createStartGate = () => {
  let nextStart = Date.now()
  let queue = Promise.resolve()
  return () => {
    const scheduled = queue.then(async () => {
      const wait = Math.max(0, nextStart - Date.now())
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      nextStart = Date.now() + REQUEST_START_INTERVAL_MS
    })
    queue = scheduled.catch(() => undefined)
    return scheduled
  }
}

const main = async () => {
  if (!process.env.VENICE_API_KEY) {
    throw new Error('Set VENICE_API_KEY before running baseline classification')
  }
  await mkdir(corpusPaths.dataDirectory, { recursive: true })
  const corpus = await loadCorpusItems()
  if (!corpus.length) throw new Error('Corpus is empty. Run `npm run ingest` first.')

  const completedIds = await readCompletedIds()
  const remaining = corpus.filter((item) => !completedIds.has(item.id))
  const selected = limit ? remaining.slice(0, limit) : remaining
  if (!selected.length) {
    console.log('All corpus items already have baseline classifications.')
    return
  }
  if (!completedIds.size) await writeFile(corpusPaths.classifications, '')

  const batches = Array.from(
    { length: Math.ceil(selected.length / batchSize) },
    (_, index) => selected.slice(index * batchSize, (index + 1) * batchSize),
  )
  const client = new JevClient()
  const waitForStart = createStartGate()
  let nextBatch = 0
  let classified = 0
  let writeQueue = Promise.resolve()
  const startedAt = Date.now()

  const worker = async () => {
    while (nextBatch < batches.length) {
      const batch = batches[nextBatch++]
      if (!batch) return
      await waitForStart()
      const results = await client.classifyBaseline(batch)
      writeQueue = writeQueue.then(() =>
        appendFile(
          corpusPaths.classifications,
          `${results.map((result) => JSON.stringify(result)).join('\n')}\n`,
        ),
      )
      await writeQueue
      classified += results.length
      const elapsed = Math.max(1, (Date.now() - startedAt) / 1_000)
      const rate = classified / elapsed
      const eta = (selected.length - classified) / Math.max(0.1, rate)
      console.log(
        `Classified ${classified.toLocaleString()}/${selected.length.toLocaleString()} · ${rate.toFixed(1)} items/s · ETA ${Math.ceil(eta)}s`,
      )
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  await writeQueue
  console.log(
    `Baseline complete: ${classified.toLocaleString()} new classifications`,
  )
}

await main()
