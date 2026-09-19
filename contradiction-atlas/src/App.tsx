import { useEffect, useRef, useState } from 'react'

import type {
  CorpusPayload,
  LiveDecision,
  LiveDecisionEvent,
  LiveMetrics,
  NliPair,
} from '../shared/types.ts'
import './App.css'
import { DecisionField } from './components/DecisionField.tsx'
import { fetchCorpus, streamDecisions } from './lib/api.ts'

type RunState = 'ready' | 'running' | 'done' | 'error'

const EMPTY_METRICS: LiveMetrics = {
  completed: 0,
  total: 0,
  correct: 0,
  requestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
}

const duration = (milliseconds: number) => {
  const seconds = Math.round(milliseconds / 1_000)
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

function App() {
  const [corpus, setCorpus] = useState<CorpusPayload | null>(null)
  const [loadError, setLoadError] = useState('')
  const [decisions, setDecisions] = useState<Map<string, LiveDecision>>(
    () => new Map(),
  )
  const [metrics, setMetrics] = useState<LiveMetrics>(EMPTY_METRICS)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [runState, setRunState] = useState<RunState>('ready')
  const [runError, setRunError] = useState('')
  const [hovered, setHovered] = useState<{
    pair: NliPair
    decision: LiveDecision
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const startedAtRef = useRef(0)

  useEffect(() => {
    fetchCorpus()
      .then(setCorpus)
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : String(error)),
      )
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (runState !== 'running') return
    const timer = window.setInterval(
      () => setElapsedMs(performance.now() - startedAtRef.current),
      200,
    )
    return () => window.clearInterval(timer)
  }, [runState])

  const handleEvent = (event: LiveDecisionEvent) => {
    if (event.type === 'batch') {
      setDecisions((previous) => {
        const next = new Map(previous)
        event.results.forEach((decision) => next.set(decision.id, decision))
        return next
      })
      const { type: _type, results: _results, ...nextMetrics } = event
      setMetrics(nextMetrics)
    } else if (event.type === 'done') {
      const { type: _type, ...nextMetrics } = event
      setMetrics(nextMetrics)
      setElapsedMs(performance.now() - startedAtRef.current)
      setRunState('done')
    } else {
      setRunError(event.message)
      setRunState('error')
    }
  }

  const start = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setDecisions(new Map())
    setMetrics({ ...EMPTY_METRICS, total: corpus?.meta.total ?? 0 })
    setElapsedMs(0)
    setRunError('')
    setRunState('running')
    setHovered(null)
    startedAtRef.current = performance.now()
    try {
      await streamDecisions({ signal: controller.signal, onEvent: handleEvent })
    } catch (error) {
      if (controller.signal.aborted) return
      setRunError(error instanceof Error ? error.message : String(error))
      setRunState('error')
    }
  }

  const reset = () => {
    abortRef.current?.abort()
    setDecisions(new Map())
    setMetrics(EMPTY_METRICS)
    setElapsedMs(0)
    setRunError('')
    setRunState('ready')
    setHovered(null)
  }

  if (loadError) {
    return (
      <main className="loading">
        <h1>Could not load the contradiction corpus.</h1>
        <p>{loadError}</p>
      </main>
    )
  }
  if (!corpus) {
    return (
      <main className="loading">
        <div className="loading-mark" />
        <h1>Loading 19,666 human judgments…</h1>
      </main>
    )
  }

  const liveAccuracy = metrics.completed
    ? metrics.correct / metrics.completed
    : 0
  const benchmark = corpus.meta.jevBenchmark?.accuracy ?? 0.87
  const embeddingAccuracy = corpus.meta.embeddingBaseline?.accuracy ?? 0.563
  const example =
    corpus.items.find(
      (pair) =>
        pair.truth === 'contradiction' &&
        (pair.embeddingSimilarity ?? 0) > 0.82,
    ) ?? corpus.items[0]!

  return (
    <main className={`app ${runState !== 'ready' ? 'show-guide' : ''}`}>
      {runState !== 'ready' && (
        <DecisionField
          pairs={corpus.items}
          decisions={decisions}
          onHover={setHovered}
        />
      )}

      <header>
        <div className="identity">
          <span className="identity-mark">≠</span>
          <div>
            <p>Jev live experiment</p>
            <h1>Contradiction Atlas</h1>
            <a
              className="powered-by"
              href="https://venice.ai/lp/jev"
              target="_blank"
              rel="noreferrer"
            >
              Powered by Venice AI
            </a>
          </div>
        </div>
        <div className="run-controls">
          <button type="button" className="quiet" onClick={reset}>
            Reset
          </button>
          <button
            type="button"
            className="primary"
            onClick={() =>
              runState === 'running' ? reset() : void start()
            }
          >
            {runState === 'running' ? 'Stop live run' : 'Start live run'}
          </button>
        </div>
        <dl className="live-stats">
          <div>
            <dt>Decided live</dt>
            <dd>
              {metrics.completed.toLocaleString()} /{' '}
              {corpus.meta.total.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Live accuracy</dt>
            <dd>{metrics.completed ? `${(liveAccuracy * 100).toFixed(1)}%` : '—'}</dd>
          </div>
          <div>
            <dt>Elapsed</dt>
            <dd>{duration(elapsedMs)}</dd>
          </div>
          <div>
            <dt>Live cost</dt>
            <dd>${metrics.costUsd.toFixed(3)}</dd>
          </div>
        </dl>
      </header>

      {runState === 'ready' && (
        <section className="opening">
          <p className="kicker">Similarity is not inference</p>
          <h2>Can a model tell agreement from contradiction?</h2>
          <div className="example-pair">
            <div>
              <span>What we know</span>
              <p>{example.premise}</p>
            </div>
            <div>
              <span>Statement to test</span>
              <p>{example.hypothesis}</p>
            </div>
            <div className="example-result">
              <span>
                Embedding similarity{' '}
                <strong>{(example.embeddingSimilarity! * 100).toFixed(0)}%</strong>
              </span>
              <span>
                Human label <strong>Contradiction</strong>
              </span>
            </div>
          </div>
          <p className="example-explanation">
            The sentences sound alike, but the second does not follow from the
            first. Similarity sees the topic; inference judges the relationship.
          </p>
          <div className="benchmark">
            <div>
              <span>Similarity-only accuracy</span>
              <strong>{(embeddingAccuracy * 100).toFixed(1)}%</strong>
            </div>
            <i>versus</i>
            <div>
              <span>Jev accuracy · 500 held-out pairs</span>
              <strong>{(benchmark * 100).toFixed(1)}%</strong>
            </div>
          </div>
          <button type="button" className="opening-action" onClick={() => void start()}>
            Judge all {corpus.meta.total.toLocaleString()} pairs live
          </button>
          <small>Approximately 4 minutes · approximately $0.19</small>
        </section>
      )}

      {runState === 'running' && metrics.completed === 0 && (
        <p className="waiting">Waiting for the first Jev decisions…</p>
      )}

      {runError && <p className="error">{runError}</p>}

      {runState !== 'ready' && (
        <aside className="guide-panel">
          <section>
            <p className="section-label">How to read the field</p>
            <div className="grammar">
              <div>
                <b>Lane</b>
                <span>Jev’s answer: contradiction, neutral, or entailment.</span>
              </div>
              <div>
                <b>Height</b>
                <span>How similar the two sentences sound to embeddings.</span>
              </div>
              <div>
                <b>Point</b>
                <span>Solid agrees with the human; a ring disagrees.</span>
              </div>
            </div>
          </section>

          <section className="side-benchmark">
            <p className="section-label">Held-out accuracy</p>
            <div>
              <span>Similarity only</span>
              <strong>{(embeddingAccuracy * 100).toFixed(1)}%</strong>
            </div>
            <div>
              <span>Jev benchmark</span>
              <strong>{(benchmark * 100).toFixed(1)}%</strong>
            </div>
            <div className="current">
              <span>This live run</span>
              <strong>
                {metrics.completed ? `${(liveAccuracy * 100).toFixed(1)}%` : '—'}
              </strong>
            </div>
          </section>

          <section className="pair-inspector">
            <p className="section-label">Point inspector</p>
            {hovered ? (
              <>
                <dl>
                  <div>
                    <dt>Jev</dt>
                    <dd>{hovered.decision.label}</dd>
                  </div>
                  <div>
                    <dt>Human</dt>
                    <dd>{hovered.pair.truth}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{(hovered.decision.confidence * 100).toFixed(0)}%</dd>
                  </div>
                  <div>
                    <dt>Similarity</dt>
                    <dd>{((hovered.pair.embeddingSimilarity ?? 0) * 100).toFixed(0)}%</dd>
                  </div>
                </dl>
                <span>What we know</span>
                <p>{hovered.pair.premise}</p>
                <span>Statement tested</span>
                <p>{hovered.pair.hypothesis}</p>
              </>
            ) : (
              <p className="hover-help">
                Hover any classified point to inspect both sentences and compare
                Jev with the human answer.
              </p>
            )}
          </section>
        </aside>
      )}

      <footer>
        <span>Each point is one sentence pair</span>
        <span>Top sounds more similar</span>
        <span>Bottom sounds less similar</span>
        <span>SNLI · CC BY-SA 4.0</span>
      </footer>
    </main>
  )
}

export default App
