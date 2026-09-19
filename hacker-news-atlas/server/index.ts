import path from 'node:path'

import compression from 'compression'
import 'dotenv/config'
import express from 'express'
import { z } from 'zod'

import { loadAtlas, loadCorpusItems } from './corpus.ts'
import { JevClient } from './jev.ts'

const PORT = Number(process.env.PORT ?? 8787)
const BASELINE_BATCH_SIZE = 48
const CUSTOM_BATCH_SIZE = 80
const CONCURRENCY = 8
const REQUEST_START_INTERVAL_MS = 210
const JEV_INPUT_PRICE_PER_MILLION_USD = 0.0525

const app = express()
app.disable('x-powered-by')
app.use(compression())
app.use(express.json({ limit: '32kb' }))

const liveCategoryCache = new Map<
  string,
  Array<{ id: string; probability: number }>
>()
let activeReclassifications = 0
let activeBaselineClassifications = 0

const requestSchema = z.object({
  category: z.string().trim().min(2).max(120),
  yearFrom: z.number().int().min(2006).optional(),
  yearTo: z.number().int().max(2100).optional(),
})

const baselineRequestSchema = z.object({
  limit: z.number().int().min(1).max(24_000).optional(),
})

const writeEvent = (response: express.Response, event: unknown) => {
  response.write(`${JSON.stringify(event)}\n`)
}

const createStartGate = (intervalMs: number) => {
  let nextStart = Date.now()
  let queue = Promise.resolve()
  return () => {
    const scheduled = queue.then(async () => {
      const wait = Math.max(0, nextStart - Date.now())
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      nextStart = Date.now() + intervalMs
    })
    queue = scheduled.catch(() => undefined)
    return scheduled
  }
}

const waitForJevStart = createStartGate(REQUEST_START_INTERVAL_MS)

const hash = (value: string) => {
  let result = 2166136261
  for (const character of value) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

const stableShuffle = <T extends { id: string }>(items: T[]) =>
  [...items].sort((left, right) => hash(left.id) - hash(right.id))

app.get('/api/health', async (_request, response) => {
  const items = await loadCorpusItems()
  response.json({
    ok: true,
    corpusItems: items.length,
    jevConfigured: Boolean(process.env.VENICE_API_KEY),
  })
})

app.get('/api/corpus', async (_request, response) => {
  const corpus = await loadAtlas()
  if (!corpus.items.length) {
    response.status(503).json({
      error: 'Corpus is empty. Run `npm run ingest` first.',
    })
    return
  }
  response.setHeader('Cache-Control', 'no-store')
  response.json(corpus)
})

app.post('/api/classify-live', async (request, response) => {
  const parsed = baselineRequestSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({
      error: 'The optional limit must be between 1 and 24,000.',
      issues: parsed.error.issues,
    })
    return
  }
  if (!process.env.VENICE_API_KEY) {
    response.status(503).json({
      error: 'VENICE_API_KEY is not configured on the server.',
    })
    return
  }
  if (activeBaselineClassifications > 0) {
    response.status(409).json({
      error: 'A full live classification is already running.',
    })
    return
  }

  const allItems = stableShuffle(await loadCorpusItems())
  const items = parsed.data.limit
    ? allItems.slice(0, parsed.data.limit)
    : allItems
  activeBaselineClassifications += 1

  response.status(200)
  response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('X-Accel-Buffering', 'no')
  response.flushHeaders()

  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort()
  })

  let nextBatch = 0
  let completed = 0
  let requestCount = 0
  let inputTokens = 0
  let outputTokens = 0
  const cost = () =>
    (inputTokens / 1_000_000) * JEV_INPUT_PRICE_PER_MILLION_USD
  const client = new JevClient({
    onUsage: (usage) => {
      requestCount += 1
      inputTokens += usage.inputTokens
      outputTokens += usage.outputTokens
    },
  })

  const worker = async () => {
    while (!controller.signal.aborted) {
      const start = nextBatch
      nextBatch += BASELINE_BATCH_SIZE
      if (start >= items.length) return
      const batch = items.slice(start, start + BASELINE_BATCH_SIZE)
      await waitForJevStart()
      const classifications = await client.classifyBaseline(
        batch,
        controller.signal,
      )
      completed += classifications.length
      writeEvent(response, {
        type: 'batch',
        completed,
        total: items.length,
        requestCount,
        inputTokens,
        outputTokens,
        costUsd: cost(),
        results: classifications.map(({ id, category, confidence }) => ({
          id,
          category,
          confidence,
        })),
      })
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
    writeEvent(response, {
      type: 'done',
      completed,
      total: items.length,
      requestCount,
      inputTokens,
      outputTokens,
      costUsd: cost(),
    })
  } catch (error) {
    if (!controller.signal.aborted) {
      writeEvent(response, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
      controller.abort()
    }
  } finally {
    activeBaselineClassifications = Math.max(
      0,
      activeBaselineClassifications - 1,
    )
    response.end()
  }
})

