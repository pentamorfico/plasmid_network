import * as React from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { NetworkCosmograph } from "@/components/network-cosmograph"
import { NodeDataTable } from "@/components/node-data-table"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/sonner"
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import {
  IconChevronLeft,
  IconChevronRight,
  IconMoon,
  IconPolygon,
  IconSun,
  IconTable,
} from "@tabler/icons-react"
import { useTheme } from "next-themes"

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

function getCellValue(
  dataSource: unknown,
  column: string,
  rowIndex: number
) {
  if (!dataSource || rowIndex === null || rowIndex === undefined || rowIndex < 0) {
    return undefined
  }
  const source = dataSource as any
  if (typeof source.getChild === "function") {
    const col = source.getChild(column)
    if (col?.get) return col.get(rowIndex)
  }
  if (typeof source.get === "function") {
    const row = source.get(rowIndex)
    if (row && column in row) return row[column]
  }
  if (Array.isArray(source)) {
    const row = source[rowIndex]
    return row ? row[column] : undefined
  }
  if (typeof (source as any).at === "function") {
    const row = (source as any).at(rowIndex)
    if (row && column in row) return row[column]
  }
  return undefined
}

function SidebarToggleFab({
  onToggleTable,
  tableOpen,
  onTogglePolygonSelection,
  polygonSelectionActive,
}: {
  onToggleTable: () => void
  tableOpen: boolean
  onTogglePolygonSelection: () => void
  polygonSelectionActive: boolean
}) {
  const { open, toggleSidebar } = useSidebar()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const Icon = open ? IconChevronLeft : IconChevronRight
  const isDark = (resolvedTheme ?? "dark") === "dark"

  React.useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="absolute left-5 top-5 z-50 flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={toggleSidebar}
        className="h-8 w-8 rounded-md border-border bg-transparent text-foreground shadow-none"
        aria-label={open ? "Cerrar sidebar" : "Abrir sidebar"}
      >
        <Icon className="!size-4" />
      </Button>
      <Button
        variant={tableOpen ? "default" : "outline"}
        size="icon"
        onClick={onToggleTable}
        className={`h-8 w-8 rounded-md shadow-none ${
          tableOpen
            ? "bg-primary text-primary-foreground"
            : "border-border bg-transparent text-foreground"
        }`}
        aria-pressed={tableOpen}
        aria-label={tableOpen ? "Ocultar tabla" : "Mostrar tabla"}
      >
        <IconTable className="!size-4" />
      </Button>
      <Button
        variant={polygonSelectionActive ? "default" : "outline"}
        size="icon"
        onClick={onTogglePolygonSelection}
        className={`h-8 w-8 rounded-md shadow-none ${
          polygonSelectionActive ? "bg-primary text-primary-foreground" : "border-border bg-transparent text-foreground"
        }`}
        aria-pressed={polygonSelectionActive}
        aria-label={polygonSelectionActive ? "Desactivar selección poligonal" : "Activar selección poligonal"}
      >
        <IconPolygon className="!size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        className="h-8 w-8 rounded-md border-border bg-transparent text-foreground shadow-none"
        aria-label={isDark ? "Activar modo claro" : "Activar modo oscuro"}
        disabled={!mounted}
      >
        {isDark ? <IconSun className="!size-4" /> : <IconMoon className="!size-4" />}
      </Button>
    </div>
  )
}

