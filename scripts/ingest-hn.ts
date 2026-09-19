import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { decode } from 'html-entities'

import type { HnItem, HnItemKind } from '../shared/types.ts'

const ALGOLIA_URL = 'https://hn.algolia.com/api/v1/search_by_date'
const CONCURRENCY = 6

interface AlgoliaHit {
  objectID: string
  author?: string | null
  comment_text?: string | null
  created_at_i?: number | null
  points?: number | null
  story_id?: number | null
  story_text?: string | null
  story_title?: string | null
  title?: string | null
}

interface SamplePeriod {
  label: string
  from: number
  to: number
}

const argument = (name: string, fallback: number) => {
  const prefix = `--${name}=`
  const value = process.argv.find((entry) => entry.startsWith(prefix))
  return value ? Number(value.slice(prefix.length)) : fallback
}

const target = argument('target', 24_000)
const stepMonths = argument('step-months', 2)
const perKind = argument('per-kind', 140)

const cleanHtml = (value: string) =>
  decode(
    value
      .replace(/<p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<pre><code>/gi, '\n')
      .replace(/<\/code><\/pre>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()

const hashNumber = (value: number) => {
  let result = value ^ 0x9e3779b9
  result = Math.imul(result ^ (result >>> 16), 0x21f0aaad)
  result = Math.imul(result ^ (result >>> 15), 0x735a2d97)
  return (result ^ (result >>> 15)) >>> 0
}

const buildPeriods = (): SamplePeriod[] => {
  const periods: SamplePeriod[] = []
  const now = new Date()
  let cursor = new Date(Date.UTC(2006, 9, 1))
  while (cursor.getTime() < now.getTime()) {
    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth()
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const day = 4 + (hashNumber(year * 12 + month) % Math.max(1, days - 7))
    let start = new Date(Date.UTC(year, month, day))
    if (start.getTime() >= now.getTime()) {
      start = new Date(Date.UTC(year, month, Math.max(1, now.getUTCDate() - 1)))
    }
    const end = new Date(start.getTime() + 86_400_000)
    periods.push({
      label: start.toISOString().slice(0, 10),
      from: Math.floor(start.getTime() / 1_000),
      to: Math.min(
        Math.floor(end.getTime() / 1_000),
        Math.floor(now.getTime() / 1_000),
      ),
    })
    cursor = new Date(Date.UTC(year, month + stepMonths, 1))
  }
  return periods
}

const fetchSample = async (
  period: SamplePeriod,
  kind: HnItemKind,
): Promise<HnItem[]> => {
  const parameters = new URLSearchParams({
    tags: kind,
    numericFilters: `created_at_i>=${period.from},created_at_i<${period.to}`,
    hitsPerPage: String(perKind),
    page: '0',
  })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${ALGOLIA_URL}?${parameters}`)
    if (response.ok) {
      const payload = (await response.json()) as { hits: AlgoliaHit[] }
      return payload.hits
        .map((hit): HnItem | undefined => {
          const timestamp = hit.created_at_i
          const title = cleanHtml(
            (kind === 'comment' ? hit.story_title : hit.title) ?? '',
          )
          const text = cleanHtml(
            (kind === 'comment' ? hit.comment_text : hit.story_text) ?? title,
          ).slice(0, 1_600)
          const storyId =
            kind === 'comment' && hit.story_id
              ? String(hit.story_id)
              : undefined
          if (!timestamp || !title || text.length < 20) return undefined
          return {
            id: hit.objectID,
            kind,
            title,
            text,
            author: hit.author ?? 'unknown',
            timestamp,
            year: new Date(timestamp * 1_000).getUTCFullYear(),
            url: `https://news.ycombinator.com/item?id=${storyId ?? hit.objectID}`,
            storyId,
            score: typeof hit.points === 'number' ? hit.points : undefined,
          }
        })
        .filter((item): item is HnItem => item !== undefined)
    }
    if (response.status !== 429 && response.status < 500) {
      throw new Error(
        `Algolia returned ${response.status} for ${period.label} ${kind}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
  }
  throw new Error(`Algolia retries exhausted for ${period.label} ${kind}`)
}

const evenSample = (items: HnItem[], size: number) => {
  if (items.length <= size) return items
  const sorted = [...items].sort((a, b) => a.timestamp - b.timestamp)
  return Array.from(
    { length: size },
    (_, index) => sorted[Math.floor((index * sorted.length) / size)]!,
  )
}

const main = async () => {
  const tasks = buildPeriods().flatMap((period) =>
    (['story', 'comment'] as const).map((kind) => ({ period, kind })),
  )
  const collected: HnItem[] = []
  let cursor = 0
  let finished = 0

  const worker = async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++]
      if (!task) return
      collected.push(...(await fetchSample(task.period, task.kind)))
      finished += 1
      if (finished % 20 === 0 || finished === tasks.length) {
        console.log(
          `Fetched ${finished}/${tasks.length} slices · ${collected.length.toLocaleString()} usable items`,
        )
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  const unique = [
    ...new Map(collected.map((item) => [item.id, item])).values(),
  ]
  const sampled = evenSample(unique, target)
  const kindCounts = Object.fromEntries(
    (['story', 'comment'] as const).map((kind) => [
      kind,
      sampled.filter((item) => item.kind === kind).length,
    ]),
  )
  const yearCounts = Object.fromEntries(
    [...new Set(sampled.map((item) => item.year))]
      .sort((a, b) => a - b)
      .map((year) => [
        year,
        sampled.filter((item) => item.year === year).length,
      ]),
  )
  const dataDirectory = path.resolve(process.cwd(), 'data')
  await mkdir(dataDirectory, { recursive: true })
  await writeFile(
    path.join(dataDirectory, 'corpus.jsonl'),
    `${sampled.map((item) => JSON.stringify(item)).join('\n')}\n`,
  )
  await writeFile(
    path.join(dataDirectory, 'corpus-meta.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'https://hn.algolia.com/api',
        strategy: `One deterministic day every ${stepMonths} months; balanced story/comment queries; evenly downsampled`,
        requestedItems: target,
        items: sampled.length,
        rawUsableItems: unique.length,
        kindCounts,
        yearCounts,
        firstTimestamp: sampled.at(0)?.timestamp,
        lastTimestamp: sampled.at(-1)?.timestamp,
      },
      null,
      2,
    )}\n`,
  )
  console.log(
    `Wrote ${sampled.length.toLocaleString()} items to data/corpus.jsonl`,
  )
}

await main()
