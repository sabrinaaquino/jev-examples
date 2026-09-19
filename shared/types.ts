export type HnItemKind = 'story' | 'comment'

export interface HnItem {
  id: string
  kind: HnItemKind
  title: string
  text: string
  author: string
  timestamp: number
  year: number
  url: string
  storyId?: string
  score?: number
}

export interface Classification {
  id: string
  category: string
  confidence: number
  probabilities: Record<string, number>
  model: string
  classifiedAt: string
}

export interface LiveClassification {
  id: string
  category: string
  confidence: number
}

export interface LiveClassificationProgress {
  type: 'batch'
  completed: number
  total: number
  requestCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  results: LiveClassification[]
}

export interface LiveClassificationDone {
  type: 'done'
  completed: number
  total: number
  requestCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface LiveClassificationFailure {
  type: 'error'
  message: string
}

export type LiveClassificationEvent =
  | LiveClassificationProgress
  | LiveClassificationDone
  | LiveClassificationFailure

export interface AtlasItem extends HnItem {
  category: string
  confidence: number
  probabilities: Record<string, number>
}

export interface CorpusPayload {
  items: AtlasItem[]
  meta: {
    total: number
    classified: number
    firstYear: number
    lastYear: number
    source: string
    run?: {
      baselineRequests: number
      baselineWallClockMs: number
      ingestWallClockMs: number
      estimatedInputTokens: number
      estimatedOutputTokens: number
      estimatedCostUsd: number
      costMargin95Usd: number
      sampledBatches: number
    }
  }
}

export interface ReclassificationUpdate {
  type: 'batch'
  category: string
  completed: number
  total: number
  results: Array<{
    id: string
    probability: number
  }>
}

export interface ReclassificationDone {
  type: 'done'
  category: string
  completed: number
  total: number
}

export interface ReclassificationError {
  type: 'error'
  message: string
}

export type ReclassificationEvent =
  | ReclassificationUpdate
  | ReclassificationDone
  | ReclassificationError
