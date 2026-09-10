'use client'

import * as React from 'react'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'
import { AlertTriangle, Copy, Loader2, Moon, Pin, PinOff, Sun, Table2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ShellSearch, ViewerShell } from '@/components/viewer-shell'
import { useViewerUiStore } from '@/lib/viewer-ui-store'
import { exportElementToPdf } from '@/lib/export-pdf'
import type { LoadedFile } from '@/lib/viewers/types'

interface ViewerProps {
  file: LoadedFile
}

/** Hard cap on rendered rows to keep the DOM manageable. */
const ROW_CAP = 5000
/** Detects plain numeric cells so they can be right-aligned. */
const NUMERIC_RE = /^-?\d+(\.\d+)?$/

/** Zoom range for the toolbar controls (50%–200%, step 10%). */
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1

/** Resolves after `n` animation frames — lets React flush DOM updates. */
const nextFrames = (n: number) =>
  new Promise<void>((res) => {
    const go = (k: number) => {
      if (k <= 0) return res()
      requestAnimationFrame(() => go(k - 1))
    }
    go(n)
  })

/**
 * Rules for the frozen-first-column mode. Rendered as a plain <style> tag
 * inside the table wrapper (globals.css is off-limits for this feature);
 * every rule is scoped to `.dv-xlsx-freeze`, which is only set on the
 * <table> while the "Закрепить первый столбец" toggle is on, so with the
 * toggle off the rules are inert.
 *
 * - `position: sticky; left: 0` pins the first cells while the table is
 *   scrolled horizontally (and is a no-op when the table fits — sticky
 *   never moves an element that hasn't reached its scrollport edge).
 * - Backgrounds are OPAQUE equivalents of the existing surfaces (header:
 *   muted 60% over card — same as Tailwind `bg-muted/60` composited over
 *   the `bg-card` wrapper; zebra: muted 20% over card — same as
 *   `even:bg-muted/20` composited over `bg-card`) so scrolled cells never
 *   show through the pinned column. `color-mix` is already relied upon by
 *   the Tailwind v4 alpha utilities used on this very table.
 * - The inset box-shadow keeps a 1px separator glued to the sticky cells:
 *   in `border-collapse` mode cell borders may not travel with a sticky
 *   cell, but the cell's own box-shadow always does.
 * - z-index: body cells sit above plain (unpositioned) cells but below the
 *   sticky header row (z-10); the top-left corner cell (header first
 *   child) sits above BOTH so it stays visible when scrolling diagonally.
 */
const FREEZE_COL_CSS = `
.dv-xlsx-freeze thead th:first-child,
.dv-xlsx-freeze tbody td:first-child {
  position: sticky;
  left: 0;
  box-shadow: inset -1px 0 0 0 var(--border);
}
.dv-xlsx-freeze thead th:first-child {
  z-index: 20;
  background-color: color-mix(in oklab, var(--muted) 60%, var(--card));
}
.dv-xlsx-freeze tbody td:first-child {
  z-index: 5;
  background-color: var(--card);
}
.dv-xlsx-freeze tbody tr:nth-child(even) td:first-child {
  background-color: color-mix(in oklab, var(--muted) 20%, var(--card));
}
`

