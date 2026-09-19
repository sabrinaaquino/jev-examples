import type {
  CorpusPayload,
  LiveDecisionEvent,
} from '../../shared/types.ts'

export const fetchCorpus = async (): Promise<CorpusPayload> => {
  const response = await fetch('/api/corpus')
  if (!response.ok) throw new Error(`Corpus failed with ${response.status}`)
  return response.json() as Promise<CorpusPayload>
}

export const streamDecisions = async ({
  signal,
  onEvent,
}: {
  signal: AbortSignal
  onEvent: (event: LiveDecisionEvent) => void
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
    throw new Error(body.error ?? `Live run failed with ${response.status}`)
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
      if (line.trim()) onEvent(JSON.parse(line) as LiveDecisionEvent)
    }
    if (done) break
  }
  if (buffered.trim()) onEvent(JSON.parse(buffered) as LiveDecisionEvent)
}
