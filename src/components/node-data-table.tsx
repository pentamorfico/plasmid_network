import * as React from "react"
import "@glideapps/glide-data-grid/dist/index.css"

import {
  DataEditor,
  GridCellKind,
  getDefaultTheme,
  GridColumnIcon,
  CompactSelection,
} from "@glideapps/glide-data-grid"
import type {
  GridCell,
  TextCell,
  Theme,
  GridSelection,
  DataEditorRef,
} from "@glideapps/glide-data-grid"
import { useTheme } from "next-themes"
import { Switch } from "@/components/ui/switch"

type NodeDataTableProps = {
  open: boolean
  dataSource: unknown 
  columns: string[]
  totalRows: number
  focusRowIndex?: number | null
  focusTrigger?: number
  onIndexReady?: () => void
  onOpen?: () => void
  selectedRowIndices?: number[]
  onRowSelectionChange?: (rows: number[]) => void
  showOnlySelected?: boolean
  onShowOnlySelectedChange?: (value: boolean) => void
}

export function NodeDataTable({
  open,
  dataSource,
  columns = [], 
  totalRows = 0,
  focusRowIndex = null,
  focusTrigger = 0,
  onIndexReady,
  onOpen,
  selectedRowIndices,
  onRowSelectionChange,
  showOnlySelected = false,
  onShowOnlySelectedChange,
}: NodeDataTableProps) {
  const { resolvedTheme } = useTheme()
  const isDark = (resolvedTheme ?? "dark") === "dark"

  // Diferir la selección para no bloquear el UI
  const deferredSelectedRowIndices = React.useDeferredValue(selectedRowIndices)
  
  // Lógica para elegir qué valor usar:
  // - Deselección (length === 0): usar valor inmediato para respuesta instantánea
  // - Primera selección (deferred vacío pero actual tiene datos): usar valor inmediato
  // - Selección en curso (ambos tienen datos): usar deferred para no bloquear
  const effectiveSelectedRowIndices = React.useMemo(() => {
    // Deselección inmediata
    if (!selectedRowIndices || selectedRowIndices.length === 0) {
      return selectedRowIndices
    }
    // Primera selección (deferred aún no tiene datos)
    if (!deferredSelectedRowIndices || deferredSelectedRowIndices.length === 0) {
      return selectedRowIndices
    }
    // Selección en curso - usar deferred para no bloquear
    return deferredSelectedRowIndices
  }, [selectedRowIndices, deferredSelectedRowIndices])

  // Estado local para la selección del grid (modo controlado simple)
  const [gridSelection, setGridSelection] = React.useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  })
  
  // Ref para evitar reportar cambios que vienen de sincronización externa
  const syncingFromExternalRef = React.useRef(false)

  const gridRef = React.useRef<DataEditorRef | null>(null)
  const [searchValue, setSearchValue] = React.useState("")
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)

  const gridColumns = React.useMemo(() => {
    return columns.map((name) => ({ title: name, id: name }))
  }, [columns])

  // --- LÓGICA DE ICONOS Y DATOS ---
  const columnVectors = React.useMemo(() => {
    if (!dataSource || typeof (dataSource as any).getChild !== "function") {
      return null
    }
    return columns.map((key) => (dataSource as any).getChild(key))
  }, [dataSource, columns])

  const [searchIndex, setSearchIndex] = React.useState<string[] | null>(null)
  const [isIndexing, setIsIndexing] = React.useState(false)
  const indexingTriggeredRef = React.useRef(false)

  // Columnas prioritarias para indexar (más útiles para búsqueda)
  const searchableColumns = React.useMemo(() => {
    const priority = ['id', 'species', 'genus', 'family', 'order', 'class', 'phylum', 'domain', 
                      'Ecosystem', 'topology', 'predicted_mobility', 'cluster']
    return columns.filter(col => priority.includes(col))
  }, [columns])

  // Lazy search index - solo se construye cuando el usuario escribe algo
  const buildSearchIndex = React.useCallback(() => {
    if (indexingTriggeredRef.current || !dataSource || columns.length === 0) return
    indexingTriggeredRef.current = true
    setIsIndexing(true)

    const colsToIndex = searchableColumns.length > 0 ? searchableColumns : columns.slice(0, 10)
    const colIndices = colsToIndex.map(col => columns.indexOf(col)).filter(i => i >= 0)
    
    const values: string[] = Array.from({ length: totalRows }, () => "")
    const batchSize = 2000

    const fillRow = (row: number) => {
      const parts: string[] = []
      for (const colIndex of colIndices) {
        const key = columns[colIndex]
        let raw: unknown
        if (columnVectors) {
          raw = columnVectors[colIndex]?.get?.(row)
        } else if (Array.isArray(dataSource)) {
          raw = (dataSource as any[])[row]?.[key]
        } else if (typeof (dataSource as any).get === "function") {
          raw = (dataSource as any).get(row)?.[key]
        } else {
          raw = (dataSource as any)?.[row]?.[key]
        }
        if (raw === null || raw === undefined) continue
        parts.push(String(raw).toLowerCase())
      }
      values[row] = parts.join(" ")
    }

    const runBatch = (start: number) => {
      const end = Math.min(start + batchSize, totalRows)
      for (let row = start; row < end; row++) {
        fillRow(row)
      }
      if (end < totalRows) {
        requestAnimationFrame(() => runBatch(end))
      } else {
        setSearchIndex(values)
        setIsIndexing(false)
      }
    }

    runBatch(0)
  }, [dataSource, columns, columnVectors, totalRows, searchableColumns])

  // Resetear cuando cambian los datos
  React.useEffect(() => {
    indexingTriggeredRef.current = false
    setSearchIndex(null)
    setIsIndexing(false)
  }, [dataSource, columns])

  // Notificar que estamos listos (ya no esperamos el índice)
  React.useEffect(() => {
    if (dataSource && columns.length > 0) {
      onIndexReady?.()
    }
  }, [dataSource, columns, onIndexReady])

  // Disparar construcción del índice cuando el usuario empieza a escribir
  React.useEffect(() => {
    if (searchValue && searchValue.length > 0 && !searchIndex && !isIndexing) {
      buildSearchIndex()
    }
  }, [searchValue, searchIndex, isIndexing, buildSearchIndex])

  const searchFilteredRows = React.useMemo(() => {
    if (!searchValue) return null
    if (!searchIndex) return null // Aún construyendo índice
    const needle = searchValue.toLowerCase()
    const matches: number[] = []
    for (let i = 0; i < searchIndex.length; i++) {
      if (searchIndex[i].includes(needle)) {
        matches.push(i)
      }
    }
    return matches
  }, [searchValue, searchIndex])

  // Set para lookup O(1) de selección - SIEMPRE disponible para highlighting
  // Usa effectiveSelectedRowIndices para responder inmediatamente a deselección
  const selectedRowSet = React.useMemo(() => {
    if (!effectiveSelectedRowIndices || effectiveSelectedRowIndices.length === 0) return null
    const set = new Set<number>()
    for (const row of effectiveSelectedRowIndices) {
      if (Number.isInteger(row) && row >= 0 && row < totalRows) {
        set.add(row)
      }
    }
    return set.size > 0 ? set : null
  }, [effectiveSelectedRowIndices, totalRows])

  // Set para filtrar filas (solo cuando showOnlySelected)
  const selectionFilterSet = React.useMemo(() => {
    if (!showOnlySelected) return null
    return selectedRowSet
  }, [showOnlySelected, selectedRowSet])

  const selectionFilteredRows = React.useMemo(() => {
    if (!selectionFilterSet || !effectiveSelectedRowIndices) return null
    return effectiveSelectedRowIndices
      .filter((row) => selectionFilterSet.has(row))
      .sort((a, b) => a - b)
  }, [selectionFilterSet, effectiveSelectedRowIndices])

  const filteredRowIndices = React.useMemo(() => {
    if (selectionFilterSet) {
      if (searchFilteredRows) {
        return searchFilteredRows.filter((row) => selectionFilterSet.has(row))
      }
      return selectionFilteredRows ?? []
    }
    if (showOnlySelected) {
      return []
    }
    return searchFilteredRows
  }, [searchFilteredRows, selectionFilteredRows, selectionFilterSet, showOnlySelected])

  const visibleRowCount =
    filteredRowIndices !== null
      ? filteredRowIndices.length
      : showOnlySelected
        ? 0
        : totalRows

  const rowCountLabel = (() => {
    const baseTotal = totalRows.toLocaleString()
    if (selectionFilterSet || showOnlySelected) {
      const selectedCount =
        selectionFilteredRows?.length ??
        selectionFilterSet?.size ??
        filteredRowIndices?.length ??
        0
      const visibleCount = visibleRowCount.toLocaleString()
      const selectedLabel = selectedCount.toLocaleString()
      return `${visibleCount} / ${selectedLabel} selected / ${baseTotal}`
    }
    if (filteredRowIndices && searchValue.length > 0) {
      return `${visibleRowCount.toLocaleString()} / ${baseTotal}`
    }
    return baseTotal
  })()

  // Lookup para convertir índices de fuente a índices visibles
  const filteredRowLookup = React.useMemo(() => {
    if (!filteredRowIndices) return null
    const map = new Map<number, number>()
    filteredRowIndices.forEach((sourceIdx, visibleIdx) => {
      map.set(sourceIdx, visibleIdx)
    })
    return map
  }, [filteredRowIndices])

  // Sincronizar gridSelection cuando la selección viene de Cosmograph (leyenda, polígono)
  React.useEffect(() => {
    if (!effectiveSelectedRowIndices || effectiveSelectedRowIndices.length === 0) {
      // Limpiar selección
      syncingFromExternalRef.current = true
      setGridSelection({
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
      })
      requestAnimationFrame(() => {
        syncingFromExternalRef.current = false
      })
      return
    }

    // Convertir índices de fuente a índices visibles
    const visibleSelectedRows: number[] = []
    for (const sourceIdx of effectiveSelectedRowIndices) {
      let visibleIdx: number | undefined
      if (filteredRowLookup && filteredRowLookup.size > 0) {
        visibleIdx = filteredRowLookup.get(sourceIdx)
      } else if (filteredRowIndices === null) {
        // Sin filtro - el índice visible es el mismo que el de fuente
        visibleIdx = sourceIdx
      }
      if (visibleIdx !== undefined && visibleIdx >= 0 && visibleIdx < visibleRowCount) {
        visibleSelectedRows.push(visibleIdx)
      }
    }

    // Solo actualizar si hay filas visibles seleccionadas
    if (visibleSelectedRows.length > 0) {
      syncingFromExternalRef.current = true
      // Construir CompactSelection añadiendo cada índice
      let rowsSelection = CompactSelection.empty()
      for (const idx of visibleSelectedRows) {
        rowsSelection = rowsSelection.add(idx)
      }
      setGridSelection({
        columns: CompactSelection.empty(),
        rows: rowsSelection,
      })
      requestAnimationFrame(() => {
        syncingFromExternalRef.current = false
      })
    }
  }, [effectiveSelectedRowIndices, filteredRowLookup, filteredRowIndices, visibleRowCount])

  const enrichedGridColumns = React.useMemo(() => {
    const getSampleValue = (colIndex: number, key: string) => {
      if (!dataSource) return undefined
      if (columnVectors) {
        return columnVectors[colIndex]?.get?.(0)
      } else if (Array.isArray(dataSource)) {
        return (dataSource as any[])[0]?.[key]
      } else if (typeof (dataSource as any).get === "function") {
        return (dataSource as any).get(0)?.[key]
      }
      return (dataSource as any)?.[0]?.[key]
    }

    return gridColumns.map((col, index) => {
      const sampleValue = getSampleValue(index, col.id)
      let icon = GridColumnIcon.HeaderString
      
      if (typeof sampleValue === 'number' || typeof sampleValue === 'bigint') {
        icon = GridColumnIcon.HeaderNumber
      } else if (typeof sampleValue === 'boolean') {
        icon = GridColumnIcon.HeaderBoolean
      } else if (typeof sampleValue === 'string') {
        if (sampleValue.startsWith('http://') || sampleValue.startsWith('https://')) {
          icon = GridColumnIcon.HeaderUri
        }
      }

      return {
        ...col,
        icon,
      }
    })
  }, [gridColumns, dataSource, columnVectors])

  const getRawValue = React.useCallback(
    (sourceRow: number, colIndex: number, key: string) => {
      if (!key) return undefined

      if (columnVectors) {
        return columnVectors[colIndex]?.get?.(sourceRow)
      }
      if (Array.isArray(dataSource)) {
        const rowData = (dataSource as any[])[sourceRow]
        return rowData?.[key]
      }
      if (typeof (dataSource as any).get === "function") {
        const rowData = (dataSource as any).get(sourceRow)
        return rowData?.[key]
      }
      return (dataSource as any)?.[sourceRow]?.[key]
    },
    [columnVectors, dataSource]
  )

  const getCellContent = React.useCallback(
    (cell: readonly [number, number]): GridCell => {
      const [col, row] = cell

      const sourceRow =
        filteredRowIndices && filteredRowIndices.length > 0
          ? filteredRowIndices[row] ?? -1
          : row

      if (!dataSource || columns.length === 0 || sourceRow < 0 || sourceRow >= totalRows) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          allowOverlay: true,
          style: "normal",
        } satisfies TextCell
      }

      const key = columns[col]
      const value = getRawValue(sourceRow, col, key)

      const display =
        value === null || value === undefined
          ? ""
          : typeof value === "bigint"
            ? value.toString()
            : String(value)

      const needle = searchValue.trim().toLowerCase()
      const matchesSearch =
        needle.length > 0 && display.toLowerCase().includes(needle)

      // Lookup O(1) para selección visual
      const isSelected = selectedRowSet?.has(sourceRow) ?? false

      // Prioridad: search > selection > default
      let highlightTheme: Partial<Theme> | undefined = undefined
      if (matchesSearch) {
        highlightTheme = {
          bgCell: isDark ? "rgba(56,189,248,0.16)" : "rgba(56,189,248,0.14)",
          bgCellMedium: isDark ? "rgba(56,189,248,0.16)" : "rgba(56,189,248,0.14)",
          textDark: isDark ? "#e0f2fe" : "#0f172a",
          textMedium: isDark ? "#e0f2fe" : "#0f172a",
        }
      } else if (isSelected) {
        highlightTheme = {
          bgCell: isDark ? "rgba(59,130,246,0.18)" : "rgba(59,130,246,0.12)",
          bgCellMedium: isDark ? "rgba(59,130,246,0.18)" : "rgba(59,130,246,0.12)",
        }
      }

      return {
        kind: GridCellKind.Text,
        data: display,
        displayData: display,
        allowOverlay: true,
        style: "normal",
        themeOverride: highlightTheme,
      } satisfies TextCell
    },
    [columns, filteredRowIndices, totalRows, searchValue, isDark, getRawValue, selectedRowSet]
  )

  // Key que cambia solo para cambios estructurales (columnas, filas, tema)
  // NO incluir selección - eso causaría re-mount del grid y perdería scroll
  const editorKey = React.useMemo(
    () => `grid-${columns.length}-${totalRows}-${isDark ? "dark" : "light"}`,
    [columns.length, totalRows, isDark]
  )

  const theme = React.useMemo<Partial<Theme>>(() => {
    const base = getDefaultTheme()
    const textMain = isDark ? "#e2e8f0" : "#1e293b"
    const bgMain = isDark ? "#09090b" : "#ffffff"
    const border = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"

    return {
      ...base,
      fontFamily: '"Space Grotesk", "Helvetica Neue", "Segoe UI", sans-serif',
      bgCell: bgMain,
      bgCellMedium: bgMain,
      textDark: textMain,
      textMedium: textMain,
      textLight: textMain,
      textHeader: textMain,
      textHeaderSelected: textMain,
      bgHeader: isDark ? "#18181b" : "#f1f5f9",
      bgHeaderHasFocus: isDark ? "#27272a" : "#e2e8f0",
      bgHeaderHovered: isDark ? "#27272a" : "#e2e8f0",
      borderColor: border,
      accentColor: "#3b82f6",
      accentFg: "#ffffff",
      accentLight: "rgba(59, 130, 246, 0.1)",
      textHeaderIcon: isDark ? "#94a3b8" : "#64748b", 
      baseFontStyle: "13px",
      editorFontSize: "13px",
    }
  }, [isDark])

  // Referencia para el último focusRowIndex pendiente
  const pendingFocusRef = React.useRef<number | null>(null)

  // Hacer scroll cuando cambia focusTrigger
  React.useEffect(() => {
    // Ignorar trigger 0 (inicial)
    if (focusTrigger === 0) return
    if (focusRowIndex === null || focusRowIndex === undefined) return
    
    if (!open) {
      // Guardar para cuando se abra
      pendingFocusRef.current = focusRowIndex
      return
    }
    
    // Tabla abierta - hacer scroll
    pendingFocusRef.current = null
    const timeoutId = setTimeout(() => {
      const targetRow =
        filteredRowIndices && filteredRowIndices.length > 0
          ? filteredRowIndices.findIndex((idx) => idx === focusRowIndex)
          : focusRowIndex

      if (Number.isInteger(targetRow) && targetRow >= 0) {
        gridRef.current?.scrollTo(
          { amount: 0, unit: "cell" },
          { amount: targetRow, unit: "cell" },
          "both",
          0,
          8,
          { vAlign: "center" }
        )
      }
    }, 50)
    
    return () => clearTimeout(timeoutId)
  }, [focusTrigger, focusRowIndex, open, filteredRowIndices])

  // Cuando la tabla se abre, hacer scroll a la fila pendiente
  React.useEffect(() => {
    if (!open) return
    if (pendingFocusRef.current === null) return
    
    const pending = pendingFocusRef.current
    pendingFocusRef.current = null
    
    const timeoutId = setTimeout(() => {
      const targetRow =
        filteredRowIndices && filteredRowIndices.length > 0
          ? filteredRowIndices.findIndex((idx) => idx === pending)
          : pending

      if (Number.isInteger(targetRow) && targetRow >= 0) {
        gridRef.current?.scrollTo(
          { amount: 0, unit: "cell" },
          { amount: targetRow, unit: "cell" },
          "both",
          0,
          8,
          { vAlign: "center" }
        )
      }
    }, 100)
    
    return () => clearTimeout(timeoutId)
  }, [open, filteredRowIndices])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyF") {
        event.preventDefault()
        event.stopPropagation()
        onOpen?.()
        const focusInput = () => searchInputRef.current?.focus()
        if (!open) {
          requestAnimationFrame(focusInput)
        } else {
          focusInput()
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true })
  }, [onOpen, open])

  const handleGridSelectionChange = React.useCallback(
    (selection: GridSelection) => {
      // Actualizar estado local del grid primero
      setGridSelection(selection)
      
      // Si el cambio viene de sincronización externa (Cosmograph), no reportar de vuelta
      if (syncingFromExternalRef.current) return
      
      if (!onRowSelectionChange) return

      const selectedVisibleRows = selection.rows.toArray()
      
      // Si no hay filas seleccionadas en el grid, NO reportar deselección
      // Esto evita resetear la selección cuando cambia el filtro
      if (selectedVisibleRows.length === 0) {
        return
      }
      
      const selectedSourceRows = selectedVisibleRows
        .map((visibleRow) =>
          filteredRowIndices && filteredRowIndices.length > 0
            ? filteredRowIndices[visibleRow]
            : visibleRow
        )
        .filter((row) => Number.isInteger(row) && row >= 0 && row < totalRows)

      const next = Array.from(new Set(selectedSourceRows)).sort((a, b) => a - b)
      if (
        Array.isArray(selectedRowIndices) &&
        next.length === selectedRowIndices.length &&
        next.every((value, idx) => value === selectedRowIndices[idx])
      ) {
        return
      }

      onRowSelectionChange(next)
    },
    [filteredRowIndices, onRowSelectionChange, totalRows, selectedRowIndices]
  )

  const handleDownloadSelected = React.useCallback(() => {
    if (!columns.length || !selectedRowIndices || selectedRowIndices.length === 0) {
      return
    }

    const rows = selectedRowIndices
      .filter((row) => Number.isInteger(row) && row >= 0 && row < totalRows)
      .map((rowIndex) =>
        columns
          .map((key, colIndex) => {
            const raw = getRawValue(rowIndex, colIndex, key)
            if (raw === null || raw === undefined) return ""
            const str = typeof raw === "bigint" ? raw.toString() : String(raw)
            return str.replace(/[\t\r\n]+/g, " ").trim()
          })
          .join("\t")
      )

    if (rows.length === 0) return

    const header = columns.join("\t")
    const contents = [header, ...rows].join("\n")
    const blob = new Blob([contents], {
      type: "text/tab-separated-values;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "selected-nodes.tsv"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [columns, selectedRowIndices, getRawValue, totalRows])

  return (
    <div
      className={`absolute inset-x-2 bottom-2 z-50 flex flex-col overflow-hidden rounded-xl border bg-card/95 shadow-xl backdrop-blur transition-opacity duration-250 ${
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
      style={{ height: "50%" }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground bg-muted/20">
        <span>Nodes table</span>
        <div className="flex items-center gap-2 text-[0.7rem] font-normal normal-case">
          <span className="text-[0.6rem] uppercase opacity-70">
            {rowCountLabel} rows
          </span>
          <div 
            className="flex items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Switch
              id="show-only-selected"
              checked={showOnlySelected}
              onCheckedChange={onShowOnlySelectedChange}
              disabled={!selectedRowIndices || selectedRowIndices.length === 0}
              className="scale-75"
            />
            <label 
              htmlFor="show-only-selected" 
              className={`text-[0.65rem] cursor-pointer select-none ${
                !selectedRowIndices || selectedRowIndices.length === 0 
                  ? 'opacity-40' 
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              Selected only
            </label>
          </div>
          <button
            className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary shadow-sm transition hover:bg-primary/20 hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-[0.5px] disabled:cursor-not-allowed disabled:border-muted disabled:text-muted-foreground disabled:hover:bg-background disabled:opacity-40"
            onClick={handleDownloadSelected}
            disabled={
              !selectedRowIndices || selectedRowIndices.length === 0 || columns.length === 0 || !dataSource
            }
          >
            Download TSV
          </button>
          <div className="flex items-center gap-1 rounded-md border bg-background/70 px-2 py-1 text-xs">
            <input
              className="h-6 w-32 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/70"
              placeholder="Search (Ctrl/Cmd+F)"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              ref={searchInputRef}
            />
            {searchValue.length > 0 ? (
              <button
                className="text-muted-foreground transition hover:text-foreground"
                onClick={() => {
                  setSearchValue("")
                }}
                aria-label="Limpiar búsqueda"
              >
                ×
              </button>
            ) : (
              <button
                className="text-muted-foreground transition hover:text-foreground"
                onClick={() => searchInputRef.current?.focus()}
                aria-label="Alternar búsqueda"
              >
                🔍
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 w-full gdg-wrapper">
        {totalRows === 0 || !dataSource ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        ) : (
          <DataEditor
            key={editorKey}
            className="h-full w-full"
            ref={gridRef}
            columns={enrichedGridColumns}
            getCellContent={getCellContent}
            rows={visibleRowCount}
            smoothScrollX={true}
            smoothScrollY={true}
            theme={theme}
            headerHeight={36}
            rowHeight={32}
            searchValue={searchValue}
            onSearchValueChange={setSearchValue}
            searchResults={[]}
            getCellsForSelection={true}
            
            // Selección controlada
            gridSelection={gridSelection}
            onGridSelectionChange={handleGridSelectionChange}
            rowSelect="multi"
            rowSelectionMode="multi"
            rowMarkers={{
              kind: "both",
              checkboxStyle: "circle",
            }}
            
            headerIcons={undefined} 
          />
        )}
      </div>
    </div>
  )
}