/**
 * Search highlight rules for the table, two layers (both rendered as a
 * second local <style> next to FREEZE_COL_CSS inside the export/print
 * wrapper, so the rules travel with its clones — tints/marks in
 * exports/print are acceptable and documented):
 * 1. whole-cell tint/ring (.dv-hl-cell / .dv-hl-cell-active) — the matched
 *    cell stays easy to spot in a large grid;
 * 2. per-occurrence text marks (td/th mark.dv-hl [+-active]) — the same
 *    amber colours as the global .dv-hl marks in globals.css, re-declared
 *    scoped so clones of this wrapper are guaranteed styled even if the
 *    global sheet changes (identical values → the live DOM, where both
 *    rule sets apply and agree, never drifts).
 *
 * Specificity notes: with the frozen column ON the freeze rules restyle
 * first-column cells (OPAQUE backgrounds + the sticky separator
 * box-shadow) at (0,2,2). Therefore:
 * - the amber tint is a huge INSET box-shadow instead of background-color —
 *   an inset shadow paints ABOVE backgrounds, so the tint stays visible
 *   over the opaque sticky cells no matter who wins the cascade;
 * - the freeze-scoped selectors below (0,2,3) re-assert the highlight
 *   shadows on those sticky cells, out-specifying the separator rule (the
 *   ring simply replaces the 1px separator on the ringed cell).
 * Colours follow the global .dv-hl marks: amber oklch(0.85 0.16 85) light /
 * oklch(0.62 0.14 80) dark; the active match gets a stronger 2px
 * `--primary` ring. Cells matching the query get .dv-hl-cell; the active
 * match's cell gets .dv-hl-cell-active on top of it. The mark layer
 * mirrors the global mark colours (45% amber fill; active = opaque amber
 * background + dark text) and ships its own pulse keyframes under a unique
 * name, so the animation travels with clones instead of depending on
 * globals.css's dv-hl-pulse (guards match the global rule: reduced-motion
 * and print both disable it).
 */
const SEARCH_HL_CSS = `
.dv-hl-cell,
.dv-hl-cell-active {
  --dv-hl-fill: color-mix(in oklch, oklch(0.85 0.16 85) 30%, transparent);
  --dv-hl-edge: color-mix(in oklch, oklch(0.85 0.16 85) 55%, transparent);
}
.dark .dv-hl-cell,
.dark .dv-hl-cell-active {
  --dv-hl-fill: color-mix(in oklch, oklch(0.62 0.14 80) 38%, transparent);
  --dv-hl-edge: color-mix(in oklch, oklch(0.62 0.14 80) 60%, transparent);
}
.dv-hl-cell-active {
  --dv-hl-fill: color-mix(in oklch, oklch(0.85 0.16 85) 42%, transparent);
  --dv-hl-edge: var(--primary);
}
.dark .dv-hl-cell-active {
  --dv-hl-fill: color-mix(in oklch, oklch(0.62 0.14 80) 50%, transparent);
  --dv-hl-edge: var(--primary);
}
.dv-hl-cell,
table.dv-xlsx-freeze tbody td.dv-hl-cell,
table.dv-xlsx-freeze thead th.dv-hl-cell {
  /* Shadow order matters: the FIRST shadow paints on TOP, so the ring is
   * listed before the fill — otherwise the 999px tint would cover the ring
   * (verified by pixel sampling in the e2e pass). */
  box-shadow:
    inset 0 0 0 1px var(--dv-hl-edge),
    inset 0 0 0 999px var(--dv-hl-fill);
}
.dv-hl-cell-active,
table.dv-xlsx-freeze tbody td.dv-hl-cell-active,
table.dv-xlsx-freeze thead th.dv-hl-cell-active {
  box-shadow:
    inset 0 0 0 2px var(--dv-hl-edge),
    inset 0 0 0 999px var(--dv-hl-fill);
}
/* --- Per-occurrence text marks inside matched cells ---
 * The tint is an inset box-shadow (see above), which paints BELOW the
 * cell's inline content — so the marks sit on top of the tint and their
 * 45% amber fill composites over it into a visibly darker amber (≈30% tint
 * vs ≈62% mark): the tint strength is deliberately kept as-is. */
td mark.dv-hl,
th mark.dv-hl {
  background: color-mix(in oklch, oklch(0.85 0.16 85) 45%, transparent);
  color: inherit;
}
.dark td mark.dv-hl,
.dark th mark.dv-hl {
  background: color-mix(in oklch, oklch(0.62 0.14 80) 45%, transparent);
}
td mark.dv-hl-active,
th mark.dv-hl-active {
  background: oklch(0.76 0.16 70);
  color: oklch(0.24 0.04 70);
}
.dark td mark.dv-hl-active,
.dark th mark.dv-hl-active {
  background: oklch(0.68 0.15 70);
  color: oklch(0.16 0.02 70);
}
/* Scoped twin of globals.css's dv-hl-pulse (unique name → travels with
 * clones; identical timing/colour). */
@keyframes dv-xlsx-hl-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in oklch, oklch(0.76 0.16 70) 55%, transparent);
  }
  70% {
    box-shadow: 0 0 0 6px color-mix(in oklch, oklch(0.76 0.16 70) 0%, transparent);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
td mark.dv-hl-active,
th mark.dv-hl-active {
  animation: dv-xlsx-hl-pulse 0.5s ease-out 1;
}
@media (prefers-reduced-motion: reduce) {
  td mark.dv-hl-active,
  th mark.dv-hl-active {
    animation: none;
  }
}
@media print {
  td mark.dv-hl-active,
  th mark.dv-hl-active {
    animation: none;
  }
  td mark.dv-hl,
  th mark.dv-hl,
  td mark.dv-hl-active,
  th mark.dv-hl-active {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`

