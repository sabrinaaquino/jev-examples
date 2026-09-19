import path from 'node:path'

import compression from 'compression'
import 'dotenv/config'
import express from 'express'
import { z } from 'zod'

import { loadCorpus, loadPairs } from './corpus.ts'
import { JevNliClient } from './jev.ts'

const PORT = Number(process.env.PORT ?? 8788)
const BATCH_SIZE = 16
const CONCURRENCY = 5
const REQUEST_INTERVAL_MS = 210
const INPUT_PRICE_PER_MILLION_USD = 0.0525

const app = express()
app.disable('x-powered-by')
app.use(compression())
app.use(express.json({ limit: '32kb' }))

let activeRun = false

const runSchema = z.object({
  limit: z.number().int().min(1).max(20_000).optional(),
})

const writeEvent = (response: express.Response, event: unknown) => {
  response.write(`${JSON.stringify(event)}\n`)
}

const hash = (value: string) => {
  let result = 2166136261
  for (const character of value) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

app.get('/api/health', async (_request, response) => {
  response.json({
    ok: true,
    pairs: (await loadPairs()).length,
    jevConfigured: Boolean(process.env.VENICE_API_KEY),
  })
})

app.get('/api/corpus', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.json(await loadCorpus())
})

app.post('/api/classify-live', async (request, response) => {
  const parsed = runSchema.safeParse(request.body)
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid live-run limit' })
    return
  }
  if (!process.env.VENICE_API_KEY) {
    response.status(503).json({ error: 'VENICE_API_KEY is not configured' })
    return
  }
  if (activeRun) {
    response.status(409).json({ error: 'A live run is already active' })
    return
  }

  const allPairs = [...(await loadPairs())].sort(
    (left, right) => hash(left.id) - hash(right.id),
  )
  const pairs = parsed.data.limit
    ? allPairs.slice(0, parsed.data.limit)
    : allPairs
  activeRun = true

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
  let nextStart = Date.now()
  let startQueue = Promise.resolve()
  let completed = 0
  let correct = 0
  let requestCount = 0
  let inputTokens = 0
  let outputTokens = 0

  const waitForStart = () => {
    const scheduled = startQueue.then(async () => {
      const wait = Math.max(0, nextStart - Date.now())
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      nextStart = Date.now() + REQUEST_INTERVAL_MS
    })
    startQueue = scheduled.catch(() => undefined)
    return scheduled
  }
  const cost = () =>
    (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION_USD
  const client = new JevNliClient({
    onUsage: (usage) => {
      requestCount += 1
      inputTokens += usage.inputTokens
      outputTokens += usage.outputTokens
    },
  })

  const worker = async () => {
    while (!controller.signal.aborted) {
      const start = nextBatch
      nextBatch += BATCH_SIZE
      if (start >= pairs.length) return
      const batch = pairs.slice(start, start + BATCH_SIZE)
      await waitForStart()
      const decisions = await client.classify(batch, controller.signal)
      completed += decisions.length
      correct += decisions.filter((decision) => decision.correct).length
      writeEvent(response, {
        type: 'batch',
        completed,
        total: pairs.length,
        correct,
        requestCount,
        inputTokens,
        outputTokens,
        costUsd: cost(),
        results: decisions,
      })
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
    writeEvent(response, {
      type: 'done',
      completed,
      total: pairs.length,
      correct,
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
    activeRun = false
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
  console.log(`Contradiction Atlas listening on http://localhost:${PORT}`)
})
