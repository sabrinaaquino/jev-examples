import { useEffect, useRef } from 'react'

import type {
  LiveDecision,
  NliLabel,
  NliPair,
} from '../../shared/types.ts'

const LABELS: Array<{
  id: NliLabel
  title: string
  detail: string
  color: string
}> = [
  {
    id: 'contradiction',
    title: 'Contradiction',
    detail: 'must be false',
    color: '#c94649',
  },
  {
    id: 'neutral',
    title: 'Neutral',
    detail: 'not enough information',
    color: '#a97b00',
  },
  {
    id: 'entailment',
    title: 'Entailment',
    detail: 'must be true',
    color: '#168466',
  },
]

interface Point {
  pair: NliPair
  x: number
  y: number
  jitter: number
  queueX: number
  queueY: number
}

interface Props {
  pairs: NliPair[]
  decisions: Map<string, LiveDecision>
  onHover: (value: { pair: NliPair; decision: LiveDecision } | null) => void
}

const hash = (value: string) => {
  let result = 2166136261
  for (const character of value) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

export function DecisionField({ pairs, decisions, onHover }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointsRef = useRef<Point[]>([])
  const decisionsRef = useRef(decisions)
  const hoveredRef = useRef<string | null>(null)

  useEffect(() => {
    decisionsRef.current = decisions
  }, [decisions])

  useEffect(() => {
    pointsRef.current = pairs.map((pair) => ({
      pair,
      x: 0,
      y: 0,
      jitter: ((hash(pair.id) % 10_000) / 10_000 - 0.5) * 2,
      queueX: (hash(pair.id + 'qx') % 10_000) / 10_000,
      queueY: (hash(pair.id + 'qy') % 10_000) / 10_000,
    }))
  }, [pairs])

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
      const ratio = Math.min(devicePixelRatio || 1, 2)
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
      const top = 126
      const bottom = height - 76
      const laneX: Record<NliLabel, number> = {
        contradiction: width * 0.2,
        neutral: width * 0.5,
        entailment: width * 0.8,
      }
      const plotTop = top + 48
      const plotBottom = bottom
      const similarityY = (value: number) =>
        plotBottom -
        Math.max(0, Math.min(1, value)) * (plotBottom - plotTop)
      const center = { x: width * 0.5, y: (top + bottom) / 2 }

      context.clearRect(0, 0, width, height)
      context.fillStyle = '#f3f0e9'
      context.fillRect(0, 0, width, height)

      context.textAlign = 'center'
      context.textBaseline = 'middle'
      const laneCounts: Record<NliLabel, number> = {
        entailment: 0,
        neutral: 0,
        contradiction: 0,
      }
      for (const decision of decisionsRef.current.values()) {
        laneCounts[decision.label] += 1
      }
      LABELS.forEach((label) => {
        const x = laneX[label.id]
        context.strokeStyle = `${label.color}20`
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(x, top + 43)
        context.lineTo(x, bottom)
        context.stroke()
        context.fillStyle = label.color
        context.font = '600 15px "Avenir Next", Avenir, sans-serif'
        context.fillText(label.title, x, top)
        context.fillStyle = '#625d56'
        context.font = '500 11.5px "Avenir Next", Avenir, sans-serif'
        context.fillText(label.detail, x, top + 20)
        context.font = '500 10px "Avenir Next", Avenir, sans-serif'
        context.fillText(laneCounts[label.id].toLocaleString(), x, top + 36)
      })

      const axisX = width - 27
      context.save()
      context.setLineDash([3, 5])
      context.lineWidth = 1
      context.font = '500 10px "Avenir Next", Avenir, sans-serif'
      for (const value of [0.25, 0.5, 0.75, 1]) {
        const y = similarityY(value)
        context.strokeStyle = 'rgba(98, 93, 86, 0.16)'
        context.beginPath()
        context.moveTo(18, y)
        context.lineTo(axisX, y)
        context.stroke()
        context.fillStyle = '#625d56'
        context.textAlign = 'right'
        context.fillText(`${Math.round(value * 100)}%`, axisX - 7, y - 7)
      }
      context.setLineDash([])
      context.strokeStyle = '#625d56'
      context.lineWidth = 1.25
      context.beginPath()
      context.moveTo(axisX, plotBottom)
      context.lineTo(axisX, plotTop)
      context.lineTo(axisX - 4, plotTop + 7)
      context.moveTo(axisX, plotTop)
      context.lineTo(axisX + 4, plotTop + 7)
      context.stroke()
      context.translate(width - 10, (plotTop + plotBottom) / 2)
      context.rotate(-Math.PI / 2)
      context.fillStyle = '#514d47'
      context.font = '600 11px "Avenir Next", Avenir, sans-serif'
      context.textAlign = 'center'
      context.fillText('Embedding similarity', 0, 0)
      context.restore()

      if (!initialized) {
        pointsRef.current.forEach((point) => {
          point.x = width * 0.24 + point.queueX * width * 0.52
          point.y = bottom - 9 + (point.queueY - 0.5) * 2
        })
        initialized = true
      }

      let waiting = 0
      for (const point of pointsRef.current) {
        const decision = decisionsRef.current.get(point.pair.id)
        let targetX = width * 0.24 + point.queueX * width * 0.52
        let targetY = bottom - 9 + (point.queueY - 0.5) * 2
        let color = '#aaa397'

        if (decision) {
          const similarity = point.pair.embeddingSimilarity ?? 0.65
          targetX = laneX[decision.label] + point.jitter * width * 0.09
          targetY = similarityY(similarity)
          color = LABELS.find((label) => label.id === decision.label)!.color
        } else {
          waiting += 1
        }

        point.x += (targetX - point.x) * 0.085
        point.y += (targetY - point.y) * 0.085
        context.beginPath()
        context.globalAlpha = decision ? 0.78 : 0.12
        context.arc(
          point.x,
          point.y,
          decision ? 1.7 + decision.confidence * 0.9 : 0.9,
          0,
          Math.PI * 2,
        )
        if (decision?.correct === false) {
          context.strokeStyle = '#1b1a18'
          context.lineWidth = 0.8
          context.stroke()
        } else {
          context.fillStyle = color
          context.fill()
        }
      }

      context.globalAlpha = 1
      if (waiting > 0) {
        context.textAlign = 'center'
        context.fillStyle = '#8f887e'
        context.font = '500 11px "Avenir Next", Avenir, sans-serif'
        context.fillText(
          `${waiting.toLocaleString()} pairs awaiting Jev`,
          center.x,
          bottom - 38,
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
    let distanceLimit = 100
    for (const point of pointsRef.current) {
      if (!decisionsRef.current.has(point.pair.id)) continue
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
      className="decision-field"
      aria-label="Live Jev natural-language inference decision field"
      onPointerMove={(event) => {
        const point = findPoint(event)
        const id = point?.pair.id ?? null
        if (id === hoveredRef.current) return
        hoveredRef.current = id
        onHover(
          point
            ? {
                pair: point.pair,
                decision: decisionsRef.current.get(point.pair.id)!,
              }
            : null,
        )
      }}
      onPointerLeave={() => {
        hoveredRef.current = null
        onHover(null)
      }}
    />
  )
}