interface SheetData {
  rows: string[][]
  totalRows: number
  colCount: number
  truncated: boolean
  empty: boolean
}

/** One matched cell. `row` indexes `SheetData.rows` — 0 is the header row
 *  rendered in thead, tbody row n is `rows[n + 1]` (the flat list is still
 *  ordered sheet → row → col, which is what navigation walks). */
interface CellMatch {
  sheet: string
  row: number
  col: number
}

/** Escapes regex metacharacters so the query is matched literally. */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One piece of a matched cell's value: `hit` fragments are query
 *  occurrences (rendered as <mark>), everything else is plain text. */
interface CellSegment {
  text: string
  hit: boolean
}

/* Single-slot regex cache for splitCellSegments. That function runs once
 * per MATCHED cell per render (never for plain cells), and re-compiling the
 * query regex for every hit cell would be the dominant cost on broad
 * queries (one letter can match thousands of cells). One cached RegExp per
 * query string keeps the per-cell work a plain exec loop; lastIndex is
 * reset at the top of every call and the loop always runs to completion, so
 * the shared 'g' state can never leak between cells. */
let segmentQueryCache = ''
let segmentReCache: RegExp | null = null

/** Splits a cell value into segments around ALL case-insensitive literal
 *  occurrences of the query (exec-loop with 'g' → non-overlapping, in
 *  order; the 'i' flag never changes match length, so slices are exact —
 *  same pattern as the text/pptx viewers). Empty/whitespace query, an
 *  empty value or a regex-hostile query degrade to a single non-hit
 *  segment. */
function splitCellSegments(value: string, query: string): CellSegment[] {
  const q = query.trim()
  if (!q || value === '') return [{ text: value, hit: false }]
  if (segmentQueryCache !== q) {
    try {
      segmentReCache = new RegExp(escapeRegExp(q), 'gi')
    } catch {
      segmentReCache = null
    }
    segmentQueryCache = q
  }
  const re = segmentReCache
  if (!re) return [{ text: value, hit: false }]
  const segments: CellSegment[] = []
  let last = 0
  re.lastIndex = 0
  for (let m = re.exec(value); m !== null; m = re.exec(value)) {
    // A literal non-empty query can never match the empty string, so the
    // loop always advances and segments stay contiguous.
    if (m.index > last) {
      segments.push({ text: value.slice(last, m.index), hit: false })
    }
    segments.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last === 0) return [{ text: value, hit: false }]
  if (last < value.length) {
    segments.push({ text: value.slice(last), hit: false })
  }
  return segments
}

/** Segmented cell content: every query occurrence as <mark class="dv-hl">,
 *  and — for the ACTIVE cell — every occurrence as dv-hl-active ("one
 *  active cell ringed" + "text marks everywhere"). Module scope on purpose:
 *  a stable component identity lets React reconcile the marks across
 *  re-renders (zoom, freeze toggle, navigation) without remounting them.
 *  Rendered only for matched cells with a live query, so the segmentation
 *  cost is paid per HIT, not per cell. */
