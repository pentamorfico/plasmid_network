import * as React from "react"

import {
  Cosmograph,
  CosmographPopup,
  CosmographProvider,
  CosmographSizeLegend,
  CosmographTypeColorLegend,
  CosmographRangeColorLegend,
  type CosmographConfig,
  type CosmographRef,
} from "@cosmograph/react"
import type { CosmographSizeLegendRef } from "@cosmograph/react/components/size-legend"
import { useTheme } from "next-themes"
import iwanthue from "iwanthue"
import { getSequentialColors } from "dicopal"
import { sql, and, isNotNull, column } from "@uwdata/mosaic-sql"

const BASE_URL = import.meta.env.BASE_URL

const DEFAULT_CONFIG: CosmographConfig = {
  spaceSize: 8192,
  backgroundColor: [10, 12, 18, 1],
  pointColor: [160, 105, 180, 0.75],
  linkColor: [80, 94, 120, 0.7],
  statusIndicatorMode: false,
  componentsDisplayStateMode: false,
  selectPointOnClick: true,
  focusPointOnClick: true,
  selectPointOnLabelClick: true,
  selectClusterOnLabelClick: true,
  focusPointOnLabelClick: true,
  showHoveredPointLabel: false,
  pointSizeStrategy: "single",
  pointDefaultSize: 10,
  linkWidthStrategy: "single",
  linkDefaultWidth: 0.8,
  pointSizeScale: 10,
  pointGreyoutOpacity: 0.01,
  enableSimulation: false,
  curvedLinks: false,
  pointOpacity: 0.7,
  scalePointsOnZoom: true,
  showFPSMonitor: false,
  linkGreyoutOpacity: 0.005,
  linkOpacity: 0.15,
  showClusterLabels: false,
  usePointColorStrategyForClusterLabels: false,
}

const DARK_BG: [number, number, number, number] = [18, 19, 20, 1]
const LIGHT_BG: [number, number, number, number] = [247, 247, 247, 1]
const DARK_LINK: [number, number, number, number] = [255, 255, 255, 0.28]
const LIGHT_LINK: [number, number, number, number] = [15, 23, 42, 0.28]

const SPINNER_CX = 125
const SPINNER_CY = 125

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  }
}