function App() {
  const [showLinks, setShowLinks] = React.useState(true)
  const [showLabels, setShowLabels] = React.useState(true)
  const [colorBy, setColorBy] = React.useState<string>("")
  const [colorOptions, setColorOptions] = React.useState<string[]>([])
  const [pointSize, setPointSize] = React.useState<number>(10)
  const [linkOpacity, setLinkOpacity] = React.useState<number>(0.15)
  const [pointGreyoutOpacity, setPointGreyoutOpacity] = React.useState<number>(0.01)
  const [linkGreyoutOpacity, setLinkGreyoutOpacity] = React.useState<number>(0.005)
  const [hideNoMetadata, setHideNoMetadata] = React.useState(false)
  const [hideIMGPR, setHideIMGPR] = React.useState(false)
  const [tableOpen, setTableOpen] = React.useState(false)
  const [polygonSelectionActive, setPolygonSelectionActive] = React.useState(false)
  const [showOnlySelectedRows, setShowOnlySelectedRows] = React.useState(false)
  const [tableData, setTableData] = React.useState<unknown>(null)
  const [tableColumns, setTableColumns] = React.useState<string[]>([])
  const [tableTotalRows, setTableTotalRows] = React.useState(0)
  const [graphReady, setGraphReady] = React.useState(false)
  const [selectedRowIndices, setSelectedRowIndices] = React.useState<number[]>([])
  const [primarySelectedIndex, setPrimarySelectedIndex] = React.useState<number | null>(null)
  const [focusedRowIndex, setFocusedRowIndex] = React.useState<number | null>(null)
  const [focusTrigger, setFocusTrigger] = React.useState(0)
  const [indexReady, setIndexReady] = React.useState(false)
  const [loadMessage, setLoadMessage] = React.useState("Loading data")
  const selectedPlasmidId = React.useMemo(() => {
    if (primarySelectedIndex !== null && tableData && tableColumns.includes("id")) {
      const value = getCellValue(tableData, "id", primarySelectedIndex)
      if (value) return String(value)
    }
    if (!tableData || !tableColumns.length || !tableColumns.includes("id")) return null
    if (!selectedRowIndices || selectedRowIndices.length !== 1) return null
    const targetIndex = selectedRowIndices[0]
    const value = getCellValue(tableData, "id", targetIndex)
    return value ? String(value) : null
  }, [primarySelectedIndex, tableData, tableColumns, selectedRowIndices])

  const normalizeSelection = React.useCallback((rows: number[]) => {
    return Array.from(new Set(rows)).sort((a, b) => a - b)
  }, [])

  const rowsEqual = React.useCallback((a: number[], b: number[]) => {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }, [])

  const toggleTable = React.useCallback(() => {
    setTableOpen((prev) => !prev)
  }, [])

  const togglePolygonSelection = React.useCallback(() => {
    setPolygonSelectionActive((prev) => !prev)
  }, [])

  const [, startTransition] = React.useTransition()

  // Ref para rastrear si había selección (para detectar deselección real)
  const hadSelectionRef = React.useRef(false)
  
  // Actualizar ref cuando cambia selectedRowIndices
  React.useEffect(() => {
    hadSelectionRef.current = selectedRowIndices.length > 0
  }, [selectedRowIndices])

  const handleSelectionChange = React.useCallback(
    (rows: number[]) => {
      const next = normalizeSelection(rows)
      
      // Deselección completa - solo resetear toggle si REALMENTE teníamos selección antes
      if (next.length === 0) {
        if (hadSelectionRef.current) {
          setShowOnlySelectedRows(false)
        }
        setSelectedRowIndices([])
        setPrimarySelectedIndex(null)
        setFocusedRowIndex(null)
        return
      }
      
      // Selección - NO tocar showOnlySelectedRows (el usuario lo controla)
      startTransition(() => {
        setSelectedRowIndices((prev) => (rowsEqual(prev, next) ? prev : next))
      })
    },
    [normalizeSelection, rowsEqual]
  )

  // Handler combinado para selecciones grandes (leyenda, polígono)
  // Esto asegura que showOnlySelectedRows se setee DESPUÉS de selectedRowIndices
  const handleLargeSelection = React.useCallback(
    (rows: number[]) => {
      const next = normalizeSelection(rows)
      
      // Actualizar selección primero (inmediato para selecciones nuevas)
      if (next.length > 0) {
        setSelectedRowIndices((prev) => (rowsEqual(prev, next) ? prev : next))
        setShowOnlySelectedRows(true)
      } else {
        // Deselección - limpiar selección pero NO tocar el toggle
        // El toggle se controla manualmente por el usuario
        setSelectedRowIndices([])
      }
      setPrimarySelectedIndex(null)
      setFocusedRowIndex(null)
    },
    [normalizeSelection, rowsEqual]
  )

  const dataReady = graphReady && indexReady

  const sidebarStyles = {
    "--sidebar-width": "480px",
    "--header-height": "calc(var(--spacing) * 12)",
  } as React.CSSProperties


  return (
    <SidebarProvider
      style={sidebarStyles}
      className="h-svh overflow-hidden bg-sidebar"
    >
      <AppSidebar
        variant="inset"
        showLinks={showLinks}
        onToggleLinks={setShowLinks}
        showLabels={showLabels}
        onToggleLabels={setShowLabels}
        colorBy={colorBy}
        colorOptions={colorOptions}
        onChangeColorBy={(v) => setColorBy(v ?? "")}
        pointSize={pointSize}
        onChangePointSize={setPointSize}
        linkOpacity={linkOpacity}
        onChangeLinkOpacity={setLinkOpacity}
        pointGreyoutOpacity={pointGreyoutOpacity}
        onChangePointGreyoutOpacity={setPointGreyoutOpacity}
        linkGreyoutOpacity={linkGreyoutOpacity}
        onChangeLinkGreyoutOpacity={setLinkGreyoutOpacity}
        hideNoMetadata={hideNoMetadata}
        onToggleHideNoMetadata={setHideNoMetadata}
        hideIMGPR={hideIMGPR}
        onToggleHideIMGPR={setHideIMGPR}
        plasmidId={selectedPlasmidId}
      />
      <SidebarInset className="relative flex h-full min-h-0 flex-1 overflow-hidden md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none">
        <div className="relative flex h-full w-full overflow-hidden bg-sidebar p-2">
          <SidebarToggleFab
            onToggleTable={toggleTable}
            tableOpen={tableOpen}
            onTogglePolygonSelection={togglePolygonSelection}
            polygonSelectionActive={polygonSelectionActive}
          />
          <div className="relative flex h-full w-full overflow-hidden rounded-xl border border-border/60 bg-card/50">
            <div
              className={`relative h-full w-full transition-opacity duration-300 ${
                dataReady ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <NetworkCosmograph
                showLinks={showLinks}
                showLabels={showLabels}
                colorBy={colorBy}
                pointSize={pointSize}
                linkOpacity={linkOpacity}
                pointGreyoutOpacity={pointGreyoutOpacity}
                linkGreyoutOpacity={linkGreyoutOpacity}
                hideNoMetadata={hideNoMetadata}
                hideIMGPR={hideIMGPR}
                onColorOptions={(opts) => setColorOptions(opts)}
                onColorByResolved={(value) =>
                  setColorBy((prev) =>
                    prev && prev.length > 0 ? prev : value ?? ""
                  )
                }
                selectedPointIndices={selectedRowIndices}
                onPointSelected={(index) => {
                  if (index === null || index === undefined || Number.isNaN(index)) {
                    setFocusedRowIndex(null)
                    setPrimarySelectedIndex(null)
                    return
                  }
                  if (!Number.isInteger(index) || index < 0) return
                  // Siempre incrementar trigger para forzar scroll, incluso si es el mismo índice
                  setFocusedRowIndex(index)
                  setFocusTrigger(prev => prev + 1)
                  setPrimarySelectedIndex(index)
                  // NO abrir la tabla automáticamente al hacer click en un punto
                  // El usuario puede abrirla manualmente con el botón
                }}
                onSelectionChange={handleSelectionChange}
                polygonSelectionActive={polygonSelectionActive}
                onPolygonSelectionFinished={(rows) => {
                  handleLargeSelection(rows)
                  setPolygonSelectionActive(false)
                }}
                onLargeSelectionFinished={handleLargeSelection}
                onPointsDataLoaded={(dataSource, columns, totalRows) => {
                  setTableData(dataSource)
                  setTableColumns(columns)
                  setTableTotalRows(totalRows)
                  setSelectedRowIndices([])
                  setPrimarySelectedIndex(null)
                  setFocusedRowIndex(null)
                  setPolygonSelectionActive(false)
                  setShowOnlySelectedRows(false)
                  setLoadMessage("Preparing interface")
                  // El índice de búsqueda ahora es lazy, no bloqueamos la carga
                  setIndexReady(true)
                  setGraphReady(true)
                }}
              />
            </div>
            {!dataReady && (
              <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-sidebar/92 backdrop-blur-sm text-sm text-foreground/80">
                <svg
                  className="plasmid-spinner"
                  viewBox="0 0 250 250"
                  role="img"
                  aria-label="Cargando"
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
                <span className="flex items-center gap-1">
                  <span>{loadMessage}</span>
                  <span className="loading-dots" aria-hidden="true">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                </span>
              </div>
            )}
          </div>
          <NodeDataTable
            open={tableOpen}
            dataSource={tableData}
            columns={tableColumns}
            totalRows={tableTotalRows}
            focusRowIndex={focusedRowIndex}
            focusTrigger={focusTrigger}
            selectedRowIndices={selectedRowIndices}
            onRowSelectionChange={handleSelectionChange}
            showOnlySelected={showOnlySelectedRows}
            onShowOnlySelectedChange={setShowOnlySelectedRows}
            onIndexReady={() => {
              setIndexReady(true)
              setLoadMessage("Creating graph")
            }}
            onOpen={() => setTableOpen(true)}
          />
        </div>
      </SidebarInset>
      <Toaster richColors closeButton />
    </SidebarProvider>
  )
}

export default App
