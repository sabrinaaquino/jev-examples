import { useEffect, useMemo, useRef, useState } from 'react'

import { BASE_CATEGORIES } from '../shared/categories.ts'
import type {
  AtlasItem,
  CorpusPayload,
  LiveClassification,
  LiveClassificationEvent,
  ReclassificationEvent,
} from '../shared/types.ts'
import './App.css'
import { AtlasCanvas } from './components/AtlasCanvas.tsx'
import {
  fetchCorpus,
  streamLiveClassification,
  streamReclassification,
} from './lib/api.ts'

const PERIODS = [
  { label: 'All years', from: 2006, to: 2100 },
  { label: 'Early HN', from: 2006, to: 2010 },
  { label: 'Mobile era', from: 2011, to: 2015 },
  { label: 'Platform era', from: 2016, to: 2020 },
  { label: 'AI wave', from: 2021, to: 2100 },
]

const SUGGESTIONS = [
  'AI anxiety',
  'Founder optimism',
  'Open-source idealism',
  'Things that aged badly',
]

type RunState = 'idle' | 'running' | 'done' | 'error'
type ClassificationState = 'ready' | 'running' | 'done' | 'error'

const formatDuration = (milliseconds: number) => {
  const seconds = Math.round(milliseconds / 1_000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

function App() {
  const [corpus, setCorpus] = useState<CorpusPayload | null>(null)
  const [loadError, setLoadError] = useState('')
  const [hoveredItem, setHoveredItem] = useState<AtlasItem | null>(null)
  const [focusedCategory, setFocusedCategory] = useState<string | null>(null)
  const [categoryInput, setCategoryInput] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [customScores, setCustomScores] = useState<Map<string, number>>(
    () => new Map(),
  )
  const [runState, setRunState] = useState<RunState>('idle')
  const [runError, setRunError] = useState('')
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [threshold, setThreshold] = useState(0.66)
  const [periodIndex, setPeriodIndex] = useState(0)
  const [legendOpen, setLegendOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [liveClassifications, setLiveClassifications] = useState<
    Map<string, LiveClassification>
  >(() => new Map())
  const [classificationState, setClassificationState] =
    useState<ClassificationState>('ready')
  const [classificationError, setClassificationError] = useState('')
  const [liveMetrics, setLiveMetrics] = useState({
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  })
  const [liveElapsedMs, setLiveElapsedMs] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const liveStartedAtRef = useRef(0)

  useEffect(() => {
    fetchCorpus()
      .then(setCorpus)
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : String(error)),
      )
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (classificationState !== 'running') return
    const interval = window.setInterval(() => {
      setLiveElapsedMs(performance.now() - liveStartedAtRef.current)
    }, 200)
    return () => window.clearInterval(interval)
  }, [classificationState])

  const period = PERIODS[periodIndex] ?? PERIODS[0]!
  const itemById = useMemo(
    () => new Map(corpus?.items.map((item) => [item.id, item]) ?? []),
    [corpus],
  )
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const classification of liveClassifications.values()) {
      const item = itemById.get(classification.id)
      if (!item) continue
      if (item.year < period.from || item.year > period.to) continue
      counts.set(
        classification.category,
        (counts.get(classification.category) ?? 0) + 1,
      )
    }
    return counts
  }, [itemById, liveClassifications, period.from, period.to])

  const visibleItems = useMemo(
    () =>
      corpus?.items.filter(
        (item) => item.year >= period.from && item.year <= period.to,
      ).length ?? 0,
    [corpus, period.from, period.to],
  )
  const revealedVisibleItems = useMemo(() => {
    let count = 0
    for (const id of liveClassifications.keys()) {
      const item = itemById.get(id)
      if (item && item.year >= period.from && item.year <= period.to) count += 1
    }
    return count
  }, [itemById, liveClassifications, period.from, period.to])

  const matchCount = useMemo(
    () =>
      [...customScores.values()].filter((score) => score >= threshold).length,
    [customScores, threshold],
  )

  const handleEvent = (event: ReclassificationEvent) => {
    if (event.type === 'batch') {
      setCustomScores((previous) => {
        const next = new Map(previous)
        for (const result of event.results) {
          next.set(result.id, result.probability)
        }
        return next
      })
      setProgress({ completed: event.completed, total: event.total })
    } else if (event.type === 'done') {
      setProgress({ completed: event.completed, total: event.total })
      setRunState('done')
    } else {
      setRunError(event.message)
      setRunState('error')
    }
  }

  const handleLiveEvent = (event: LiveClassificationEvent) => {
    if (event.type === 'batch') {
      setLiveClassifications((previous) => {
        const next = new Map(previous)
        for (const result of event.results) next.set(result.id, result)
        return next
      })
      setLiveMetrics({
        requestCount: event.requestCount,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        costUsd: event.costUsd,
      })
    } else if (event.type === 'done') {
      setLiveMetrics({
        requestCount: event.requestCount,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        costUsd: event.costUsd,
      })
      setLiveElapsedMs(performance.now() - liveStartedAtRef.current)
      setClassificationState('done')
    } else {
      setClassificationError(event.message)
      setClassificationState('error')
    }
  }

  const startLiveClassification = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setCustomCategory('')
    setCustomScores(new Map())
    setProgress({ completed: 0, total: 0 })
    setRunState('idle')
    setRunError('')
    setLiveClassifications(new Map())
    setLiveMetrics({
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    })
    setLiveElapsedMs(0)
    setClassificationError('')
    setClassificationState('running')
    setFocusedCategory(null)
    setPeriodIndex(0)
    setCommandOpen(false)
    setLegendOpen(false)
    liveStartedAtRef.current = performance.now()
    try {
      await streamLiveClassification({
        signal: controller.signal,
        onEvent: handleLiveEvent,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      setClassificationError(
        error instanceof Error ? error.message : String(error),
      )
      setClassificationState('error')
    }
  }

  const reorganize = async (category = categoryInput) => {
    const normalized = category.trim()
    if (normalized.length < 2) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setCategoryInput(normalized)
    setCustomCategory(normalized)
    setFocusedCategory(null)
    setCustomScores(new Map())
    setProgress({ completed: 0, total: visibleItems })
    setRunError('')
    setRunState('running')
    try {
      await streamReclassification({
        category: normalized,
        signal: controller.signal,
        yearFrom: period.from,
        yearTo: period.to,
        onEvent: handleEvent,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      setRunError(error instanceof Error ? error.message : String(error))
      setRunState('error')
    }
  }

  const clearCustomCategory = () => {
    abortRef.current?.abort()
    setCustomCategory('')
    setCustomScores(new Map())
    setProgress({ completed: 0, total: 0 })
    setRunState('idle')
    setRunError('')
  }

  const resetLiveClassification = () => {
    clearCustomCategory()
    setLiveClassifications(new Map())
    setClassificationError('')
    setClassificationState('ready')
    setFocusedCategory(null)
    setHoveredItem(null)
    setPeriodIndex(0)
    setLegendOpen(false)
    setCommandOpen(false)
  }

  if (loadError) {
    return (
      <main className="load-state">
        <div className="load-mark">Y</div>
        <h1>The atlas has no corpus yet.</h1>
        <p>{loadError}</p>
        <code>npm run ingest &amp;&amp; npm run classify</code>
      </main>
    )
  }
  if (!corpus) {
    return (
      <main className="load-state">
        <div className="load-mark is-loading">Y</div>
        <h1>Loading the Hacker News memory…</h1>
        <p>Preparing thousands of Jev judgments.</p>
      </main>
    )
  }

  const progressPercent = progress.total
    ? (progress.completed / progress.total) * 100
    : 0
  const hoveredLiveClassification = hoveredItem
    ? liveClassifications.get(hoveredItem.id)
    : undefined

  return (
    <main className="app-shell">
      <AtlasCanvas
        items={corpus.items}
        customCategory={customCategory}
        customScores={customScores}
        threshold={threshold}
        yearFrom={period.from}
        yearTo={period.to}
        focusedCategory={focusedCategory}
        classifications={liveClassifications}
        onHover={setHoveredItem}
      />

      <header className="topbar glass-panel">
        <div className="brand-lockup">
          <div className="brand-mark">
            <img src="/venice-mark.svg" alt="Venice" />
          </div>
          <div>
            <p className="eyebrow">Jev × Hacker News · 2006—2026</p>
            <h1>Semantic Atlas</h1>
          </div>
        </div>
        <div className="playback-controls">
          <button
            type="button"
            className="secondary"
            onClick={resetLiveClassification}
          >
            ↺ Reset
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (classificationState === 'running') {
                resetLiveClassification()
              } else {
                void startLiveClassification()
              }
            }}
          >
            {classificationState === 'running'
              ? '■ Stop'
              : '▶ Classify live'}
          </button>
        </div>
        <div className="top-stats">
          <div>
            <strong>
              {revealedVisibleItems.toLocaleString()} /{' '}
              {visibleItems.toLocaleString()}
            </strong>
            <span>classified live</span>
          </div>
          <div>
            <strong>{formatDuration(liveElapsedMs)}</strong>
            <span>
              {classificationState === 'running'
                ? 'live elapsed'
                : liveMetrics.requestCount
                  ? 'last run elapsed'
                  : 'live elapsed'}
            </span>
          </div>
          <div
            title={`${liveMetrics.requestCount} successful requests · ${liveMetrics.inputTokens.toLocaleString()} input tokens · ${liveMetrics.outputTokens.toLocaleString()} free output tokens`}
          >
            <strong>${liveMetrics.costUsd.toFixed(3)}</strong>
            <span>
              {liveMetrics.requestCount} requests ·{' '}
              {classificationState === 'running' || !liveMetrics.requestCount
                ? 'live cost'
                : 'last run cost'}
            </span>
          </div>
          <div className={`jev-status is-${classificationState}`}>
            <i />
            <span>
              {classificationState === 'running'
                ? 'Jev is live'
                : classificationState === 'done'
                  ? 'Live run complete'
                  : classificationState === 'error'
                    ? 'Live run stopped'
                    : 'Ready for live run'}
            </span>
          </div>
        </div>
      </header>

      {classificationState !== 'running' && liveClassifications.size === 0 && (
        <>
          <section className="opening-copy">
            <h2>
              Watch Jev sort {corpus.items.length.toLocaleString()} Hacker News
              posts.
            </h2>
          </section>
          <button
            type="button"
            className="center-play"
            onClick={() => void startLiveClassification()}
          >
            <span>▶</span>
            <strong>Start the live run</strong>
          </button>
          {classificationError && (
            <p className="opening-error">{classificationError}</p>
          )}
        </>
      )}
      {classificationState === 'running' && liveClassifications.size === 0 && (
        <p className="first-batch-note">Waiting for the first Jev batch…</p>
      )}

      {legendOpen && (
        <aside className="legend glass-panel">
          <div className="panel-heading">
            <span>Baseline categories</span>
            <button type="button" onClick={() => setLegendOpen(false)}>
              close
            </button>
          </div>
          <div className="category-list">
            {BASE_CATEGORIES.map((category) => (
              <button
                type="button"
                className={
                  focusedCategory === category.id ? 'is-focused' : undefined
                }
                key={category.id}
                onClick={() =>
                  setFocusedCategory((current) =>
                    current === category.id ? null : category.id,
                  )
                }
              >
                <i className={`category-dot category-${category.id}`} />
                <span>{category.label}</span>
                <strong>
                  {(categoryCounts.get(category.id) ?? 0).toLocaleString()}
                </strong>
              </button>
            ))}
          </div>
        </aside>
      )}

      {commandOpen && (
        <section className="command-center glass-panel">
          <section className="period-switcher" aria-label="Time period">
            {PERIODS.map((option, index) => (
              <button
                type="button"
                key={option.label}
                className={periodIndex === index ? 'is-active' : undefined}
                onClick={() => {
                  clearCustomCategory()
                  setPeriodIndex(index)
                }}
              >
                {option.label}
              </button>
            ))}
          </section>
          <button
            type="button"
            className="command-close"
            onClick={() => setCommandOpen(false)}
          >
            Close
          </button>
        <div className="command-intro">
          <p className="eyebrow">Create a live category</p>
          <h2>
            Type a category. <span>Watch history reorganize.</span>
          </h2>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void reorganize()
          }}
        >
          <div className="command-input">
            <span>⌘</span>
            <input
              value={categoryInput}
              onChange={(event) => setCategoryInput(event.target.value)}
              placeholder='Try “skepticism about AI”'
              aria-label="New category"
              maxLength={120}
            />
            <button
              type="submit"
              disabled={categoryInput.trim().length < 2 || runState === 'running'}
            >
              {runState === 'running' ? 'Judging…' : 'Reorganize'}
            </button>
            {customCategory && (
              <button
                type="button"
                className="reset-button"
                onClick={clearCustomCategory}
              >
                Reset
              </button>
            )}
          </div>
        </form>
        <div className="suggestion-row">
          <span>Prompts</span>
          {SUGGESTIONS.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              disabled={runState === 'running'}
              onClick={() => {
                setCategoryInput(suggestion)
                void reorganize(suggestion)
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
        {customCategory && (
          <div className="run-detail">
            <div className="progress-copy">
              <span>
                {runState === 'done'
                  ? 'Reorganization complete'
                  : runState === 'error'
                    ? runError
                    : `${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()} judged`}
              </span>
              <strong>{matchCount.toLocaleString()} matches</strong>
            </div>
            <div className="progress-track">
              <i style={{ width: `${progressPercent}%` }} />
            </div>
            <label>
              <span>Match threshold</span>
              <input
                type="range"
                min="0.4"
                max="0.95"
                step="0.01"
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
              <strong>{Math.round(threshold * 100)}%</strong>
            </label>
          </div>
        )}
        </section>
      )}

      <nav className="bottom-dock glass-panel" aria-label="Atlas tools">
        <button
          type="button"
          className={legendOpen ? 'is-active' : undefined}
          onClick={() =>
            setLegendOpen((open) => {
              const next = !open
              if (next) setCommandOpen(false)
              return next
            })
          }
        >
          <span className="dock-dots">
            <i className="category-dot category-insight" />
            <i className="category-dot category-argument" />
            <i className="category-dot category-launch" />
          </span>
          Signals
        </button>
        <button
          type="button"
          className={commandOpen ? 'is-active' : undefined}
          disabled={classificationState !== 'done'}
          title={
            classificationState === 'done'
              ? 'Create a new live category'
              : 'Complete the baseline live run first'
          }
          onClick={() => {
            setCommandOpen((open) => {
              const next = !open
              if (next) setLegendOpen(false)
              return next
            })
          }}
        >
          <span className="dock-plus">＋</span>
          {classificationState === 'done'
            ? 'Ask a new category'
            : 'Live categories unlock after baseline'}
        </button>
        {(hoveredItem || classificationError) && (
          <>
            <i className="dock-divider" />
            <span className="dock-note has-item">
              {classificationError
                ? classificationError
                : `${hoveredItem?.year} · ${hoveredLiveClassification?.category ?? 'classified'} · ${Math.round((hoveredLiveClassification?.confidence ?? 0) * 100)}% · ${hoveredItem?.title}`}
            </span>
          </>
        )}
      </nav>
    </main>
  )
}

export default App
