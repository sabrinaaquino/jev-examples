export type NliLabel = 'entailment' | 'neutral' | 'contradiction'

export interface NliPair {
  id: string
  split: 'validation' | 'test'
  premise: string
  hypothesis: string
  truth: NliLabel
  embeddingSimilarity?: number
}

export interface LiveDecision {
  id: string
  label: NliLabel
  confidence: number
  probabilities: Record<NliLabel, number>
  correct: boolean
}

export interface CorpusPayload {
  items: NliPair[]
  meta: {
    total: number
    source: string
    license: string
    labels: Record<NliLabel, number>
    embeddingModel?: string
    embeddingBaseline?: {
      accuracy: number
      elapsedMs: number
      costUsd: number
      perLabel: Array<{
        label: NliLabel
        p10: number
        median: number
        p90: number
      }>
    }
    jevBenchmark?: {
      accuracy: number
      examples: number
      batchSize: number
    }
  }
}

export interface LiveMetrics {
  completed: number
  total: number
  correct: number
  requestCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface LiveDecisionBatch extends LiveMetrics {
  type: 'batch'
  results: LiveDecision[]
}

export interface LiveDecisionDone extends LiveMetrics {
  type: 'done'
}

export interface LiveDecisionError {
  type: 'error'
  message: string
}

export type LiveDecisionEvent =
  | LiveDecisionBatch
  | LiveDecisionDone
  | LiveDecisionError