function CellText({
  value,
  query,
  active,
}: {
  value: string
  query: string
  active: boolean
}) {
  const segments = splitCellSegments(value, query)
  return (
    <>
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark key={i} className={cn('dv-hl', active && 'dv-hl-active')}>
            {seg.text}
          </mark>
        ) : (
          seg.text
        ),
      )}
    </>
  )
}

/** Russian plural forms for «совпадение» (1 / 2–4 / 5+). */
function pluralMatches(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'совпадение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'совпадения'
  }
  return 'совпадений'
}

function readSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
): SheetData {
  const ws = workbook.Sheets[sheetName]
  if (!ws) {
    return { rows: [], totalRows: 0, colCount: 0, truncated: false, empty: true }
  }
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
  const allRows: string[][] = raw.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) =>
      cell == null ? '' : String(cell),
    ),
  )
  const totalRows = allRows.length
  const truncated = totalRows > ROW_CAP
  const rows = truncated ? allRows.slice(0, ROW_CAP) : allRows
  const colCount = rows.reduce(
    (max, row) => (row.length > max ? row.length : max),
    0,
  )
  return { rows, totalRows, colCount, truncated, empty: totalRows === 0 }
}

export function XlsxViewer({ file }: ViewerProps) {
  /** Wraps the rendered table — export/print target (one long "page"). */
  const tableWrapRef = React.useRef<HTMLDivElement | null>(null)

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [workbook, setWorkbook] = React.useState<XLSX.WorkBook | null>(null)
  const [sheetNames, setSheetNames] = React.useState<string[]>([])
  const [activeSheet, setActiveSheet] = React.useState<string>('')

  /** Zoom factor 0.5–2.0 applied via CSS `zoom` (layout-affecting, so
   *  scrollbars work naturally). Per file: reset on file change. */
  const [zoom, setZoom] = React.useState(1)
  /** While exporting, the inner wrapper is forced to zoom 1 so html2canvas
   *  captures the table at its natural size. */
  const [exporting, setExporting] = React.useState(false)
  // «Night mode» — the shared, persisted global flag (see viewer-ui-store).
  // The marker class lands on the inner zoom wrapper (direct parent of the
  // <table>); the CSS inverts the table itself, so the scroll container and
  // its scrollbars stay natural. The class is dropped while exporting (the
  // capture must keep natural colours) and print clones strip it via
  // buildPrintClone.
  const nightMode = useViewerUiStore((s) => s.nightMode)
  const toggleNightMode = useViewerUiStore((s) => s.toggleNightMode)
  /** Freeze/pin the first column (horizontal sticky). Default off, reset on
   *  file change (same effect as zoom), persists across sheet switches. */
  const [frozenCol, setFrozenCol] = React.useState(false)

  // ---- Search (spans ALL sheets, live counter) ----
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  /** Bumped on every explicit navigation (submit / prev / next) so the
   *  scroll-into-view effect re-runs even when the index is unchanged. */
  const [navTick, setNavTick] = React.useState(0)
  /** Query as of the last submit — Enter with an unchanged query advances to
   *  the next match instead of restarting from the first one (text-viewer
   *  semantics). */
  const lastSubmittedRef = React.useRef('')
  /** Hosts the ringed cell of the active match (callback ref, attached only
   *  to the active cell of the rendered sheet). */
  const activeCellElRef = React.useRef<HTMLElement | null>(null)
  const activeCellRefCb = React.useCallback((el: HTMLElement | null) => {
    activeCellElRef.current = el
  }, [])

  React.useEffect(() => {
    let isCancelled = false

    setLoading(true)
    setError(null)
    setWorkbook(null)
    setSheetNames([])
    setActiveSheet('')
    setZoom(1)
    setFrozenCol(false)
    setQuery('')
    setActiveIndex(0)
    setNavTick(0)
    lastSubmittedRef.current = ''

    try {
      const wb = XLSX.read(file.arrayBuffer, { type: 'array' })
      if (isCancelled) return
      const names = (wb.SheetNames ?? []).filter(Boolean)
      if (names.length === 0) {
        setError('В книге нет листов')
        setLoading(false)
        return
      }
      setWorkbook(wb)
      setSheetNames(names)
      setActiveSheet(names[0])
      setLoading(false)
    } catch (err) {
      if (isCancelled) return
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error('Не удалось открыть таблицу', { description: msg })
      setLoading(false)
    }

    return () => {
      isCancelled = true
    }
  }, [file.id, file.arrayBuffer])

  /** All sheets parsed ONCE per workbook (workbook order): search spans
   *  every sheet, and the active sheet is looked up from this list (avoids
   *  re-parsing the active sheet on each tab switch). */
  const allSheets = React.useMemo<Array<{ name: string; data: SheetData }>>(
    () => {
      if (!workbook) return []
      return sheetNames.map((name) => ({
        name,
        data: readSheet(workbook, name),
      }))
    },
    [workbook, sheetNames],
  )

  const sheet = React.useMemo<SheetData | null>(
    () => allSheets.find((s) => s.name === activeSheet)?.data ?? null,
    [allSheets, activeSheet],
  )

  /** Lowercased cell matrix per sheet — computed once per workbook so the
   *  per-keystroke match scan never re-lowercases every cell. */
  const allSheetsLower = React.useMemo(
    () =>
      allSheets.map(({ name, data }) => ({
        name,
        rows: data.rows.map((row) => row.map((cell) => cell.toLowerCase())),
      })),
    [allSheets],
  )

  /** Flat ordered match list (sheet order → row order → col order), one
   *  entry PER CELL (case-insensitive substring on the cell value).
   *  Synchronous memo: the counter and the tints update as the user types,
   *  no submit needed. Rows already respect the ROW_CAP render limit, so
   *  every counted match also has a renderable cell. */
  const matches = React.useMemo<CellMatch[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const result: CellMatch[] = []
    for (const s of allSheetsLower) {
      for (let ri = 0; ri < s.rows.length; ri++) {
        const row = s.rows[ri]
        for (let ci = 0; ci < row.length; ci++) {
          if (row[ci].includes(q)) {
            result.push({ sheet: s.name, row: ri, col: ci })
          }
        }
      }
    }
    return result
  }, [allSheetsLower, query])

  const total = matches.length
  /** Clamp so query edits that shrink the match list keep the index valid. */
  const activeIdx = total > 0 ? Math.min(activeIndex, total - 1) : 0
  const activeMatch = total > 0 ? matches[activeIdx] : null
  /** Row/col of the active match WHEN it lives on the rendered sheet (only
   *  then can a cell be ringed — marks on the other sheets appear once the
   *  user navigates to them and the sheet switches). */
  const activeRC =
    activeMatch && activeMatch.sheet === activeSheet
      ? { row: activeMatch.row, col: activeMatch.col }
      : null

  /** Matched columns per row ON THE ACTIVE SHEET — drives the cell tints
   *  (Set lookups keep the per-cell render cost near zero). */
  const sheetMatchColsByRow = React.useMemo(() => {
    if (matches.length === 0) return null
    const map = new Map<number, Set<number>>()
    for (const m of matches) {
      if (m.sheet !== activeSheet) continue
      let cols = map.get(m.row)
      if (!cols) {
        cols = new Set<number>()
        map.set(m.row, cols)
      }
      cols.add(m.col)
    }
    return map.size > 0 ? map : null
  }, [matches, activeSheet])

  /** Search is useless only when NO sheet has any data — it spans all
   *  sheets, so an empty ACTIVE sheet must not disable it. */
  const searchDisabled =
    allSheets.length === 0 || allSheets.every((s) => s.data.empty)

  /** Jump to match #idx: when it lives on another sheet, switch there too —
   *  React batches both updates, so the scroll effect below sees the new
   *  sheet's table with the ringed cell already rendered. */
  const goTo = React.useCallback(
    (idx: number) => {
      setActiveIndex(idx)
      const m = matches[idx]
      if (m && m.sheet !== activeSheet) setActiveSheet(m.sheet)
      setNavTick((t) => t + 1)
    },
    [matches, activeSheet],
  )

  const goNext = React.useCallback(() => {
    if (total === 0) return
    goTo((activeIdx + 1) % total)
  }, [total, activeIdx, goTo])

  const goPrev = React.useCallback(() => {
    if (total === 0) return
    goTo((activeIdx - 1 + total) % total)
  }, [total, activeIdx, goTo])

  const handleSubmit = React.useCallback(() => {
    if (total === 0) {
      toast.message(`«${query}» не найдено`)
      return
    }
    if (lastSubmittedRef.current === query) {
      goTo((activeIdx + 1) % total)
    } else {
      lastSubmittedRef.current = query
      goTo(0)
    }
    toast.success(`Найдено ${total} ${pluralMatches(total)}`)
  }, [total, query, activeIdx, goTo])

  const handleClear = React.useCallback(() => {
    setQuery('')
    setActiveIndex(0)
    lastSubmittedRef.current = ''
  }, [])

  /* Centre the ringed cell after explicit navigation (submit / prev /
   * next) and after a sheet switch (goTo can switch the sheet together
   * with the index; a manual tab switch re-centres as well when the active
   * match lives on the newly opened sheet). Typing never moves the
   * viewport — the counter and tints update live, scrolling happens on
   * navigation only (text-viewer semantics). One rAF lets the layout
   * settle (fresh table + CSS zoom) before the smooth scroll starts; if
   * the ringed cell is not in the DOM, the ref stays null and the scroll
   * is simply skipped. */
  React.useEffect(() => {
    const el = activeCellElRef.current
    if (!el) return
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [navTick, activeSheet])

  const handleCopyCsv = React.useCallback(async () => {
    if (!workbook || !activeSheet) return
    try {
      const ws = workbook.Sheets[activeSheet]
      if (!ws) return
      const csv = XLSX.utils.sheet_to_csv(ws)
      await navigator.clipboard.writeText(csv)
      toast.success('Лист скопирован как CSV')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Не удалось скопировать', { description: msg })
    }
  }, [workbook, activeSheet])

  const handleZoomIn = React.useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))
  }, [])

  const handleZoomOut = React.useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))
  }, [])

  const handleZoomReset = React.useCallback(() => setZoom(1), [])

  const handleToggleFreezeCol = React.useCallback(() => {
    setFrozenCol((v) => !v)
  }, [])

  /**
   * Screenshot the whole table (a single tall element) and slice it into
   * A4-proportioned PDF pages. Progress/success/error toasts are handled
   * by the shell.
   *
   * The CSS zoom must be dropped first: html2canvas would capture the
   * zoomed table at the wrong scale, so we re-render with zoom 1, wait for
   * React to flush the DOM (2 animation frames), export, then restore.
   */
  const handleExportPdf = React.useCallback(async () => {
    const el = tableWrapRef.current
    if (!el) return
    setExporting(true)
    try {
      await nextFrames(2)
      await exportElementToPdf(el, file.name, {
        slice: true,
        sliceAspectRatio: Math.SQRT2,
      })
    } finally {
      setExporting(false)
    }
  }, [file.name])

  if (loading) {
    return (
      <div className="dv-scroll h-full overflow-auto">
        <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm">Чтение таблицы…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dv-scroll h-full overflow-auto">
        <div className="mx-auto max-w-[640px] px-4 py-8">
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">Не удалось открыть таблицу</p>
              <p className="mt-1 break-words">{error}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!workbook || !sheet) {
    return null
  }

  const singleSheetName = sheetNames.length === 1 ? sheetNames[0] : null
  /** Trimmed query — same normalization as the matches memo, so `isMatch`
   *  implies it is non-empty; the belt-and-braces check keeps the marks from
   *  rendering even if a future edit decouples the two. */
  const trimmedQuery = query.trim()

  return (
    <ViewerShell
      file={file}
      category="xlsx"
      busy={loading}
      zoom={{
        value: Math.round(zoom * 100),
        min: ZOOM_MIN * 100,
        max: ZOOM_MAX * 100,
        onZoomIn: handleZoomIn,
        onZoomOut: handleZoomOut,
        onReset: handleZoomReset,
        isReset: Math.abs(zoom - 1) < 0.001,
      }}
      centerExtra={
        /* Layout note: the shell's centre cell is `min-w-max`, so this group
         * must stay rem-capped (same solution as the text viewer) — otherwise
         * the toolbar would overflow the shell into the metadata panel. The
         * search form takes its own full-width row (it is flex-basis-0 and
         * needs real free space), sheet stats + the freeze toggle wrap
         * below it. Caps: 28rem from md, 43rem from xl. */
        <div className="flex flex-wrap items-center justify-center gap-1.5 md:max-w-[28rem] xl:max-w-[43rem]">
          <div className="flex w-full min-w-0 items-center justify-center gap-1.5">
            <ShellSearch
              value={query}
              onChange={setQuery}
              onSubmit={handleSubmit}
              onPrev={goPrev}
              onNext={goNext}
              onClear={handleClear}
              total={total}
              activeIndex={activeIdx}
              disabled={searchDisabled}
              placeholder="Поиск по таблице…"
              label="Поиск по таблице"
            />
          </div>

          <span className="inline-flex min-w-0 flex-wrap items-center justify-center gap-1.5">
            {singleSheetName != null && (
              <span
                className="hidden max-w-[220px] items-center gap-1.5 text-xs font-medium md:inline-flex"
                title={singleSheetName}
              >
                <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{singleSheetName}</span>
              </span>
            )}
            <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
              {sheet.totalRows} строк × {sheet.colCount} столбцов
            </span>
            <Button
              type="button"
              variant={frozenCol ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleToggleFreezeCol}
              disabled={sheet.empty}
              aria-pressed={frozenCol}
              title={
                frozenCol
                  ? 'Открепить первый столбец'
                  : 'Закрепить первый столбец'
              }
              aria-label={
                frozenCol
                  ? 'Открепить первый столбец'
                  : 'Закрепить первый столбец'
              }
            >
              {frozenCol ? (
                <PinOff className="size-3.5" />
              ) : (
                <Pin className="size-3.5" />
              )}
              <span className="hidden sm:inline">Столбец</span>
            </Button>
          </span>
        </div>
      }
      toolbarEnd={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={handleCopyCsv}
            disabled={sheet.empty}
            title="Скопировать активный лист как CSV"
          >
            <Copy className="size-3.5" />
            <span className="hidden sm:inline">Скопировать как CSV</span>
            <span className="sm:hidden">CSV</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'size-8 text-muted-foreground',
              nightMode &&
                'bg-accent/70 text-accent-foreground hover:bg-accent',
            )}
            onClick={toggleNightMode}
            aria-pressed={nightMode}
            title={
              nightMode
                ? 'Выключить ночной режим (вернуть естественные цвета)'
                : 'Ночной режим — инверсия цветов страниц'
            }
            aria-label={
              nightMode
                ? 'Выключить ночной режим'
                : 'Включить ночной режим'
            }
          >
            {nightMode ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>
        </>
      }
      download={{ mode: 'screenshot' }}
      onExportPdf={handleExportPdf}
      printRootRef={tableWrapRef}
      thumbs={
        sheetNames.length > 0 ? (
          <nav className="flex flex-col gap-0.5" aria-label="Листы книги">
            <p className="px-1.5 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Листы ({sheetNames.length})
            </p>
            {sheetNames.map((name) => (
              <button
                key={name}
                type="button"
                className="dv-sheet-item"
                data-active={name === activeSheet ? 'true' : 'false'}
                onClick={() => setActiveSheet(name)}
                aria-current={name === activeSheet}
                title={name}
              >
                <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate" title={name}>
                  {name}
                </span>
              </button>
            ))}
          </nav>
        ) : null
      }
      thumbsLabel="Листы книги"
    >
      {/* Table scroll area */}
      <div className="dv-scroll h-full flex-1 overflow-auto">
        {sheet.truncated && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            Показаны первые {ROW_CAP} строк из {sheet.totalRows}
          </div>
        )}
        {sheet.empty ? (
          <div className="flex h-full min-h-[200px] items-center justify-center p-8 text-sm text-muted-foreground">
            Лист пуст
          </div>
        ) : (
          <div
            ref={tableWrapRef}
            data-dv-page="1"
            className="w-max bg-card"
          >
            {/* Styles for the frozen-first-column mode (scoped to the
                .dv-xlsx-freeze class — see FREEZE_COL_CSS). Rendered here so
                they travel with the export/print clones of this wrapper. */}
            <style dangerouslySetInnerHTML={{ __html: FREEZE_COL_CSS }} />
            {/* Search highlight rules (the dv-hl-cell tint/ring classes on
                td/th + the scoped td/th mark.dv-hl rules — see
                SEARCH_HL_CSS). Also rendered inside the wrapper so the
                styles travel with export/print clones. */}
            <style dangerouslySetInnerHTML={{ __html: SEARCH_HL_CSS }} />
            {/* Inner wrapper carries the CSS `zoom` (layout-affecting, so
                the outer scroll container sizes/scrollbars adapt naturally).
                Forced to 1 while exporting so the capture stays natural.
                It also carries the `dv-night` marker (also dropped while
                exporting) — the CSS inverts the direct-child <table>. */}
            <div
              style={{ zoom: exporting ? 1 : zoom }}
              className={cn(nightMode && !exporting && 'dv-night')}
            >
              <table
                className={cn(
                  'border-collapse text-sm',
                  frozenCol && 'dv-xlsx-freeze',
                )}
              >
                <thead>
                  <tr>
                    {Array.from({ length: sheet.colCount }, (_, i) => {
                      const value = sheet.rows[0]?.[i] ?? ''
                      const isMatch =
                        sheetMatchColsByRow?.get(0)?.has(i) ?? false
                      const isActive =
                        activeRC != null &&
                        activeRC.row === 0 &&
                        activeRC.col === i
                      return (
                        <th
                          key={i}
                          title={value}
                          ref={isActive ? activeCellRefCb : undefined}
                          className={cn(
                            'sticky top-0 z-10 border border-border bg-muted/60 px-2 py-1 text-left align-bottom font-medium',
                            'max-w-[300px] truncate whitespace-nowrap',
                            isMatch && 'dv-hl-cell',
                            isActive && 'dv-hl-cell-active',
                          )}
                        >
                          {/* Per-occurrence marks inside matched cells
                              (tint/ring classes stay above — see
                              SEARCH_HL_CSS for the layering rationale). */}
                          {value === '' ? (
                            '\u00A0'
                          ) : isMatch && trimmedQuery ? (
                            <CellText value={value} query={query} active={isActive} />
                          ) : (
                            value
                          )}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.slice(1).map((row, ri) => (
                    <tr key={ri} className="even:bg-muted/20">
                      {Array.from({ length: sheet.colCount }, (_, ci) => {
                        const value = row[ci] ?? ''
                        const numeric = NUMERIC_RE.test(value.trim())
                        const isMatch =
                          sheetMatchColsByRow?.get(ri + 1)?.has(ci) ?? false
                        const isActive =
                          activeRC != null &&
                          activeRC.row === ri + 1 &&
                          activeRC.col === ci
                        return (
                          <td
                            key={ci}
                            title={value}
                            ref={isActive ? activeCellRefCb : undefined}
                            className={cn(
                              'border border-border px-2 py-1 align-top',
                              'max-w-[300px] truncate whitespace-nowrap',
                              numeric && 'text-right tabular-nums',
                              isMatch && 'dv-hl-cell',
                              isActive && 'dv-hl-cell-active',
                            )}
                          >
                            {/* Per-occurrence marks inside matched cells
                                (tint/ring classes stay above — see
                                SEARCH_HL_CSS for the layering rationale). */}
                            {value === '' ? (
                              '\u00A0'
                            ) : isMatch && trimmedQuery ? (
                              <CellText value={value} query={query} active={isActive} />
                            ) : (
                              value
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </ViewerShell>
  )
}
