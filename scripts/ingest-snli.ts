import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'

import type { NliLabel, NliPair } from '../shared/types.ts'

const LABELS: Record<number, NliLabel> = {
  0: 'entailment',
  1: 'neutral',
  2: 'contradiction',
}

const splits = ['validation', 'test'] as const
const rows: NliPair[] = []

for (const split of splits) {
  const url = `https://huggingface.co/api/datasets/stanfordnlp/snli/parquet/plain_text/${split}/0.parquet`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`SNLI ${split} download failed with ${response.status}`)
  }
  const file = await response.arrayBuffer()
  const data = await parquetReadObjects({
    file,
    compressors,
    columns: ['premise', 'hypothesis', 'label'],
  })

  data.forEach((row, index) => {
    const label = LABELS[Number(row.label)]
    if (!label) return
    rows.push({
      id: `${split}-${index}`,
      split,
      premise: String(row.premise),
      hypothesis: String(row.hypothesis),
      truth: label,
    })
  })
  console.log(`Loaded ${data.length.toLocaleString()} ${split} pairs`)
}

const dataDirectory = path.resolve(process.cwd(), 'data')
await mkdir(dataDirectory, { recursive: true })
await writeFile(
  path.join(dataDirectory, 'pairs.jsonl'),
  `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
)

const labelCounts = rows.reduce<Record<NliLabel, number>>(
  (counts, row) => {
    counts[row.truth] += 1
    return counts
  },
  { entailment: 0, neutral: 0, contradiction: 0 },
)
await writeFile(
  path.join(dataDirectory, 'corpus-meta.json'),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: 'stanfordnlp/snli',
      sourceUrl: 'https://huggingface.co/datasets/stanfordnlp/snli',
      license: 'CC BY-SA 4.0',
      splits,
      total: rows.length,
      labels: labelCounts,
    },
    null,
    2,
  )}\n`,
)
console.log(`Wrote ${rows.length.toLocaleString()} labeled SNLI pairs`)