function createGenePath(opts: {
  startAngle: number
  lengthAngle: number
  tipLengthAngle: number
  R_in: number
  R_out: number
  flare: number
}) {
  const { startAngle, lengthAngle, tipLengthAngle, R_in, R_out, flare } = opts
  const R_mid = (R_in + R_out) / 2
  const shoulderAngle = startAngle + lengthAngle
  const tipAngle = shoulderAngle + tipLengthAngle

  const p1 = polarToCartesian(SPINNER_CX, SPINNER_CY, R_in, startAngle)
  const p2 = polarToCartesian(SPINNER_CX, SPINNER_CY, R_out, startAngle)
  const p3 = polarToCartesian(SPINNER_CX, SPINNER_CY, R_out, shoulderAngle)
  const p4 = polarToCartesian(SPINNER_CX, SPINNER_CY, R_out + flare, shoulderAngle)
  const p5 = polarToCartesian(SPINNER_CX, SPINNER_CY, R_mid, tipAngle)
  const p6 = polarToCartesian(SPINNER_CX, SPINNER_CY, R_in - flare, shoulderAngle)
  const p7 = polarToCartesian(SPINNER_CX, SPINNER_CY, R_in, shoulderAngle)

  const largeArcFlag = lengthAngle > 180 ? "1" : "0"

  return [
    `M ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${R_out} ${R_out} 0 ${largeArcFlag} 1 ${p3.x} ${p3.y}`,
    `L ${p4.x} ${p4.y}`,
    `L ${p5.x} ${p5.y}`,
    `L ${p6.x} ${p6.y}`,
    `L ${p7.x} ${p7.y}`,
    `A ${R_in} ${R_in} 0 ${largeArcFlag} 0 ${p1.x} ${p1.y}`,
    "Z",
  ].join(" ")
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function buildTooltipContent(
  id: string,
  colorBy?: string,
  colorValue?: string
) {
  const safeId = escapeHtml(id)
  const safeLabel = colorBy ? escapeHtml(colorBy) : ""
  const safeValue = colorValue ? escapeHtml(colorValue) : "—"

  return `
    <div class="plasmid-tooltip">
      <div class="plasmid-tooltip__title">${safeId}</div>
      ${
        colorBy
          ? `<div class="plasmid-tooltip__row">
               <span class="plasmid-tooltip__label">${safeLabel}</span>
               <span class="plasmid-tooltip__value">${safeValue}</span>
             </div>`
          : ""
      }
    </div>
  `
}

async function fetchFile(url: string, name: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}`)
  const buffer = await res.arrayBuffer()
  return new File([buffer], name)
}

function findColumnSummary(
  summaries: Record<string, unknown>[] | undefined,
  columnName?: string
) {
  if (!summaries?.length || !columnName) return undefined
  return summaries.find((entry) =>
    ["column", "column_name", "name"].some(
      (key) => entry?.[key] === columnName
    )
  )
}

function getColumnType(summary?: Record<string, unknown>) {
  if (!summary) return ""
  const candidateKeys = ["column_type", "type", "data_type", "logical_type"]
  for (const key of candidateKeys) {
    const value = summary[key]
    if (typeof value === "string") return value.toLowerCase()
  }
  return ""
}

function isNumericType(type: string) {
  return /(int|double|float|decimal|numeric|real)/.test(type)
}

function getApproxUnique(summary?: Record<string, unknown>) {
  if (!summary) return undefined
  const candidateKeys = ["approx_unique", "approx_unique_count", "approx_distinct"]
  for (const key of candidateKeys) {
    const value = summary[key]
    const num = typeof value === "number" ? value : Number(value)
    if (!Number.isNaN(num) && num > 0) return num
  }
  return undefined
}

function palettesEqual(a?: string[], b?: string[]) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((color, idx) => color === b[idx])
}


const MAX_PALETTE_SIZE = 50

function clampPaletteSize(value?: number) {
  if (!Number.isFinite(value) || value === undefined) return 16
  return Math.min(Math.max(Math.round(value), 3), MAX_PALETTE_SIZE)
}

export function NetworkCosmograph({
  showLinks,
  showLabels,
  labelType,
  colorBy,
  pointSize,
  linkOpacity,
  pointGreyoutOpacity,
  linkGreyoutOpacity,
  hideNoMetadata,
  hideIMGPR,
  onColorOptions,
  onColorByResolved,
  onColumnDisplayNames,
  onColumnCategories,
  onNumericColumns,
  selectedPointIndices,
  onSelectionChange,
  polygonSelectionActive,
  onPolygonSelectionFinished,
  onLargeSelectionFinished,
  onPointSelected,
  onPointsDataLoaded,
}: {
  showLinks: boolean
  showLabels: boolean
  labelType: 'points' | 'clusters'
  colorBy?: string
  pointSize?: number
  linkOpacity?: number
  pointGreyoutOpacity?: number
  linkGreyoutOpacity?: number
  hideNoMetadata?: boolean
  hideIMGPR?: boolean
  onColorOptions?: (options: string[]) => void
  onColorByResolved?: (value: string | undefined) => void
  onColumnDisplayNames?: (names: Record<string, string>) => void
  onColumnCategories?: (categories: Record<string, string[]>) => void
  onNumericColumns?: (columns: Set<string>) => void
  selectedPointIndices?: number[]
  onSelectionChange?: (indices: number[]) => void
  polygonSelectionActive?: boolean
  onPolygonSelectionFinished?: (indices: number[]) => void
  onLargeSelectionFinished?: (indices: number[]) => void
  onPointSelected?: (rowIndex: number | null) => void
  onPointsDataLoaded?: (
    dataSource: unknown,
    columns: string[],
    totalRows: number
  ) => void
}) {
  const initialThemeIsDark =
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark") ||
        localStorage.getItem("theme") === "dark"
      : false
  const [config, setConfig] = React.useState<CosmographConfig>(() => ({
    ...DEFAULT_CONFIG,
    backgroundColor: initialThemeIsDark ? DARK_BG : LIGHT_BG,
    linkColorStrategy: "single",
    linkDefaultColor: initialThemeIsDark ? DARK_LINK : LIGHT_LINK,
    pointDefaultSize: pointSize ?? DEFAULT_CONFIG.pointDefaultSize,
    linkOpacity: linkOpacity ?? DEFAULT_CONFIG.linkOpacity,
    pointGreyoutOpacity: pointGreyoutOpacity ?? DEFAULT_CONFIG.pointGreyoutOpacity,
    linkGreyoutOpacity: linkGreyoutOpacity ?? DEFAULT_CONFIG.linkGreyoutOpacity,
  }))
  const [loadPhase, setLoadPhase] = React.useState<
    "fetching" | "uploading" | "validating" | "rendering" | "ready"
  >("fetching")
  const [currentColorStrategy, setCurrentColorStrategy] = React.useState<
    "categorical" | "continuous"
  >("categorical")
  const [colorScale, setColorScale] = React.useState<"linear" | "log2" | "log10">("linear")
  const [numericColumns, setNumericColumns] = React.useState<Set<string>>(new Set())
  const [logColumnMapping, setLogColumnMapping] = React.useState<Record<string, { log2: string | null; log10: string | null }>>({})
  const [baseColorColumn, setBaseColorColumn] = React.useState<string | undefined>(undefined)
  const [error, setError] = React.useState<string | null>(null)
  const paletteCacheRef = React.useRef<
    Map<string, { palette: string[]; strategy: "categorical" | "continuous" }>
  >(new Map())
  const [dataFiles, setDataFiles] = React.useState<{
    points?: File
    links?: File
  }>({})
  const cosmographRef = React.useRef<CosmographRef>(null)
  const pointsDataLoadedRef = React.useRef(false)
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null)
  const [hoveredContent, setHoveredContent] = React.useState<string>("")
  const hoverRequestId = React.useRef(0)
  const sizeLegendRef = React.useRef<CosmographSizeLegendRef>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const hasData = Boolean(dataFiles.points && dataFiles.links)
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const [legendSortBy, setLegendSortBy] = React.useState<"count" | "label">("count")
  const legendRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  
  React.useEffect(() => {
    if (!legendRef.current) return
    
    const adjustWidth = () => {
      const labels = legendRef.current?.querySelectorAll('[class*="label"]')
      if (!labels || labels.length === 0) return
      
      let maxWidth = 200
      labels.forEach((label) => {
        const width = (label as HTMLElement).scrollWidth
        if (width > maxWidth) maxWidth = width
      })
      
      if (legendRef.current) {
        legendRef.current.style.width = `${Math.min(maxWidth + 50, window.innerWidth * 0.9)}px`
      }
    }
    
    adjustWidth()
    const observer = new MutationObserver(adjustWidth)
    observer.observe(legendRef.current, { childList: true, subtree: true })
    
    return () => observer.disconnect()
  }, [colorBy, legendSortBy, currentColorStrategy])

  const effectiveTheme = mounted
    ? resolvedTheme ?? (initialThemeIsDark ? "dark" : "light")
    : initialThemeIsDark
      ? "dark"
      : "light"
  const isDark = effectiveTheme === "dark"
  const backgroundColor = React.useMemo<[number, number, number, number]>(
    () => (isDark ? DARK_BG : LIGHT_BG),
    [isDark]
  )
  const legendText = React.useMemo(
    () => (isDark ? "#f9fafb" : "#0f172a"),
    [isDark]
  )
  const legendBg = React.useMemo(
    () => (isDark ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.7)"),
    [isDark]
  )
  const linkDefaultColor = React.useMemo<[number, number, number, number]>(
    () => (isDark ? [100, 100, 100, 0.28] : [145, 143, 142, 0.28]),
    [isDark]
  )
  const clusterLabelColor = React.useMemo<[number, number, number, number]>(
    () => (isDark ? [255, 255, 255, 1] : [0, 0, 0, 1]),
    [isDark]
  )
  const legendStyles = React.useMemo(
    () =>
      ({
        "--cosmograph-ui-background": legendBg,
        "--cosmograph-ui-text": legendText,
        "--cosmograph-size-legend-font-color": legendText,
        "--cosmograph-size-legend-form-color": legendText,
        "--cosmograph-size-legend-hover-color": legendText,
        "--cosmograph-color-legend-type-font-color": legendText,
        "--cosmograph-color-legend-type-hover-color": legendText,
        "--cosmograph-color-legend-type-others-color": legendText,
        "--cosmograph-color-legend-type-unknown-color": legendText,
        "--cosmograph-color-legend-range-font-color": legendText,
        "--cosmograph-color-legend-range-hover-color": legendText,
      } as React.CSSProperties),
    [legendBg, legendText]
  )

  const handleGraphRebuilt = React.useCallback(() => {
    setLoadPhase("ready")
  }, [])

  React.useEffect(() => {
    sizeLegendRef.current?.hide()
  }, [])

  React.useEffect(() => {
    if (!colorBy) return
    setConfig((prev) =>
      prev.pointColorBy === colorBy ? prev : { ...prev, pointColorBy: colorBy }
    )
    
    
    if (!colorBy.startsWith('log2_') && !colorBy.startsWith('log10_')) {
      setBaseColorColumn(colorBy)
      setColorScale('linear') 
    }
  }, [colorBy])

  React.useEffect(() => {
    setConfig((prev) => ({
      ...prev,
      backgroundColor,
      pointDefaultSize: pointSize ?? prev.pointDefaultSize,
      linkOpacity: linkOpacity ?? prev.linkOpacity,
      pointGreyoutOpacity: pointGreyoutOpacity ?? prev.pointGreyoutOpacity,
      linkGreyoutOpacity: linkGreyoutOpacity ?? prev.linkGreyoutOpacity,
    }))
  }, [backgroundColor, pointSize, linkOpacity, pointGreyoutOpacity, linkGreyoutOpacity])

  React.useEffect(() => {
    setConfig((prev) => ({
      ...prev,
      linkColorStrategy: "single",
      linkDefaultColor,
    }))
  }, [linkDefaultColor])

  React.useEffect(() => {
    const showClusterLabels = showLabels && labelType === 'clusters'
    const showPointLabels = showLabels && labelType === 'points'
    
    const useColorForClusterLabels = labelType === 'clusters' && colorBy === 'PTU cluster'
    setConfig((prev) => ({
      ...prev,
      showClusterLabels,
      pointLabelBy: showPointLabels ? 'id' : undefined,
      usePointColorStrategyForClusterLabels: useColorForClusterLabels,
      clusterLabelColor: useColorForClusterLabels ? undefined : clusterLabelColor,
    }))
  }, [showLabels, labelType, colorBy, clusterLabelColor])

  
  const filterSourceRef = React.useRef({ id: 'custom-filter' })

  
  React.useEffect(() => {
    const cg = cosmographRef.current as any
    if (!cg) return
    
    
    const selection = cg.pointsSelection
    if (!selection) {
      console.log('[Filter] pointsSelection not available yet')
      return
    }
    
    
    const conditions: any[] = []
    
    
    if (hideNoMetadata && colorBy) {
      const col = column(colorBy)
      conditions.push(isNotNull(col))
      conditions.push(sql`CAST(${col} AS VARCHAR) != ''`)
    }
    
    if (hideIMGPR) {
      conditions.push(sql`NOT "id" LIKE 'IMGPR%'`)
    }
    
    if (conditions.length > 0) {
      const predicate = conditions.length === 1 ? conditions[0] : and(...conditions)
      console.log('[Filter] Applying filter with predicate')
      
      try {
        const filterClause = {
          source: filterSourceRef.current,
          value: { hideNoMetadata, hideIMGPR, colorBy },
          predicate,
        }
        selection.update(filterClause)
      } catch (err) {
        console.warn('[Filter] Error applying filter:', err)
      }
    } else {
      try {
        const clearClause = {
          source: filterSourceRef.current,
          value: null,
          predicate: null,
        }
        selection.update(clearClause)
      } catch (err) {
        console.warn('[Filter] Error clearing filter:', err)
      }
    }
  }, [hideNoMetadata, hideIMGPR, colorBy])

  React.useEffect(() => {
    setConfig((prev) => {
      if (prev.onGraphRebuilt === handleGraphRebuilt) return prev
      return { ...prev, onGraphRebuilt: handleGraphRebuilt }
    })
  }, [handleGraphRebuilt])

  const handlePointMouseOver = React.useCallback((index: number) => {
    setHoveredIndex(index)
  }, [])

  const handlePointMouseOut = React.useCallback(() => {
    setHoveredIndex(null)
  }, [])

  React.useEffect(() => {
    setConfig((prev) => {
      if (
        prev.onPointMouseOver === handlePointMouseOver &&
        prev.onPointMouseOut === handlePointMouseOut
      ) {
        return prev
      }
      return {
        ...prev,
        onPointMouseOver: handlePointMouseOver,
        onPointMouseOut: handlePointMouseOut,
      }
    })
  }, [handlePointMouseOver, handlePointMouseOut])


  const handlePointClick = React.useCallback(
    (index?: number | null) => {
      if (polygonSelectionActive) return
      if (!onPointSelected) return
      if (index === null || index === undefined || Number.isNaN(index)) {
        onPointSelected(null)
        onSelectionChange?.([])
        return
      }
      onPointSelected(index)
      onSelectionChange?.([index])
    },
    [onPointSelected, onSelectionChange, polygonSelectionActive]
  )

  const handleLabelClick = React.useCallback(
    (index?: number | null) => {
      if (polygonSelectionActive) return
      if (!onPointSelected) return
      if (index === null || index === undefined || Number.isNaN(index)) {
        onPointSelected(null)
        onSelectionChange?.([])
        return
      }
      onPointSelected(index)
      onSelectionChange?.([index])
    },
    [onPointSelected, onSelectionChange, polygonSelectionActive]
  )

  React.useEffect(() => {
    if (!onPointSelected) return
    setConfig((prev) => {
      if (
        prev.onPointClick === handlePointClick &&
        prev.onLabelClick === handleLabelClick
      ) {
        return prev
      }
      return {
        ...prev,
        onPointClick: handlePointClick,
        onLabelClick: handleLabelClick,
      }
    })
  }, [handlePointClick, handleLabelClick, onPointSelected])

  const selectionFromCosmographRef = React.useRef(false)
  const applyingExternalSelectionRef = React.useRef(false)

  React.useEffect(() => {
    if (!hasData) return
    if (!Array.isArray(selectedPointIndices)) return
    const cg = cosmographRef.current as any
    if (!cg) return

    if (selectionFromCosmographRef.current) {
      selectionFromCosmographRef.current = false
      return
    }

    applyingExternalSelectionRef.current = true
    
    const sorted = [...selectedPointIndices].sort((a, b) => a - b)
    lastSelectionRef.current = sorted

    const applySelection = async () => {
      try {
        await cg.dataUploaded?.()
      } catch {
      }
      if (!cg?.selectPoints) {
        applyingExternalSelectionRef.current = false
        return
      }
      if (selectedPointIndices.length === 0) {
        cg.unselectAllPoints?.()
      } else {
        cg.selectPoints(selectedPointIndices, false)
      }
      setTimeout(() => {
        applyingExternalSelectionRef.current = false
      }, 100)
    }

    void applySelection()
  }, [hasData, selectedPointIndices])

  React.useEffect(() => {
    const cg = cosmographRef.current as any
    if (!cg) return
    if (polygonSelectionActive) {
      cg.activatePolygonalSelection?.()
    } else {
      cg.deactivatePolygonalSelection?.()
    }
  }, [polygonSelectionActive])

  const selectionRequestIdRef = React.useRef<number>(0)
  const lastSelectionRef = React.useRef<number[]>([])
  const selectionCheckIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  React.useEffect(() => {
    if (!onPointSelected) return
    const cg = cosmographRef.current as any
    if (!cg) return

    const arraysEqual = (a: number[], b: number[]) => {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false
      }
      return true
    }

    const checkSelection = () => {
      if (applyingExternalSelectionRef.current) return
      
      const currentSelection = cg?.getSelectedPointIndices?.() ?? cg?.getSelectedIndices?.()
      const arr = Array.isArray(currentSelection) ? currentSelection : []
      const filtered = arr.filter((v: number) => Number.isInteger(v) && v >= 0)
      
      if (arraysEqual(filtered, lastSelectionRef.current)) return
      
      lastSelectionRef.current = [...filtered]
      ++selectionRequestIdRef.current

      selectionFromCosmographRef.current = true

      if (filtered.length === 0) {
        onPointSelected(null)
        onSelectionChange?.([])
      } else {

        if (filtered.length > 1) {
          onLargeSelectionFinished?.(filtered)
        } else {
          onSelectionChange?.(filtered)
        }
      }
    }

    selectionCheckIntervalRef.current = setInterval(checkSelection, 30)

    return () => {
      if (selectionCheckIntervalRef.current) {
        clearInterval(selectionCheckIntervalRef.current)
        selectionCheckIntervalRef.current = null
      }
    }
  }, [onPointSelected, onSelectionChange, onLargeSelectionFinished, hasData])

  React.useEffect(() => {
    if (!onPointSelected) return
    const cg = cosmographRef.current as any
    if (!cg?.addEventListener || !cg?.removeEventListener) return

    const handleReset = () => {
      lastSelectionRef.current = []
      selectionFromCosmographRef.current = true
      onPointSelected(null)
      onSelectionChange?.([])
      onLargeSelectionFinished?.([])
    }

    cg.addEventListener("resetSelections", handleReset)
    cg.addEventListener("reset", handleReset)
    return () => {
      cg.removeEventListener("resetSelections", handleReset)
      cg.removeEventListener("reset", handleReset)
    }
  }, [onPointSelected, onSelectionChange, onLargeSelectionFinished, hasData])

  React.useEffect(() => {
    setConfig((prev) => {
      const next = {
        ...prev,
        onPolygonSelected: () => {
          const readSelection = () => {
            const instance = cosmographRef.current as any
            const raw =
              instance?.getSelectedPointIndices?.() ??
              instance?.getSelectedIndices?.()
            const arr = Array.isArray(raw)
              ? raw
              : raw && typeof raw.length === "number"
                ? Array.from(raw as ArrayLike<number>)
                : undefined
            return arr && arr.length > 0 ? arr : null
          }

          const emitSelection = (indices: number[] | null) => {
            selectionFromCosmographRef.current = true
            if (indices && indices.length > 0) {
              const filtered = indices.filter(
                (v) => Number.isInteger(v) && v >= 0
              )
              onSelectionChange?.(filtered)
              onPolygonSelectionFinished?.(filtered)
            } else {
              onSelectionChange?.([])
              onPolygonSelectionFinished?.([])
            }
          }

          let emitted = false
          const attempts = [0, 50, 150]
          attempts.forEach((delay, idx) => {
            setTimeout(() => {
              if (emitted) return  
              const selection = readSelection()
              if (selection || idx === attempts.length - 1) {
                emitted = true
                emitSelection(selection)
              }
            }, delay)
          })
        },
      } satisfies Partial<CosmographConfig>

      return prev.onPolygonSelected === next.onPolygonSelected ? prev : { ...prev, ...next }
    })
  }, [onSelectionChange, onPolygonSelectionFinished])

  React.useEffect(() => {
    if (hoveredIndex === null) {
      setHoveredContent("")
      return
    }
    const requestId = ++hoverRequestId.current
    setHoveredContent(buildTooltipContent(String(hoveredIndex), colorBy))
    const cg = cosmographRef.current as any
    if (!cg?.getPointsByIndices) return

    const loadContent = async () => {
      try {
        const raw = await cg.getPointsByIndices([hoveredIndex])
        const rows: any[] | undefined = Array.isArray(raw)
          ? raw
          : raw?.toArray?.()
        const row = rows?.[0] ?? {}
        const idValue = row?.id ?? String(hoveredIndex)
        const colorValue =
          colorBy && row && colorBy in row ? String(row[colorBy]) : undefined
        if (hoverRequestId.current !== requestId) return
        setHoveredContent(buildTooltipContent(String(idValue), colorBy, colorValue))
      } catch {
        if (hoverRequestId.current !== requestId) return
        setHoveredContent(buildTooltipContent(String(hoveredIndex), colorBy))
      }
    }

    void loadContent()
  }, [hoveredIndex, colorBy])


  const loadPalettesFromFile = React.useCallback(async () => {
    if (paletteCacheRef.current.size > 0) {
      console.log('[loadPalettesFromFile] Palettes already loaded')
      return
    }
    
    try {
      console.log('[loadPalettesFromFile] Loading pre-generated palettes...')
      const response = await fetch(`${BASE_URL}data/color-palettes.json`)
      if (!response.ok) {
        console.warn('[loadPalettesFromFile] Could not load palettes file, will generate on demand')
        return
      }
      
      const data = await response.json()
      
      
      
      
      if (data.columns) {
        const columns = data.columns as Record<string, { 
          strategy: 'categorical' | 'continuous'
          palette: string[]
        }>
        for (const [colName, { strategy, palette }] of Object.entries(columns)) {
          paletteCacheRef.current.set(colName, { palette, strategy })
        }
        console.log(`[loadPalettesFromFile] Loaded ${Object.keys(columns).length} palettes from file (extended format)`)
      } else {
        
        for (const [colName, palette] of Object.entries(data as Record<string, string[]>)) {
          paletteCacheRef.current.set(colName, { palette, strategy: 'categorical' })
        }
        console.log(`[loadPalettesFromFile] Loaded ${Object.keys(data).length} palettes from file (simple format)`)
      }
    } catch (error) {
      console.warn('[loadPalettesFromFile] Error loading palettes:', error)
    }
  }, [])

  const updateColorPalette = React.useCallback(() => {
    const cg = cosmographRef.current
    const colorBy = config.pointColorBy
    if (!cg || !colorBy) return

    const applyPalette = (
      palette: string[],
      strategy: "categorical" | "continuous"
    ) => {
      paletteCacheRef.current.set(colorBy, { palette, strategy })
      setCurrentColorStrategy(strategy)
      setConfig((prev) => {
        if (
          prev.pointColorStrategy === strategy &&
          palettesEqual(prev.pointColorPalette, palette)
        ) {
          return prev
        }
        return {
          ...prev,
          pointColorStrategy: strategy,
          pointColorPalette: palette,
        }
      })
    }

    const cached = paletteCacheRef.current.get(colorBy)
    if (cached) {
      applyPalette(cached.palette, cached.strategy)
      return
    }

    const summaryEntry = findColumnSummary(
      (cg as any)?.stats?.pointsSummary,
      colorBy
    )
    const columnType = getColumnType(summaryEntry)
    const approxUnique = getApproxUnique(summaryEntry)

    
    if (numericColumns.has(colorBy) || isNumericType(columnType)) {
      const palette = getSequentialColors("Viridis", 9)
      if (palette) {
        applyPalette(palette, "continuous")
      }
      return
    }

    const palette = iwanthue(clampPaletteSize(approxUnique), {
      seed: colorBy,
      clustering: "k-means",
      quality: 100,
      distance: "cmc",
      colorSpace: {
        hmin: 0,
        hmax: 360,
        cmin: 35,
        cmax: 100,
        lmin: 30,
        lmax: 80,
      },
    })
    applyPalette(palette, "categorical")
  }, [config.pointColorBy])

  React.useEffect(() => {
    const loadPrepared = async () => {
      setLoadPhase("fetching")
      setError(null)
      try {
        
        const cacheBuster = `?v=${Date.now()}`
        const [pointsFile, linksFile, configJson] = await Promise.all([
          fetchFile(`${BASE_URL}data/plasmid-network-points.parquet${cacheBuster}`, "points.parquet"),
          fetchFile(`${BASE_URL}data/plasmid-network-links.parquet${cacheBuster}`, "links.parquet"),
          fetch(`${BASE_URL}data/plasmid-network-config.json${cacheBuster}`).then(async (res) => {
            if (!res.ok) return {}
            return res.json()
          }),
        ])

        const providedColor =
          colorBy && colorBy.length > 0 ? colorBy : undefined
        let resolvedColor: string | undefined
        const optionList: string[] = []
        const optionsSet = new Set<string>()
        const excludeFromColorBy = new Set<string>(configJson.pointExcludeFromColorBy || [])
        
        excludeFromColorBy.add('x')
        excludeFromColorBy.add('y')
        
        const addOption = (val?: string) => {
          if (val && !excludeFromColorBy.has(val) && !optionsSet.has(val)) {
            optionsSet.add(val)
            optionList.push(val)
          }
        }

        
        if (Array.isArray(configJson.pointIncludeColumns)) {
          configJson.pointIncludeColumns.forEach(addOption)
        }
        
        addOption(configJson.pointColorBy)
        addOption(configJson.pointSizeBy)
        addOption(configJson.pointLabelBy)
        addOption(configJson.pointClusterBy)

        const defaultColorBy =
          providedColor ??
          configJson.pointColorBy ??
          optionList[0] ??
          config.pointColorBy

        resolvedColor = defaultColorBy

        
        const iwanthueOptions = {
          clustering: "k-means" as const,
          quality: 100,
          distance: "cmc" as const,
          colorSpace: {
            hmin: 0,
            hmax: 360,
            cmin: 35,
            cmax: 100,
            lmin: 30,
            lmax: 80,
          },
        }
        
        const initialPalette = iwanthue(clampPaletteSize(32), {
          seed: resolvedColor ?? "plasmid",
          ...iwanthueOptions,
        })

        setConfig((prev) => ({
          ...DEFAULT_CONFIG,
          ...prev,
          ...configJson,
          backgroundColor,
          statusIndicatorMode: false,
          componentsDisplayStateMode: false,
          pointColorBy: resolvedColor ?? prev.pointColorBy,
          pointClusterBy: configJson.pointClusterBy ?? 'PTU cluster',
          pointColorStrategy: "categorical",
          pointColorPalette: initialPalette,
          showClusterLabels: showLabels && labelType === 'clusters',
          pointLabelBy: showLabels && labelType === 'points' ? 'id' : undefined,
          usePointColorStrategyForClusterLabels: true,
        }))
        onColorOptions?.(optionList)
        onColorByResolved?.(resolvedColor)
        onColumnDisplayNames?.(configJson.columnDisplayNames || {})
        onColumnCategories?.(configJson.columnCategories || {})
        const numCols = new Set<string>(configJson.numericColumns || [])
        setNumericColumns(numCols)
        onNumericColumns?.(numCols)
        setLogColumnMapping(configJson.logColumnMapping || {})
        setBaseColorColumn(resolvedColor)
        setLoadPhase("uploading")
        setDataFiles({ points: pointsFile, links: linksFile })
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading data")
        setLoadPhase("fetching")
      } finally {
        
      }
    }

    loadPrepared()
  }, [])

  React.useEffect(() => {
    const cg = cosmographRef.current as any
    if (!cg?.addEventListener || !cg?.removeEventListener) return

    const handleDataUploaded = () => {
      setLoadPhase((prev) => (prev === "ready" ? "ready" : "rendering"))
      void loadPalettesFromFile()
      void updateColorPalette()
    }

    cg.addEventListener("dataUploaded", handleDataUploaded)
    cg.addEventListener("graphRebuilt", handleGraphRebuilt)
    return () => {
      cg.removeEventListener("dataUploaded", handleDataUploaded)
      cg.removeEventListener("graphRebuilt", handleGraphRebuilt)
    }
  }, [updateColorPalette, loadPalettesFromFile, hasData, handleGraphRebuilt])

  React.useEffect(() => {
    if (!hasData) return
    void updateColorPalette()
  }, [hasData, updateColorPalette])

  React.useEffect(() => {
    paletteCacheRef.current.clear()
  }, [dataFiles.points, dataFiles.links])

  
  React.useEffect(() => {
    const currentCol = config.pointColorBy
    if (!currentCol) return
    
    
    let baseCol = baseColorColumn
    if (!baseCol) {
      
      if (currentCol.startsWith('log2_') || currentCol.startsWith('log10_')) {
        baseCol = Object.keys(logColumnMapping).find(key => {
          const mapping = logColumnMapping[key]
          return mapping.log2 === currentCol || mapping.log10 === currentCol
        })
      } else {
        baseCol = currentCol
      }
      if (baseCol) setBaseColorColumn(baseCol)
    }
    
    if (!baseCol || !numericColumns.has(baseCol)) return
    
    
    let targetColumn = baseCol
    const mapping = logColumnMapping[baseCol]
    if (colorScale === 'log2' && mapping?.log2) {
      targetColumn = mapping.log2
    } else if (colorScale === 'log10' && mapping?.log10) {
      targetColumn = mapping.log10
    }
    
    
    if (targetColumn !== currentCol) {
      setConfig(prev => ({ ...prev, pointColorBy: targetColumn }))
    }
    
    
    paletteCacheRef.current.delete(currentCol)
    paletteCacheRef.current.delete(targetColumn)
  }, [colorScale, config.pointColorBy, numericColumns, logColumnMapping, baseColorColumn])

  const loadPointsForTable = React.useCallback(async () => {
    if (!onPointsDataLoaded || pointsDataLoadedRef.current) return
    const cg = cosmographRef.current as any
    if (!cg?.getPointsData) return
    try {
      await cg.dataUploaded?.()
      
      
      void loadPalettesFromFile()
      
      const raw = await cg.getPointsData()
      let allColumns: string[] =
        cg?.stats?.pointsSummary?.map(
          (entry: any) =>
            entry?.column_name ?? entry?.column ?? entry?.name ?? entry?.columnName
        )?.filter(Boolean) ?? []
      if (allColumns.length === 0) {
        allColumns = raw?.schema?.fields?.map((field: any) => field?.name) ?? []
      }
      
      
      
      let columns: string[] = allColumns
      if (config?.pointIncludeColumns && Array.isArray(config.pointIncludeColumns)) {
        const allColumnsSet = new Set(allColumns)
        
        columns = config.pointIncludeColumns.filter(col => allColumnsSet.has(col))
      }
      
      const totalRows = Number(
        cg?.public?.stats?.pointsCount ?? raw?.numRows ?? raw?.length ?? 0
      )
      if (totalRows > 0) {
        onPointsDataLoaded(raw, columns, totalRows)
        pointsDataLoadedRef.current = true
      }
    } catch {
      
    }
  }, [onPointsDataLoaded, loadPalettesFromFile])

  React.useEffect(() => {
    pointsDataLoadedRef.current = false
  }, [dataFiles.points, dataFiles.links])

  React.useEffect(() => {
    if (!hasData) return
    void loadPointsForTable()
  }, [hasData, loadPointsForTable])

  React.useEffect(() => {
    if (loadPhase === "ready") {
      void loadPointsForTable()
    }
  }, [loadPhase, loadPointsForTable])

  React.useEffect(() => {
    if (loadPhase === "ready") return
    const cg = cosmographRef.current as any
    if (!cg) return

    const handleFirstRender = () => {
      setLoadPhase("ready")
      cg.removeEventListener?.("render", handleFirstRender)
      cg.removeEventListener?.("draw", handleFirstRender)
      cg.off?.("render", handleFirstRender)
      cg.off?.("draw", handleFirstRender)
    }

    cg.addEventListener?.("render", handleFirstRender)
    cg.addEventListener?.("draw", handleFirstRender)
    cg.on?.("render", handleFirstRender)
    cg.on?.("draw", handleFirstRender)

    return () => {
      cg.removeEventListener?.("render", handleFirstRender)
      cg.removeEventListener?.("draw", handleFirstRender)
      cg.off?.("render", handleFirstRender)
      cg.off?.("draw", handleFirstRender)
    }
  }, [loadPhase])

  const loadMessage = loadPhase === "ready" ? null : "Loading graph…"


  
  React.useEffect(() => {
    if (hasData && loadPhase === "uploading") {
      setLoadPhase("validating")
    }
  }, [hasData, loadPhase])

  React.useEffect(() => {
    if (!hasData || loadPhase !== "uploading") return
    let cancelled = false
    const waitForUpload = async () => {
      setLoadPhase("validating")
      try {
        await (cosmographRef.current as any)?.dataUploaded?.()
      } catch {
        
      }
      if (!cancelled) {
        ;(cosmographRef.current as any)?.step?.()
        setLoadPhase("rendering")
      }
    }
    void waitForUpload()
    return () => {
      cancelled = true
    }
  }, [hasData, loadPhase])

  React.useEffect(() => {
    if (loadPhase !== "rendering" || !hasData) return
    const started = performance.now()
    const interval = window.setInterval(() => {
      const stats = (cosmographRef.current as any)?.public?.stats
      if (stats?.pointsCount > 0) {
        setLoadPhase("ready")
        window.clearInterval(interval)
        return
      }
      if (performance.now() - started > 8000) {
        
        setLoadPhase("ready")
        window.clearInterval(interval)
      }
    }, 200)
    return () => window.clearInterval(interval)
  }, [loadPhase, hasData])


  return (
    <CosmographProvider>
      <div
        ref={containerRef}
        className="flex h-full min-h-0 max-h-full flex-1 flex-col overflow-hidden"
      >
        <div
          className={`relative flex h-full min-h-0 max-h-full overflow-hidden rounded-lg border ${
            isDark ? "bg-[#0b0d12]" : "bg-[#f1f5f9]"
          }`}
          style={{
            backgroundColor: `rgba(${backgroundColor[0]}, ${backgroundColor[1]}, ${backgroundColor[2]}, ${backgroundColor[3]})`,
          }}
        >
          {loadPhase !== "ready" && (
            <div
              className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 text-white backdrop-blur-sm"
              style={{
                backgroundColor: `rgba(${backgroundColor[0]}, ${backgroundColor[1]}, ${backgroundColor[2]}, ${backgroundColor[3]})`,
              }}
            >
              <svg
                className="plasmid-spinner"
                viewBox="0 0 250 250"
                role="img"
                aria-label="Loading"
                style={{
                  color: isDark ? "#ffffff" : "#0f172a",
                  stroke: isDark ? "rgba(255,255,255,0.95)" : "rgba(15,23,42,0.95)",
                }}
              >
                <circle
                  className="plasmid-spinner-track"
                  cx="125"
                  cy="125"
                  r="108"
                  stroke="currentColor"
                />
                <g>
                  <path
                    d={createGenePath({
                      startAngle: 10,
                      lengthAngle: 90,
                      tipLengthAngle: 12,
                      R_in: 100,
                      R_out: 118,
                      flare: 7,
                    })}
                    fill="#F2748E"
                    stroke="currentColor"
                    strokeWidth={0.0}
                    vectorEffect="non-scaling-stroke"
                    style={{ filter: "drop-shadow(0px 2px 2px rgba(0,0,0,0.15))" }}
                  />
                  <path
                    d={createGenePath({
                      startAngle: 120,
                      lengthAngle: 60,
                      tipLengthAngle: 12,
                      R_in: 100,
                      R_out: 118,
                      flare: 7,
                    })}
                    fill="#BADB9A"
                    stroke="currentColor"
                    strokeWidth={0.0}
                    vectorEffect="non-scaling-stroke"
                    style={{ filter: "drop-shadow(0px 2px 2px rgba(0,0,0,0.15))" }}
                  />
                  <path
                    d={createGenePath({
                      startAngle: 200,
                      lengthAngle: 80,
                      tipLengthAngle: 12,
                      R_in: 100,
                      R_out: 118,
                      flare: 7,
                    })}
                    fill="#98D3C4"
                    stroke="currentColor"
                    strokeWidth={0.0}
                    vectorEffect="non-scaling-stroke"
                    style={{ filter: "drop-shadow(0px 2px 2px rgba(0,0,0,0.15))" }}
                  />
                  <path
                    d={createGenePath({
                      startAngle: 300,
                      lengthAngle: 40,
                      tipLengthAngle: 12,
                      R_in: 100,
                      R_out: 118,
                      flare: 7,
                    })}
                    fill="#D9DAD9"
                    stroke="currentColor"
                    strokeWidth={0.0}
                    vectorEffect="non-scaling-stroke"
                    style={{ filter: "drop-shadow(0px 2px 2px rgba(0,0,0,0.15))" }}
                  />
                </g>
              </svg>
              {loadMessage && (
                <p
                  className={`text-sm font-medium ${
                    isDark ? "text-white" : "text-slate-900"
                  }`}
                >
                  {loadMessage}
                </p>
              )}
              {error && (
                <p className="text-xs text-rose-200">Error: {error}</p>
              )}
            </div>
          )}
          <div
            ref={legendRef}
            className="cosmograph-legend"
            style={{ ...legendStyles, color: legendText }}
          >
              <CosmographSizeLegend ref={sizeLegendRef} style={{ display: "none" }} />
            {currentColorStrategy === "continuous" && baseColorColumn && numericColumns.has(baseColorColumn) && (
              <div className="flex items-center gap-2 pb-2 text-xs border-b" style={{ borderColor: legendText + '20' }}>
                <span className="opacity-70">Scale:</span>
                {(['linear', 'log2', 'log10'] as const).map((scale) => {
                  const mapping = logColumnMapping[baseColorColumn]
                  const isAvailable = scale === 'linear' || (mapping && ((scale === 'log2' && mapping.log2) || (scale === 'log10' && mapping.log10)))
                  if (!isAvailable) return null
                  
                  return (
                    <button
                      key={scale}
                      onClick={() => setColorScale(scale)}
                      className="cursor-pointer rounded px-2 py-0.5 transition-colors"
                      style={{
                        background: colorScale === scale ? legendText + '20' : 'transparent',
                        color: legendText,
                        opacity: colorScale === scale ? 1 : 0.6,
                      }}
                    >
                      {scale}
                    </button>
                  )
                })}
              </div>
            )}
            {currentColorStrategy === "continuous" ? (
              <CosmographRangeColorLegend />
            ) : (
              <CosmographTypeColorLegend 
                key={`legend-${legendSortBy}-${colorBy}`}
                sortBy={legendSortBy === "label" ? colorBy : "count"}
                sortOrder={legendSortBy === "label" ? "asc" : "desc"}
              />
            )}
            <div className="flex items-center gap-2 pt-2 text-xs opacity-70">
              <span>Sort:</span>
              <button
                onClick={() => setLegendSortBy(legendSortBy === "count" ? "label" : "count")}
                className="cursor-pointer rounded px-2 py-0.5 transition-colors hover:opacity-100"
                style={{
                  background: legendBg,
                  color: legendText,
                }}
              >
                {legendSortBy === "count" ? "By Size" : "Alphabetical"}
              </button>
            </div>
            {error && (
              <span className="text-xs text-rose-300">Error: {error}</span>
            )}
          </div>
          <CosmographPopup
            content={hoveredContent}
            bindTo={hoveredIndex ?? undefined}
            hidden={hoveredIndex === null}
            placement="top"
            offset={[0, 10]}
          />
          {hasData ? (
            <Cosmograph
              ref={cosmographRef}
              style={{ width: "100%", height: "100%" }}
              {...config}
              statusIndicatorMode={false}
              componentsDisplayStateMode={false}
              points={dataFiles.points}
              links={dataFiles.links}
              renderLinks={showLinks}
              pointIdBy="id"
              pointIndexBy="idx"
              linkSourceBy="source"
              linkSourceIndexBy="sourceidx"
              linkTargetBy="target"
              linkTargetIndexBy="targetidx"
            />
          ) : (
            <div className="flex w-full items-center justify-center text-white/70">
              {loadMessage ?? "Preparando datos…"}
            </div>
          )}
        </div>
      </div>
    </CosmographProvider>
  )
}
