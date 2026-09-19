import type {
  CorpusPayload,
  LiveClassificationEvent,
  ReclassificationEvent,
} from '../../shared/types.ts'

export const fetchCorpus = async (): Promise<CorpusPayload> => {
  const response = await fetch('/api/corpus')
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    throw new Error(body.error ?? `Corpus request failed with ${response.status}`)
  }
  return response.json() as Promise<CorpusPayload>
}

export const streamReclassification = async ({
  category,
  signal,
  yearFrom,
  yearTo,
  onEvent,
}: {
  category: string
  signal: AbortSignal
  yearFrom: number
  yearTo: number
  onEvent: (event: ReclassificationEvent) => void
}) => {
  const response = await fetch('/api/reclassify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, yearFrom, yearTo }),
    signal,
  })
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    throw new Error(
      body.error ?? `Reclassification failed with ${response.status}`,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  while (true) {
    const { done, value } = await reader.read()
    buffered += decoder.decode(value, { stream: !done })
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as ReclassificationEvent)
    }
    if (done) break
  }
  if (buffered.trim()) {
    onEvent(JSON.parse(buffered) as ReclassificationEvent)
  }
}

export const streamLiveClassification = async ({
  signal,
  onEvent,
}: {
  signal: AbortSignal
  onEvent: (event: LiveClassificationEvent) => void
}) => {
  const response = await fetch('/api/classify-live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal,
  })
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    throw new Error(
      body.error ?? `Live classification failed with ${response.status}`,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  while (true) {
    const { done, value } = await reader.read()
    buffered += decoder.decode(value, { stream: !done })
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as LiveClassificationEvent)
    }
    if (done) break
  }
  if (buffered.trim()) {
    onEvent(JSON.parse(buffered) as LiveClassificationEvent)
  }
}
