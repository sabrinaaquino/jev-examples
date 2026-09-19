import { useEffect, useRef } from 'react'

import { BASE_CATEGORIES } from '../../shared/categories.ts'
import type { AtlasItem, LiveClassification } from '../../shared/types.ts'

const COLORS: Record<string, string> = {
  insight: '#7dd3fc',
  question: '#a5b4fc',
  prediction: '#c4b5fd',
  argument: '#fca5a5',
  joke: '#fde68a',
  launch: '#6ee7b7',
  complaint: '#fb7185',
  explanation: '#67e8f9',
  request: '#fdba74',
  anecdote: '#d8b4fe',
  correction: '#94a3b8',
  other: '#64748b',
  unclassified: '#475569',
}

interface Point {
  item: AtlasItem
  x: number
  y: number
  offsetX: number
  offsetY: number
}

interface Props {
  items: AtlasItem[]
  customCategory: string
  customScores: Map<string, number>
  threshold: number
  yearFrom: number
  yearTo: number
  focusedCategory: string | null
  classifications: Map<string, LiveClassification>
  onHover: (item: AtlasItem | null) => void
}

const hash = (value: string, seed = 2166136261) => {
  let result = seed
  for (const character of value) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

const offsetFor = (id: string) => {
  const angle = ((hash(id) % 10_000) / 10_000) * Math.PI * 2
  const radius = Math.sqrt((hash(id, 8675309) % 10_000) / 10_000)
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

export function AtlasCanvas({
  items,
  customCategory,
  customScores,
  threshold,
  yearFrom,
  yearTo,
  focusedCategory,
  classifications,
  onHover,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointsRef = useRef<Point[]>([])
  const scoresRef = useRef(customScores)
  const classificationsRef = useRef(classifications)
  const stateRef = useRef({
    customCategory,
    threshold,
    yearFrom,
    yearTo,
    focusedCategory,
  })
  const hoveredIdRef = useRef<string | null>(null)

  useEffect(() => {
    scoresRef.current = customScores
  }, [customScores])

  useEffect(() => {
    classificationsRef.current = classifications
  }, [classifications])

  useEffect(() => {
    stateRef.current = {
      customCategory,
      threshold,
      yearFrom,
      yearTo,
      focusedCategory,
    }
  }, [
    customCategory,
    focusedCategory,
    threshold,
    yearFrom,
    yearTo,
  ])

  useEffect(() => {
    pointsRef.current = items.map((item) => {
      const offset = offsetFor(item.id)
      return {
        item,
        x: 0,
        y: 0,
        offsetX: offset.x,
        offsetY: offset.y,
      }
    })
  }, [items])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    let width = 0
    let height = 0
    let frame = 0
    let initialized = false

    const resize = () => {
      const rectangle = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = rectangle.width
      height = rectangle.height
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      initialized = false
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const draw = () => {
      const points = pointsRef.current
      const active = stateRef.current
      const compact = width < 760
      const centerX = width * 0.5
      const stageTop = Math.max(150, height * 0.18)
      const stageBottom = height - Math.max(112, height * 0.14)
      const centerY = (stageTop + stageBottom) / 2
      const orbitX = width * (compact ? 0.34 : 0.36)
      const orbitY = (stageBottom - stageTop) * 0.53
      const clusterRadius = Math.max(
        28,
        Math.min(
          62,
          width * (compact ? 0.047 : 0.052),
          (stageBottom - stageTop) * 0.125,
        ),
      )
      const waitingRadius = Math.max(
        clusterRadius * 1.6,
        Math.min(width, height) * 0.15,
      )
      const customCenter = { x: centerX, y: centerY }
      const centers = new Map<string, { x: number; y: number }>()

      BASE_CATEGORIES.forEach((category, index) => {
        const angle =
          -Math.PI / 2 + (index / BASE_CATEGORIES.length) * Math.PI * 2
        centers.set(category.id, {
          x: centerX + Math.cos(angle) * orbitX,
          y: centerY + Math.sin(angle) * orbitY,
        })
      })
      centers.set('unclassified', { x: centerX, y: centerY })

      if (!initialized) {
        for (const point of points) {
          const classification = classificationsRef.current.get(point.item.id)
          const revealed = classification !== undefined
          const center =
            centers.get(
              revealed ? classification.category : 'unclassified',
            ) ??
            centers.get('unclassified')!
          const spread = revealed ? clusterRadius : waitingRadius
          point.x = center.x + point.offsetX * spread
          point.y = center.y + point.offsetY * spread
        }
        initialized = true
      }

      context.clearRect(0, 0, width, height)
      context.fillStyle = 'rgba(7, 10, 16, 0.18)'
      context.fillRect(0, 0, width, height)
      const counts = new Map<string, number>()
      let customCount = 0

      for (const point of points) {
        const item = point.item
        const classification = classificationsRef.current.get(item.id)
        const revealed = classification !== undefined
        const category = classification?.category ?? 'unclassified'
        const center =
          centers.get(category) ??
          centers.get('unclassified')!
        const spread = revealed ? clusterRadius : waitingRadius
        const baseX = center.x + point.offsetX * spread
        const baseY = center.y + point.offsetY * spread
        const probability = scoresRef.current.get(item.id)
        const strength =
          revealed &&
          active.customCategory &&
          probability !== undefined &&
          probability >= active.threshold
            ? 0.2 +
              0.8 *
                Math.min(
                  1,
                  (probability - active.threshold) /
                    Math.max(0.01, 1 - active.threshold),
                )
            : 0
        const customX =
          customCenter.x + point.offsetX * clusterRadius * 1.35
        const customY =
          customCenter.y + point.offsetY * clusterRadius * 1.35
        const targetX = baseX + (customX - baseX) * strength
        const targetY = baseY + (customY - baseY) * strength
        point.x += (targetX - point.x) * 0.075
        point.y += (targetY - point.y) * 0.075

        const inYear =
          item.year >= active.yearFrom && item.year <= active.yearTo
        const inFocus =
          !active.focusedCategory ||
          (revealed && category === active.focusedCategory)
        context.beginPath()
        context.globalAlpha = inYear && inFocus ? 0.76 : 0.045
        context.fillStyle =
          strength > 0
            ? '#ff7a18'
            : COLORS[category] ?? '#64748b'
        context.arc(
          point.x,
          point.y,
          (item.kind === 'story' ? 1.9 : 1.15) + strength * 1.25,
          0,
          Math.PI * 2,
        )
        context.fill()

        if (inYear && revealed) {
          counts.set(category, (counts.get(category) ?? 0) + 1)
          if (probability !== undefined && probability >= active.threshold) {
            customCount += 1
          }
        }
      }

      context.globalAlpha = 1
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      if (classificationsRef.current.size > 0) {
        for (const category of BASE_CATEGORIES) {
          const center = centers.get(category.id)!
          context.font = '600 11px "Avenir Next", Avenir, sans-serif'
          context.fillStyle =
            active.focusedCategory && active.focusedCategory !== category.id
              ? 'rgba(148, 163, 184, 0.28)'
              : 'rgba(226, 232, 240, 0.76)'
          context.fillText(
            category.label,
            center.x,
            center.y - clusterRadius - 14,
          )
          context.font = '500 9px "Avenir Next", Avenir, sans-serif'
          context.fillStyle = 'rgba(148, 163, 184, 0.62)'
          context.fillText(
            (counts.get(category.id) ?? 0).toLocaleString(),
            center.x,
            center.y - clusterRadius,
          )
        }
      }

      if (active.customCategory) {
        const pulse = 10 + Math.sin(Date.now() / 450) * 3
        context.beginPath()
        context.strokeStyle = 'rgba(255, 122, 24, 0.45)'
        context.lineWidth = 1
        context.arc(
          customCenter.x,
          customCenter.y,
          clusterRadius * 1.5 + pulse,
          0,
          Math.PI * 2,
        )
        context.stroke()
        const label =
          active.customCategory.length > 28
            ? `${active.customCategory.slice(0, 27)}…`
            : active.customCategory
        context.font = '600 11px "Avenir Next", Avenir, sans-serif'
        context.fillStyle = '#ff9a52'
        context.fillText(
          label,
          customCenter.x,
          customCenter.y - clusterRadius * 1.72,
        )
        context.font = '500 9px "Avenir Next", Avenir, sans-serif'
        context.fillStyle = 'rgba(255, 183, 128, 0.8)'
        context.fillText(
          `${customCount.toLocaleString()} matches`,
          customCenter.x,
          customCenter.y - clusterRadius * 1.55,
        )
      }
      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  const findPoint = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rectangle = canvas.getBoundingClientRect()
    const x = event.clientX - rectangle.left
    const y = event.clientY - rectangle.top
    let closest: Point | null = null
    let distanceLimit = 121
    for (const point of pointsRef.current) {
      if (
        !classificationsRef.current.has(point.item.id) ||
        point.item.year < stateRef.current.yearFrom ||
        point.item.year > stateRef.current.yearTo
      ) {
        continue
      }
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2
      if (distance < distanceLimit) {
        closest = point
        distanceLimit = distance
      }
    }
    return closest
  }

  return (
    <canvas
      ref={canvasRef}
      className="atlas-canvas"
      aria-label={`Interactive map of ${items.length.toLocaleString()} Hacker News items`}
      onPointerMove={(event) => {
        const item = findPoint(event)?.item ?? null
        if (hoveredIdRef.current !== item?.id) {
          hoveredIdRef.current = item?.id ?? null
          onHover(item)
        }
      }}
      onPointerLeave={() => {
        hoveredIdRef.current = null
        onHover(null)
      }}
      onClick={(event) => {
        const item = findPoint(event)?.item
        if (item) window.open(item.url, '_blank', 'noopener,noreferrer')
      }}
    />
  )
}