app.post('/api/reclassify', async (request, response) => {
  const parsed = requestSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({
      error: 'Provide a category between 2 and 120 characters.',
      issues: parsed.error.issues,
    })
    return
  }
  if (!process.env.VENICE_API_KEY) {
    response.status(503).json({
      error: 'VENICE_API_KEY is not configured on the server.',
    })
    return
  }

  const { category, yearFrom = 2006, yearTo = 2100 } = parsed.data
  const items = stableShuffle(
    (await loadCorpusItems()).filter(
      (item) => item.year >= yearFrom && item.year <= yearTo,
    ),
  )
  const cacheKey = `${category.toLowerCase()}|${yearFrom}|${yearTo}`

  response.status(200)
  response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('X-Accel-Buffering', 'no')
  response.flushHeaders()

  const cached = liveCategoryCache.get(cacheKey)
  if (cached) {
    for (let start = 0; start < cached.length; start += 500) {
      const completed = Math.min(start + 500, cached.length)
      writeEvent(response, {
        type: 'batch',
        category,
        completed,
        total: cached.length,
        results: cached.slice(start, completed),
      })
    }
    writeEvent(response, {
      type: 'done',
      category,
      completed: cached.length,
      total: cached.length,
    })
    response.end()
    return
  }

  if (activeReclassifications >= 2) {
    writeEvent(response, {
      type: 'error',
      message: 'Two live reorganizations are already running. Try again shortly.',
    })
    response.end()
    return
  }
  activeReclassifications += 1

  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort()
  })

  const client = new JevClient()
  const runResults: Array<{ id: string; probability: number }> = []
  let nextBatch = 0
  let completed = 0

  const worker = async () => {
    while (!controller.signal.aborted) {
      const start = nextBatch
      nextBatch += CUSTOM_BATCH_SIZE
      if (start >= items.length) return
      const batch = items.slice(start, start + CUSTOM_BATCH_SIZE)
      await waitForJevStart()
      const results = await client.scoreCustomCategory(
        batch,
        category,
        controller.signal,
      )
      runResults.push(...results)
      completed += results.length
      writeEvent(response, {
        type: 'batch',
        category,
        completed,
        total: items.length,
        results,
      })
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
    writeEvent(response, {
      type: 'done',
      category,
      completed,
      total: items.length,
    })
    liveCategoryCache.set(cacheKey, runResults)
    if (liveCategoryCache.size > 8) {
      const oldestKey = liveCategoryCache.keys().next().value
      if (oldestKey) liveCategoryCache.delete(oldestKey)
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      writeEvent(response, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
      controller.abort()
    }
  } finally {
    activeReclassifications = Math.max(0, activeReclassifications - 1)
    response.end()
  }
})

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found' })
})

if (process.env.NODE_ENV === 'production') {
  const distribution = path.resolve(process.cwd(), 'dist')
  app.use(express.static(distribution))
  app.use((_request, response) => {
    response.sendFile(path.join(distribution, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`HN Jev Atlas API listening on http://localhost:${PORT}`)
})
