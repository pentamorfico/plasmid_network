import * as React from "react"
import * as d3 from "d3"
import {
  IconAlertTriangle,
  IconChartArcs,
  IconCircleCheck,
  IconDownload,
  IconMoodEmpty,
  IconRefresh,
  IconMaximize,
  IconMinimize,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type LegendItem = {
  name: string
  swatchColor?: string
  color?: string
}

type Feature = {
  type: string
  name: string
  start: number
  stop: number
  strand: number
  legend?: string
}

type PlasmidData = {
  sequenceLength: number
  sequenceName: string
  sequenceString?: string
  legend: LegendItem[]
  features: Feature[]
  gcPoints: { p: number; v: number }[]
  avgGc: number
}

const REMOTE_BASE =
  "https://raw.githubusercontent.com/pentamorfico/plsdb_imgpr_json/refs/heads/master/"
const MIN_RADIUS = 110
const TRACK_HEIGHT = 18
const REGION_TRACK_OFFSET = 12
const REGION_TRACK_HEIGHT = 10

function buildRemoteUrl(plasmidId: string) {
  const trimmed = plasmidId.trim()
  const baseId = trimmed.endsWith(".json")
    ? trimmed.slice(0, -5)
    : trimmed
  const safeId = encodeURIComponent(baseId)
  return `${REMOTE_BASE}${safeId}.json`
}

function normalizePlasmidJson(payload: any): PlasmidData {
  const raw = payload?.cgview ?? payload
  if (!raw?.sequence || !raw?.features) {
    throw new Error("Invalid plasmid JSON format")
  }

  const contig =
    Array.isArray(raw.sequence?.contigs) && raw.sequence.contigs.length
      ? raw.sequence.contigs[0]
      : raw.sequence
  const sequenceString =
    typeof contig?.seq === "string"
      ? contig.seq
      : typeof raw.sequence === "string"
        ? raw.sequence
        : undefined
  const sequenceLength =
    contig?.length ??
    (typeof raw.sequence?.length === "number"
      ? raw.sequence.length
      : sequenceString?.length ?? 0)
  const sequenceName =
    contig?.name ?? raw.name ?? raw.id ?? "Plasmid"
  const legend: LegendItem[] = Array.isArray(raw.legend?.items)
    ? raw.legend.items
    : Array.isArray(raw.legend)
      ? raw.legend
      : []
  const features: Feature[] = Array.isArray(raw.features)
    ? raw.features
    : []

  const gcPoints: { p: number; v: number }[] = []
  let avgGc = 0
  if (sequenceString && sequenceString.length > 0) {
    const step = Math.max(1, Math.floor(sequenceString.length / 2000))
    const windowSize = Math.max(100, step * 5)
    for (let i = 0; i < sequenceString.length; i += step) {
      const sub = sequenceString.slice(i, i + windowSize)
      if (!sub.length) continue
      const gcCount = (sub.match(/[GC]/gi) ?? []).length
      gcPoints.push({ p: i, v: gcCount / sub.length })
    }
    avgGc = d3.mean(gcPoints, (d: { p: number; v: number }) => d.v) ?? 0
  }

  return {
    sequenceLength,
    sequenceName,
    sequenceString,
    legend,
    features,
    gcPoints,
    avgGc,
  }
}

function arrowPath(
  feature: Feature,
  scale: d3.ScaleLinear<number, number>,
  rInner: number,
  rOuter: number
) {
  let start = scale(Number(feature.start))
  let stop = scale(Number(feature.stop))
  const minAngle = 0.003
  if (Math.abs(stop - start) < minAngle) {
    const mid = (start + stop) / 2
    start = mid - minAngle / 2
    stop = mid + minAngle / 2
  }
  const midR = (rInner + rOuter) / 2
  const arrowHeadRad = 12 / rOuter
  const arrowLen = Math.min(arrowHeadRad, Math.abs(stop - start) * 0.8)
  const toCart = (a: number, r: number) => [
    r * Math.cos(a - Math.PI / 2),
    r * Math.sin(a - Math.PI / 2),
  ]

  if (feature.strand === 1) {
    const bodyEnd = stop - arrowLen
    const [t1x, t1y] = toCart(start, rInner)
    const [t2x, t2y] = toCart(start, rOuter)
    const [h1x, h1y] = toCart(bodyEnd, rInner)
    const [h2x, h2y] = toCart(bodyEnd, rOuter)
    const [tx, ty] = toCart(stop, midR)
    return [
      `M ${t1x} ${t1y}`,
      `A ${rInner} ${rInner} 0 0 1 ${h1x} ${h1y}`,
      `L ${tx} ${ty}`,
      `L ${h2x} ${h2y}`,
      `A ${rOuter} ${rOuter} 0 0 0 ${t2x} ${t2y}`,
      "Z",
    ].join(" ")
  }

  const bodyStart = start + arrowLen
  const [tx, ty] = toCart(start, midR)
  const [h1x, h1y] = toCart(bodyStart, rInner)
  const [h2x, h2y] = toCart(bodyStart, rOuter)
  const [t1x, t1y] = toCart(stop, rInner)
  const [t2x, t2y] = toCart(stop, rOuter)
  return [
    `M ${tx} ${ty}`,
    `L ${h2x} ${h2y}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${t2x} ${t2y}`,
    `L ${t1x} ${t1y}`,
    `A ${rInner} ${rInner} 0 0 0 ${h1x} ${h1y}`,
    "Z",
  ].join(" ")
}

function getColor(legend: LegendItem[], name?: string) {
  if (!name) return "#999"
  const entry = legend.find((item) => item.name === name)
  return entry?.swatchColor ?? entry?.color ?? "#999"
}

function drawGcTrack(
  container: d3.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3.ScaleLinear<number, number>,
  rBase: number,
  data: { p: number; v: number }[],
  avgGc: number
) {
  const innerLimit = rBase - 70
  const outerLimit = rBase - 28
  const rScale = d3
    .scaleLinear()
    .domain([
      d3.min(data, (d: { v: number }) => d.v) ?? 0,
      d3.max(data, (d: { v: number }) => d.v) ?? 1,
    ])
    .range([innerLimit, outerLimit])
  const avgR = rScale(avgGc)
  const area = d3
    .areaRadial<{ p: number; v: number }>()
    .angle((d: { p: number; v: number }) => scale(d.p))
    .innerRadius(avgR)
    .outerRadius((d: { p: number; v: number }) => rScale(d.v))
    .curve(d3.curveLinear)
  const line = d3
    .lineRadial<{ p: number; v: number }>()
    .angle((d: { p: number; v: number }) => scale(d.p))
    .radius((d: { p: number; v: number }) => rScale(d.v))
    .curve(d3.curveLinear)
  const group = container.append("g").attr("class", "layer-gc")
  group.append("path").datum(data).attr("fill", "#6366f1").attr("opacity", 0.18).attr("d", area)
  group.append("path").datum(data).attr("fill", "none").attr("stroke", "#4f46e5").attr("stroke-width", 1).attr("opacity", 0.65).attr("d", line)
}

function drawRuler(
  container: d3.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3.ScaleLinear<number, number>,
  radius: number,
  zoomFactor: number
) {
  const tickCount = Math.max(6, Math.floor(18 * zoomFactor))
  const ticks = scale.ticks(tickCount)
  const gRuler = container.append("g").attr("class", "ruler")
  gRuler
    .selectAll("line")
    .data(ticks)
    .enter()
    .append("line")
    .attr("stroke", "#cbd5e1")
    .attr("transform", (d) => `rotate(${(scale(d) * 180) / Math.PI - 180})`)
    .attr("y1", -radius)
    .attr("y2", -(radius + 5))

  const pxSpace = (2 * Math.PI * radius) / tickCount
  if (pxSpace > 32) {
    gRuler
      .selectAll("text")
      .data(ticks.filter((_, i: number) => i % 2 === 0))
      .enter()
      .append("text")
      .attr("text-anchor", "middle")
      .style("font-size", "9px")
      .style("fill", "#94a3b8")
      .attr("transform", (d) => {
        const a = (scale(d) * 180) / Math.PI
        return `rotate(${a}) ${a > 90 && a < 270 ? `rotate(180,0,-${radius + 13})` : ""}`
      })
      .attr("y", -(radius + 13))
      .text((d) => (d >= 1000 ? `${Math.round(d / 1000)}k` : d))
  }
}

function formatBp(length: number) {
  return `${length.toLocaleString()} bp`
}

function featureLabel(feature: Feature) {
  const name = feature.name?.trim()
  if (!name || name.toLowerCase() === "nan nan" || name === "- -") {
    return feature.legend ?? feature.type
  }
  return name
}

function Tooltip({ innerRef }: { innerRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={innerRef}
      className="pointer-events-none absolute z-20 rounded-md border border-border/60 bg-foreground px-2 py-1 text-[10px] font-semibold text-background opacity-0 shadow-sm transition-opacity"
    />
  )
}

export function PlasmidView({
  plasmidId,
  className,
}: {
  plasmidId?: string | null
  className?: string
}) {
  const [status, setStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [data, setData] = React.useState<PlasmidData | null>(null)
  const [gcVisible, setGcVisible] = React.useState(true)
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const gcVisibleRef = React.useRef(true)

  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const svgRef = React.useRef<SVGSVGElement | null>(null)
  const gContentRef = React.useRef<SVGGElement | null>(null)
  const tooltipRef = React.useRef<HTMLDivElement | null>(null)
  const zoomRef = React.useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const transformRef = React.useRef(d3.zoomIdentity.translate(0, 0).scale(1))
  const dimensionsRef = React.useRef({ width: 360, height: 360 })
  const radiusRef = React.useRef<number>(MIN_RADIUS)
  const dataRef = React.useRef<PlasmidData | null>(null)

  const hideTooltip = React.useCallback(() => {
    if (tooltipRef.current) {
      tooltipRef.current.style.opacity = "0"
    }
  }, [])

  const showTooltip = React.useCallback(
    (event: PointerEvent, feature: Feature) => {
      if (!tooltipRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const left = event.clientX - rect.left
      const top = event.clientY - rect.top
      tooltipRef.current.style.opacity = "1"
      tooltipRef.current.style.left = `${left + 10}px`
      tooltipRef.current.style.top = `${top - 10}px`
      tooltipRef.current.innerHTML = `<div>${featureLabel(feature)}</div><div class="text-xs font-normal">${feature.type} · ${feature.start.toLocaleString()}-${feature.stop.toLocaleString()}</div>`
    },
    []
  )

  const drawPlasmid = React.useCallback(
    (k?: number) => {
      const plasmid = dataRef.current
      if (!plasmid) return
      const group = gContentRef.current ? d3.select(gContentRef.current) : null
      if (!group) return

      // Ensure the group is centered even if the zoom event hasn't fired yet
      const { width, height } = dimensionsRef.current
      const currentTransform =
        transformRef.current ??
        d3.zoomIdentity.translate(width / 2, height / 2).scale(1)
      transformRef.current = currentTransform
      if (gContentRef.current) {
        d3.select(gContentRef.current).attr(
          "transform",
          `translate(${currentTransform.x},${currentTransform.y})`
        )
      }

      group.selectAll("*").remove()

      const zoomK = k ?? transformRef.current.k
      const totalLen = plasmid.sequenceLength || 1
      const scale = d3.scaleLinear().domain([0, totalLen]).range([0, 2 * Math.PI])
      const radius = Math.max(
        MIN_RADIUS,
        Math.min(dimensionsRef.current.width, dimensionsRef.current.height) / 2 - 28
      )
      radiusRef.current = radius
      const rActual = radius * zoomK

      if (plasmid.gcPoints.length > 0 && gcVisibleRef.current) {
        drawGcTrack(group, scale, rActual, plasmid.gcPoints, plasmid.avgGc)
      }

      group
        .append("circle")
        .attr("r", rActual)
        .attr("fill", "none")
        .attr("stroke", "#e2e8f0")
        .attr("stroke-width", TRACK_HEIGHT * 2.1)
        .attr("opacity", 0.6)

      drawRuler(group, scale, rActual + TRACK_HEIGHT + 10, zoomK)

      const cds = plasmid.features.filter((f) => f.type === "CDS")
      const regions = plasmid.features.filter((f) => f.type !== "CDS")

      group
        .selectAll(".cds-path")
        .data(cds)
        .enter()
        .append("path")
        .attr("class", "feature-path")
        .attr("d", (d) => {
          const rIn = d.strand === 1 ? rActual : rActual - TRACK_HEIGHT
          const rOut = d.strand === 1 ? rActual + TRACK_HEIGHT : rActual
          return arrowPath(d, scale, rIn, rOut)
        })
        .attr("fill", (d) => getColor(plasmid.legend, d.legend))
        .attr("stroke", "white")
        .attr("stroke-width", 0.4)
        .on("pointerover", (event: PointerEvent, d: Feature) => {
          const target = event.currentTarget as SVGPathElement | null
          if (target) d3.select(target).attr("opacity", 0.8)
          showTooltip(event, d)
        })
        .on("pointerout", (event: PointerEvent) => {
          const target = event.currentTarget as SVGPathElement | null
          if (target) d3.select(target).attr("opacity", 1)
          hideTooltip()
        })

      const rIn = rActual + TRACK_HEIGHT + REGION_TRACK_OFFSET
      const rOut = rIn + REGION_TRACK_HEIGHT
      const arc = d3
        .arc<Feature>()
        .innerRadius(rIn)
        .outerRadius(rOut)
        .cornerRadius(2)
        .startAngle((d) => scale(Number(d.start)))
        .endAngle((d) => scale(Number(d.stop)))

      group
        .selectAll(".region-path")
        .data(regions)
        .enter()
        .append("path")
        .attr("class", "region-path")
        .attr("d", arc)
        .attr("fill", (d) => getColor(plasmid.legend, d.legend))
        .attr("stroke", "none")
        .attr("opacity", 0.85)
        .on("pointerover", (event: PointerEvent, d: Feature) => {
          const target = event.currentTarget as SVGPathElement | null
          if (target) d3.select(target).attr("opacity", 1)
          showTooltip(event, d)
        })
        .on("pointerout", (event: PointerEvent) => {
          const target = event.currentTarget as SVGPathElement | null
          if (target) d3.select(target).attr("opacity", 0.85)
          hideTooltip()
        })

      const rLabel = rOut + 18
      const labels = group.selectAll(".lbl").data(regions).enter().append("g")
      labels.each(function (d: Feature) {
        const mid = (scale(Number(d.start)) + scale(Number(d.stop))) / 2
        const isRight = mid < Math.PI
        const x1 = Math.cos(mid - Math.PI / 2) * (rLabel - 10)
        const y1 = Math.sin(mid - Math.PI / 2) * (rLabel - 10)
        const x2 = Math.cos(mid - Math.PI / 2) * (rLabel + 14)
        const y2 = Math.sin(mid - Math.PI / 2) * (rLabel + 14)
        const col = getColor(plasmid.legend, d.legend)
        const groupEl = d3.select(this as SVGGElement)
        groupEl
          .append("line")
          .attr("stroke", col)
          .attr("stroke-width", 1)
          .attr("x1", x1)
          .attr("y1", y1)
          .attr("x2", x2)
          .attr("y2", y2)
        groupEl
          .append("text")
          .attr("transform", `translate(${x2},${y2})`)
          .attr("text-anchor", isRight ? "start" : "end")
          .attr("dx", isRight ? 4 : -4)
          .attr("dy", 4)
          .style("font-weight", "600")
          .style("font-size", "11px")
          .style("fill", col)
          .text(featureLabel(d).slice(0, 36))
      })
    },
    [hideTooltip, showTooltip]
  )

  React.useEffect(() => {
    dataRef.current = data
    if (data && status === "ready") {
      drawPlasmid(transformRef.current.k)
    } else if (!data) {
      hideTooltip()
      if (gContentRef.current) {
        d3.select(gContentRef.current).selectAll("*").remove()
      }
    }
  }, [data, status, drawPlasmid, hideTooltip])

  // Force redraw when toggling GC track visibility
  React.useEffect(() => {
    gcVisibleRef.current = gcVisible
    if (status !== "ready") return
    drawPlasmid(transformRef.current.k)
  }, [gcVisible, status, drawPlasmid])

  React.useEffect(() => {
    const host = containerRef.current
    if (!host || svgRef.current) return

    const svg = d3
      .select<HTMLDivElement, unknown>(host)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("preserveAspectRatio", "xMidYMid meet")
      .attr("id", "plasmid-svg")
    svgRef.current = svg.node()

    const g = svg.append("g")
    gContentRef.current = g.node()

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 200])
      .on("zoom", (event) => {
        transformRef.current = event.transform
        if (gContentRef.current) {
          d3.select(gContentRef.current).attr(
            "transform",
            `translate(${event.transform.x},${event.transform.y})`
          )
        }
        requestAnimationFrame(() => drawPlasmid(event.transform.k))
      })

    zoomRef.current = zoom
    svg.call(zoom as any)
  }, [drawPlasmid])

  React.useEffect(() => {
    const host = containerRef.current
    if (!host || !svgRef.current) return

    const updateSize = () => {
      const rect = host.getBoundingClientRect()
      const width = Math.max(280, rect.width || 360)
      const height = Math.max(320, rect.height || 360)
      dimensionsRef.current = { width, height }
      d3.select(svgRef.current).attr("viewBox", `0 0 ${width} ${height}`)
      if (zoomRef.current && svgRef.current) {
        const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(1)
        d3.select(svgRef.current).call(zoomRef.current.transform as any, initialTransform as any)
        transformRef.current = initialTransform
      }
      drawPlasmid(transformRef.current.k)
    }

    updateSize()
    const observer = new ResizeObserver(() => updateSize())
    observer.observe(host)
    return () => observer.disconnect()
  }, [drawPlasmid])

  React.useEffect(() => {
    if (!plasmidId) {
      setStatus("idle")
      setData(null)
      setError(null)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const load = async () => {
      dataRef.current = null
      setData(null)
      setStatus("loading")
      setError(null)
      try {
        const res = await fetch(buildRemoteUrl(plasmidId), { signal: controller.signal })
        if (!res.ok) throw new Error(`Could not fetch ${plasmidId}`)
        const json = await res.json()
        if (cancelled) return
        const parsed = normalizePlasmidJson(json)
        dataRef.current = parsed
        setData(parsed)
        setStatus("ready")
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return
        const message =
          err instanceof Error ? err.message : "Error loading plasmid file"
        setError(message)
        setStatus("error")
        dataRef.current = null
        setData(null)
      }
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [plasmidId])

  const manualZoom = React.useCallback((factor: number) => {
    if (!svgRef.current || !zoomRef.current) return
    d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy as any, factor)
  }, [])

  const resetZoom = React.useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    const { width, height } = dimensionsRef.current
    const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(1)
    d3.select(svgRef.current)
      .transition()
      .duration(350)
      .call(zoomRef.current.transform as any, initialTransform as any)
  }, [])

  const downloadPng = React.useCallback(() => {
    if (!svgRef.current) return
    const svgNode = svgRef.current
    const xml = new XMLSerializer().serializeToString(svgNode)
    const img = new Image()
    img.src = URL.createObjectURL(
      new Blob([xml], { type: "image/svg+xml;charset=utf-8" })
    )
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = 2400
      canvas.height = 2400
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const link = document.createElement("a")
      link.download = `${plasmidId ?? "plasmid"}-map.png`
      link.href = canvas.toDataURL()
      link.click()
      URL.revokeObjectURL(img.src)
    }
  }, [plasmidId])

  const toggleFullscreen = React.useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    if (!document.fullscreenElement) {
      void wrapper.requestFullscreen?.()
    } else {
      void document.exitFullscreen?.()
    }
  }, [])

  React.useEffect(() => {
    const handler = () => {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current)
    }
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  const statusIcon =
    status === "ready"
      ? IconCircleCheck
      : status === "error"
        ? IconAlertTriangle
        : status === "loading"
          ? IconRefresh
          : IconMoodEmpty

  return (
    <Card className={cn("border-muted/70 bg-card/70", className)}>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Plasmid View
            </div>
            <div className="text-sm font-semibold leading-tight">
              {plasmidId ?? "Select a plasmid (click twice if needed)"}
            </div>
          </div>
          <div
            className={cn(
              "flex h-7 items-center gap-1 rounded-full px-3 text-[0.65rem] font-semibold",
              status === "ready"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                : status === "loading"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100"
                  : status === "error"
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-100"
                    : "bg-muted text-muted-foreground"
            )}
          >
            {React.createElement(statusIcon, { className: "size-3.5" })}
            <span className="capitalize">
              {status === "idle" ? "Idle" : status}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-[0.7rem]">
          <div className="flex items-center gap-1.5">
            <span className="text-[0.6rem] uppercase text-muted-foreground">Name</span>
            <span className="font-semibold">
              {data?.sequenceName ?? "—"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[0.6rem] uppercase text-muted-foreground">Length</span>
            <span className="font-semibold">
              {data ? formatBp(data.sequenceLength) : "—"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[0.6rem] uppercase text-muted-foreground">GC</span>
            <span className="font-semibold">
              {data ? `${(data.avgGc * 100).toFixed(1)}%` : "—"}
            </span>
          </div>
        </div>

        <div
          ref={wrapperRef}
          className="relative h-[360px] w-full overflow-hidden rounded-xl border bg-sidebar"
        >
          <div ref={containerRef} className="absolute inset-0" aria-hidden />
          <Tooltip innerRef={tooltipRef} />
          {(status === "idle" || status === "loading" || status === "error") && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-sidebar/80 px-4 text-center backdrop-blur-sm">
              {status === "loading" && (
                <div className="flex max-w-[80%] flex-col items-center gap-2 text-xs leading-snug">
                  <div className="plasmid-spinner text-muted-foreground" aria-hidden />
                  <span>Downloading plasmid…</span>
                </div>
              )}
              {status === "idle" && (
                <div className="max-w-[80%] text-xs leading-snug text-muted-foreground">
                  Select a single plasmid to display the map
                </div>
              )}
              {status === "error" && (
                <div className="max-w-[80%] text-xs leading-snug text-rose-500">
                  {error ?? "Could not load plasmid"}
                </div>
              )}
            </div>
          )}

          <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border/70 bg-card/70 px-2 py-1 shadow-sm backdrop-blur">
            <Button
              variant={gcVisible ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setGcVisible((prev) => !prev)}
              disabled={!data}
              aria-label="Toggle GC track"
              aria-pressed={gcVisible}
            >
              <IconChartArcs className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => manualZoom(1.4)}
              disabled={!data}
              aria-label="Zoom in"
            >
              <IconZoomIn className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => manualZoom(0.7)}
              disabled={!data}
              aria-label="Zoom out"
            >
              <IconZoomOut className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={resetZoom}
              disabled={!data}
              aria-label="Reset zoom"
            >
              <IconRefresh className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={downloadPng}
              disabled={!data}
              aria-label="Download map"
            >
              <IconDownload className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleFullscreen}
              disabled={!data}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <IconMinimize className="size-4" />
              ) : (
                <IconMaximize className="size-4" />
              )}
            </Button>
          </div>
        </div>

        {data?.legend?.length ? (
          <div className="space-y-2">
            <div className="text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Legend
            </div>
            <div className="grid grid-cols-2 gap-2 text-[0.7rem]">
              {data.legend.map((item) => (
                <div key={item.name} className="flex items-center gap-2 rounded-md border px-2 py-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: item.swatchColor ?? item.color ?? "#999" }}
                  />
                  <span className="truncate">{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
