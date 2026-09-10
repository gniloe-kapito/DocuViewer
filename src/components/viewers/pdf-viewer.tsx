'use client'

import * as React from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist'
import { toast } from 'sonner'
import { AlertTriangle, ChevronRight, Loader2, Moon, Sun } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { ShellSearch, ViewerShell } from '@/components/viewer-shell'
import { useViewerUiStore } from '@/lib/viewer-ui-store'
import { cn } from '@/lib/utils'
import type { LoadedFile } from '@/lib/viewers/types'

// Pin the worker source to the installed version via CDN. This is the most
// reliable cross-bundler approach for static hosting / GitHub Pages deploys.
// On failure, fall back to an empty worker source (disables the worker —
// slower but still functional).
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
} catch {
  pdfjsLib.GlobalWorkerOptions.workerSrc = ''
}

interface ViewerProps {
  file: LoadedFile
}

/**
 * A single search hit — the FLAT, per-match search list (one entry per
 * occurrence, in document order). `posIndex` points into `matchPos[page]`
 * (the match's character range inside that page's cached text items), so
 * the total number of matches is `searchResults.length` — the same
 * per-match semantics as the TXT/DOCX viewers.
 */
interface SearchMatch {
  page: number
  posIndex: number
}

/** Minimal shape of a pdf.js text item used for search & highlights. */
interface PdfTextItem {
  str: string
  /** [a, b, c, d, e, f] text-space → user-space transform. */
  transform: number[]
  /** Advance width of `str` in user-space units (at scale 1). */
  width: number
  fontName?: string
  /**
   * Cumulative per-character advance boundaries in user units
   * (length str.length + 1), normalized so the last entry equals `width`.
   * Undefined for items without matches or when measurement is unreliable
   * (the geometry then falls back to a proportional character split).
   */
  charX?: number[]
}

/** Character range of a single match inside one text item. */
interface MatchPos {
  itemIndex: number
  start: number
  end: number
}

/** Highlight rectangle in CSS px, relative to the page container. */
interface HlRect {
  left: number
  top: number
  width: number
  height: number
  /**
   * Flat (global) index of the match this rect belongs to — its index in
   * the per-match `searchResults` list. Used to mark the ACTIVE match's
   * rect (and only that one) with `dv-hl-rect-active`.
   */
  matchIndex: number
}

const MIN_SCALE = 0.5
const MAX_SCALE = 3.0
const DEFAULT_SCALE = 1.2
const SCALE_STEP = 0.1
const THUMB_SCALE = 0.25
/**
 * Render-window radius: only main pages within ±PAGE_RENDER_RADIUS of the
 * current page hold live canvas bitmaps; every other page is a freed
 * placeholder (window-based virtualization for 500+ page documents).
 */
const PAGE_RENDER_RADIUS = 4
/**
 * Documents at or below this page count skip windowing entirely — every
 * page renders (and stays rendered), matching the classic behaviour for
 * typical files and keeping print/scroll trivially simple.
 */
const SMALL_DOC_PAGES = 24
/** Pre-render margin around the visible band of the thumbnails sidebar. */
const THUMB_OBSERVER_MARGIN = '200px 0px'
/** Horizontal padding of the pages host: px-2 (16px) / sm:px-4 (32px). */
const PAGE_PAD_XS = 16
const PAGE_PAD_SM = 32
/** Small safety margin so pages never touch the scrollbar edge. */
const FIT_MARGIN = 8
/** Fit recomputations below this scale delta are skipped (loop guard). */
const FIT_EPSILON = 0.005
/** rAF retries for centering the active match rect after a navigation. */
const RECT_SCROLL_RETRIES_NAV = 12
/** rAF retries for the initial jump after a fresh search (the highlight
 * geometry effect computes the rects asynchronously). */
const RECT_SCROLL_RETRIES_SEARCH = 60

/** Escape a literal string for safe use inside a RegExp. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Russian plural form: one / few / many. */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/** Lazily-created 2D context for measuring per-character text advances. */
let measureCtx: CanvasRenderingContext2D | null | undefined

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d')
    } catch {
      measureCtx = null
    }
  }
  return measureCtx
}

/**
 * Measure per-character advance boundaries (user units) with the browser's
 * metric-compatible fallback font, normalized so the final boundary equals
 * the item's real advance (spreads the kerning/rounding error and makes
 * full-item matches exact). Returns undefined when the measurement is
 * unavailable or clearly unreliable — the caller then falls back to a
 * proportional character split.
 */
function measureCharOffsets(
  str: string,
  fontSize: number,
  family: string | undefined,
  totalWidth: number,
): number[] | undefined {
  if (!str || !(fontSize > 0) || !(totalWidth > 0)) return undefined
  const ctx = getMeasureContext()
  if (!ctx) return undefined
  try {
    ctx.font = `${fontSize}px ${family || 'sans-serif'}`
    const cum = new Array<number>(str.length + 1)
    cum[0] = 0
    let sum = 0
    for (let i = 0; i < str.length; i++) {
      sum += ctx.measureText(str[i]).width
      cum[i + 1] = sum
    }
    if (!(sum > 0)) return undefined
    const factor = totalWidth / sum
    if (!Number.isFinite(factor) || factor < 0.2 || factor > 5) {
      return undefined
    }
    return cum.map((v) => v * factor)
  } catch {
    return undefined
  }
}

/** Attach measured char offsets to a matched item (idempotent). */
function applyCharOffsets(
  item: PdfTextItem,
  styles: Record<string, { fontFamily?: string }> | undefined,
): void {
  if (item.charX !== undefined) return
  const fsUser = Math.hypot(item.transform[2] || 0, item.transform[3] || 0)
  const family = item.fontName
    ? styles?.[item.fontName]?.fontFamily
    : undefined
  item.charX = measureCharOffsets(item.str, fsUser, family, item.width)
}

/* ------------------------------------------------------------------ */
/*  Document outline (bookmarks / «Оглавление»)                        */
/* ------------------------------------------------------------------ */

/** Parsed outline node with a resolved 1-based destination page. */
interface OutlineNode {
  key: string
  title: string
  page: number | null
  items: OutlineNode[]
}

/** Raw node shape returned by `PDFDocumentProxy.getOutline()`. */
type RawOutlineNode = {
  title?: string
  dest?: unknown
  items?: RawOutlineNode[]
}

/** Resolve a bookmark destination (named or direct) to a 1-based page. */
async function resolveOutlinePage(
  doc: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  try {
    let d = dest
    if (typeof d === 'string') d = await doc.getDestination(d)
    if (
      Array.isArray(d) &&
      d[0] &&
      typeof d[0] === 'object' &&
      'num' in (d[0] as Record<string, unknown>)
    ) {
      const idx = await doc.getPageIndex(d[0] as { num: number; gen: number })
      return idx + 1
    }
  } catch {
    // Unresolvable / external destinations are simply not clickable.
  }
  return null
}

/** Recursively convert raw pdf.js outline nodes to our parsed shape. */
async function parseOutline(
  doc: PDFDocumentProxy,
  nodes: RawOutlineNode[] | null | undefined,
  prefix: string,
): Promise<OutlineNode[]> {
  if (!nodes || nodes.length === 0) return []
  const out: OutlineNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const key = `${prefix}${i}`
    const page = await resolveOutlinePage(doc, n.dest)
    out.push({
      key,
      title: (n.title ?? '').trim(),
      page,
      items: await parseOutline(doc, n.items, `${key}.`),
    })
  }
  return out
}

interface OutlineTreeProps {
  nodes: OutlineNode[]
  depth: number
  collapsed: ReadonlySet<string>
  onToggle: (key: string) => void
  activeKey: string | null
  onGo: (page: number) => void
}

/** Recursive outline list — «Adobe-style» bookmarks with expand carets. */
function OutlineTree({
  nodes,
  depth,
  collapsed,
  onToggle,
  activeKey,
  onGo,
}: OutlineTreeProps) {
  return (
    <ul
      className={cn(
        depth === 0 ? 'm-0' : 'ml-2.5 border-l border-border/60 pl-1',
      )}
    >
      {nodes.map((n) => {
        const hasChildren = n.items.length > 0
        const isCollapsed = collapsed.has(n.key)
        const isActive = n.key === activeKey
        return (
          <li key={n.key}>
            <div className="flex items-center gap-0.5">
              {hasChildren ? (
                <button
                  type="button"
                  className="dv-outline-twist"
                  onClick={() => onToggle(n.key)}
                  aria-label={
                    isCollapsed
                      ? `Развернуть «${n.title}»`
                      : `Свернуть «${n.title}»`
                  }
                  aria-expanded={!isCollapsed}
                >
                  <ChevronRight
                    className={cn(
                      'size-3 transition-transform duration-150',
                      !isCollapsed && 'rotate-90',
                    )}
                  />
                </button>
              ) : (
                <span className="dv-outline-dot" aria-hidden="true" />
              )}
              <button
                type="button"
                className="dv-outline-item"
                data-active={isActive ? 'true' : 'false'}
                onClick={() => {
                  if (n.page != null) onGo(n.page)
                }}
                title={
                  n.page != null ? `${n.title} — страница ${n.page}` : n.title
                }
                aria-current={isActive ? 'true' : undefined}
              >
                <span className="min-w-0 flex-1 truncate">{n.title}</span>
                {n.page != null && (
                  <span className="dv-outline-page" aria-hidden="true">
                    {n.page}
                  </span>
                )}
              </button>
            </div>
            {hasChildren && !isCollapsed && (
              <OutlineTree
                nodes={n.items}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                activeKey={activeKey}
                onGo={onGo}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function PdfViewer({ file }: ViewerProps) {
  const [pdfDoc, setPdfDoc] = React.useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = React.useState(0)
  const [scale, setScale] = React.useState(DEFAULT_SCALE)
  const [currentPage, setCurrentPage] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [renderedPages, setRenderedPages] = React.useState<Set<number>>(
    new Set(),
  )
  // Thumbnails currently inside the sidebar's visible band (+ margin) —
  // drives the visible-only thumbnail rendering.
  const [visibleThumbPages, setVisibleThumbPages] = React.useState<
    ReadonlySet<number>
  >(new Set())
  // "Render every page" mode — activated while preparing a print, so the
  // print clone (which snapshots live canvases) sees full bitmaps.
  const [renderAllPages, setRenderAllPages] = React.useState(false)
  // True while the print preparation renders every page (busy feedback).
  const [preparingPrint, setPreparingPrint] = React.useState(false)
  // Page-1 dimensions (state mirror of page1WidthRef/page1HeightRef) —
  // provides the aspect-ratio placeholder for un-rendered page slots.
  const [page1Size, setPage1Size] = React.useState<{
    w: number
    h: number
  } | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  // Flat list of individual matches (one entry per occurrence, in document
  // order) — `searchIndex` points at the active one and the total equals the
  // list length.
  const [searchResults, setSearchResults] = React.useState<SearchMatch[]>([])
  const [searchIndex, setSearchIndex] = React.useState(0)
  // Per-page match character ranges (page → ranges inside the cached text
  // items) — drives the in-page highlight rectangles.
  const [matchPos, setMatchPos] = React.useState<
    Record<number, MatchPos[]>
  >({})
  // Computed highlight rectangles per page (CSS px, relative to the page
  // container). Recomputed on zoom / rotation / search / layout changes.
  const [hlRects, setHlRects] = React.useState<Record<number, HlRect[]>>({})
  // Width of the pages scroll container (ResizeObserver below) — retriggers
  // the highlight geometry when the layout changes without a scale change
  // (manual zoom + panel/sidebar toggles).
  const [containerW, setContainerW] = React.useState(0)
  // "Fit width" mode: on by default, disabled by any manual zoom and
  // re-enabled by the reset button. While active, a ResizeObserver keeps the
  // pages as wide as the scroll container (the container width changes when
  // the right metadata panel / left thumbnails sidebar is toggled, on window
  // resize and in fullscreen).
  const [fitWidth, setFitWidth] = React.useState(true)
  const [fitScale, setFitScale] = React.useState<number | null>(null)
  // Mirror of `fitWidth` so `recomputeFit` reads the fresh mode without the
  // state being part of its dependencies (avoids effect loops).
  const fitWidthRef = React.useRef(fitWidth)
  React.useEffect(() => {
    fitWidthRef.current = fitWidth
  })
  // Extra rotation applied on top of each page's intrinsic rotation
  // (0 / 90 / 180 / 270). Reset to 0 whenever a new file is opened.
  const [rotation, setRotation] = React.useState(0)
  // Parsed document outline («Оглавление»), null when the PDF has none.
  const [outline, setOutline] = React.useState<OutlineNode[] | null>(null)
  // Keys of the collapsed outline nodes (everything is expanded by default).
  const [collapsedOutline, setCollapsedOutline] = React.useState<
    ReadonlySet<string>
  >(new Set())

  // Refs
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const pagesWrapRef = React.useRef<HTMLDivElement | null>(null)
  const pageRefs = React.useRef<(HTMLDivElement | null)[]>([])
  const canvasRefs = React.useRef<(HTMLCanvasElement | null)[]>([])
  const thumbCanvasRefs = React.useRef<(HTMLCanvasElement | null)[]>([])
  const loadingTaskRef = React.useRef<PDFDocumentLoadingTask | null>(null)
  const docRef = React.useRef<PDFDocumentProxy | null>(null)
  // In-flight MAIN-page RenderTasks, keyed by page. The entry remembers
  // the task's scale/rotation: a superseding pass lets a matching in-flight
  // task finish (its completion path does the bookkeeping) but cancels one
  // started under a zoom/rotation that has since changed.
  const renderTasksRef = React.useRef<
    Map<number, { task: RenderTask; scale: number; rotation: number }>
  >(new Map())
  const ratiosRef = React.useRef<Map<number, number>>(new Map())
  // Text items per page, cached while a search is active so highlight
  // recomputation (zoom/rotate) does not re-extract the page text. The
  // items are plain JS objects — page.cleanup() does not invalidate them.
  const textItemsRef = React.useRef<Map<number, PdfTextItem[]>>(new Map())
  const renderedThumbsRef = React.useRef<Set<number>>(new Set())
  /* ---- Virtualization bookkeeping (large PDFs, 500+ pages) ---- */
  // Mirror of the `renderedPages` state for the async render passes: the ref
  // is the source of truth for the loops; the state is the React snapshot
  // flushed once per pass (see flushRenderedPages).
  const renderedPagesRef = React.useRef<Set<number>>(new Set())
  // Per-page render parameters (scale/rotation) of the CURRENT bitmap in
  // each canvas. A page whose entry is missing holds no bitmap (freed);
  // one with stale params is re-rendered in place on zoom/rotate.
  const pageBitmapsRef = React.useRef<
    Map<number, { scale: number; rotation: number }>
  >(new Map())
  // The render window of the LATEST pass — lets a superseded pass decide
  // whether its just-finished page is still wanted.
  const currentWindowRef = React.useRef<Set<number>>(new Set())
  // One-shot explicit-jump target (pageNav / search navigation / outline /
  // thumbnail clicks). Set by scrollToPage, consumed by the render pass to
  // re-align the scroll once the target page's real bitmap is in.
  const pendingScrollTargetRef = React.useRef<number | null>(null)
  // Thumbnail RenderTasks (per page) — visibility passes share this map;
  // the doc-lifecycle effect cancels them on file change / unmount.
  const thumbTasksRef = React.useRef<Map<number, RenderTask>>(new Map())
  // Thumbnails inside the sidebar's visible band. Painted thumbnails are
  // never un-rendered (0.25-scale bitmaps are small).
  const visibleThumbPagesRef = React.useRef<Set<number>>(new Set())
  // Render-everything mode (print preparation) and its resolver.
  const renderAllPagesRef = React.useRef(false)
  const renderAllResolveRef = React.useRef<(() => void) | null>(null)
  // Deferred release of the print render-everything window — re-narrows the
  // render window (freeing the out-of-window bitmaps) once the print dialog
  // has closed. See armPrintWindowRelease next to prepareForPrint.
  const printWindowReleaseRef = React.useRef<{
    release: () => void
    cancel: () => void
  } | null>(null)
  // Sidebar visibility (zustand, persisted) — subscribed EARLY because the
  // thumbnail virtualization effects below gate on it.
  const thumbsOpen = useViewerUiStore((s) => s.thumbsOpen)
  // Page 1 dimensions at scale 1 with no extra rotation, cached right after
  // the document loads so the fit recomputation stays synchronous. At extra
  // rotation 90/270 the effective page width equals the base height.
  const page1WidthRef = React.useRef<number | null>(null)
  const page1HeightRef = React.useRef<number | null>(null)

  // Stable ref callbacks (avoid per-render ref churn). The page index is read
  // from a data attribute so the callbacks don't close over the loop variable.
  const setPageRef = React.useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const num = Number(el.dataset.pageNumber || '0')
    if (num) pageRefs.current[num - 1] = el
  }, [])
  const setCanvasRef = React.useCallback((el: HTMLCanvasElement | null) => {
    if (!el) return
    const num = Number(el.dataset.pageNumber || '0')
    if (num) canvasRefs.current[num - 1] = el
  }, [])
  // Separate ref callback for thumbnail canvases so they never collide with
  // the main page canvases.
  const setThumbCanvasRef = React.useCallback((el: HTMLCanvasElement | null) => {
    if (!el) return
    const num = Number(el.dataset.pageNumber || '0')
    if (num) thumbCanvasRefs.current[num - 1] = el
  }, [])

  // Keep docRef in sync so async loops can read the latest doc safely.
  React.useEffect(() => {
    docRef.current = pdfDoc
  }, [pdfDoc])

  // ---- Document loading ----
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPdfDoc(null)
    setNumPages(0)
    setRenderedPages(new Set())
    setVisibleThumbPages(new Set())
    setRenderAllPages(false)
    setPreparingPrint(false)
    setPage1Size(null)
    setCurrentPage(1)
    setSearchResults([])
    setSearchIndex(0)
    setSearchQuery('')
    setMatchPos({})
    setHlRects({})
    // Reset the fit-width mode and the rotation for the new document.
    setFitWidth(true)
    setFitScale(null)
    setRotation(0)
    setOutline(null)
    setCollapsedOutline(new Set())
    ratiosRef.current = new Map()
    pageRefs.current = []
    canvasRefs.current = []
    thumbCanvasRefs.current = []
    renderedThumbsRef.current = new Set()
    // Reset the virtualization bookkeeping for the new document. A pending
    // print preparation is released first — its render-all pass is about to
    // be torn down by the doc swap, and the print flow must never hang.
    renderAllResolveRef.current?.()
    renderAllResolveRef.current = null
    renderAllPagesRef.current = false
    renderedPagesRef.current = new Set()
    pageBitmapsRef.current = new Map()
    currentWindowRef.current = new Set()
    pendingScrollTargetRef.current = null
    visibleThumbPagesRef.current = new Set()
    thumbTasksRef.current = new Map()
    textItemsRef.current = new Map()
    page1WidthRef.current = null
    page1HeightRef.current = null

    // Cancel any previous loading task and destroy previous doc.
    const prevTask = loadingTaskRef.current
    if (prevTask) {
      try {
        void prevTask.destroy()
      } catch {
        /* ignore */
      }
    }
    loadingTaskRef.current = null
    if (docRef.current) {
      try {
        void docRef.current.loadingTask.destroy()
      } catch {
        /* ignore */
      }
      docRef.current = null
    }

    // pdfjs may detach (transfer) the ArrayBuffer it receives. Pass a fresh
    // copy so the original LoadedFile.arrayBuffer stays intact if the user
    // re-opens the same file.
    let data: Uint8Array
    try {
      data = new Uint8Array(file.arrayBuffer.slice(0))
    } catch {
      cancelled = true
      setError('Не удалось прочитать данные файла.')
      toast.error('Не удалось прочитать данные файла.')
      setLoading(false)
      return
    }

    const task = pdfjsLib.getDocument({ data })
    loadingTaskRef.current = task

    task.promise
      .then((doc) => {
        if (cancelled) {
          // pdfjs-dist v6 removed PDFDocumentProxy#destroy(); destroying the
          // loading task is the exact replacement (same as doc.destroy() in
          // earlier versions).
          void doc.loadingTask.destroy()
          return
        }
        docRef.current = doc
        setPdfDoc(doc)
        setNumPages(doc.numPages)
        setLoading(false)
        // Load the document outline (bookmarks) in the background — a PDF
        // without an outline simply keeps the thumbnails-only sidebar.
        void (async () => {
          try {
            const raw = await doc.getOutline()
            const parsed = await parseOutline(
              doc,
              raw as RawOutlineNode[] | null,
              '',
            )
            if (!cancelled) setOutline(parsed.length > 0 ? parsed : null)
          } catch {
            if (!cancelled) setOutline(null)
          }
        })()
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // RenderingCancelledException / PasswordException etc. are thrown
        // as Error instances with a `name` field.
        const name = (err as { name?: string } | null)?.name
        let message = 'Не удалось открыть PDF-документ.'
        if (name === 'PasswordException') {
          message = 'Документ защищён паролем и не может быть открыт.'
        } else if (err instanceof Error && err.message) {
          message = err.message
        }
        setError(message)
        toast.error(message)
        setLoading(false)
      })

    return () => {
      cancelled = true
      // Disarm a pending print-window release (file change / unmount): the
      // reset block above already re-narrowed the render window for the new
      // document; a late release firing afterwards would be a redundant
      // no-op setState — disarming keeps the lifecycle explicit.
      printWindowReleaseRef.current?.cancel()
      printWindowReleaseRef.current = null
      const t = loadingTaskRef.current
      if (t) {
        try {
          void t.destroy()
        } catch {
          /* ignore */
        }
        loadingTaskRef.current = null
      }
      const d = docRef.current
      if (d) {
        try {
          void d.loadingTask.destroy()
        } catch {
          /* ignore */
        }
        docRef.current = null
      }
      // Cancel any in-flight render tasks.
      renderTasksRef.current.forEach((entry) => {
        try {
          entry.task.cancel()
        } catch {
          /* ignore */
        }
      })
      renderTasksRef.current.clear()
    }
    // Re-load whenever the file identity changes.
  }, [file.id, file.arrayBuffer])

  // ---- Fit-width computation ----
  // Synchronous: uses the cached page-1 dimensions (width at extra rotation
  // 90/270 = base height). Subtracts the pages host's horizontal padding and
  // a small margin, clamps to the allowed scale range and rounds to 2
  // decimals. The |prev - fit| > FIT_EPSILON guard keeps redundant observer
  // callbacks from re-rendering pages in a loop.
  // NOTE: only the fit scale (label / reset logic) is stored unconditionally;
  // the actual zoom is applied ONLY while fit-width mode is active, so a
  // manual zoom survives rotation and other recompute triggers.
  const recomputeFit = React.useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const baseWidth =
      rotation % 180 === 90
        ? page1HeightRef.current
        : page1WidthRef.current
    if (!baseWidth) return
    const isSm =
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 640px)').matches
    const available =
      container.clientWidth - (isSm ? PAGE_PAD_SM : PAGE_PAD_XS) - FIT_MARGIN
    if (available <= 0) return
    const fit = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, +(available / baseWidth).toFixed(2)),
    )
    setFitScale(fit)
    if (fitWidthRef.current) {
      setScale((prev) => (Math.abs(prev - fit) > FIT_EPSILON ? fit : prev))
    }
  }, [rotation])

  // ---- Cache page-1 base dimensions after the document loads ----
  // getPage() is async, so this caches the result in refs and immediately
  // (re)applies the fit — this is what triggers the very first fit on load.
  // The state mirror additionally drives the aspect-ratio placeholders of
  // un-rendered page slots / thumbnails (stable scroll geometry).
  React.useEffect(() => {
    const doc = pdfDoc
    if (!doc) return
    let cancelled = false
    doc
      .getPage(1)
      .then((page) => {
        if (cancelled) return
        // The default viewport already applies the page's intrinsic
        // rotation; extra rotation swaps width/height at 90/270.
        const vp = page.getViewport({ scale: 1 })
        page1WidthRef.current = vp.width
        page1HeightRef.current = vp.height
        setPage1Size({ w: vp.width, h: vp.height })
        recomputeFit()
      })
      .catch(() => {
        /* fit-width stays disabled until dimensions are known */
      })
    return () => {
      cancelled = true
    }
  }, [pdfDoc, recomputeFit])

  // ---- Fit-width: watch the scroll container size ----
  // While fit-width is active, a ResizeObserver on the scroll container
  // re-fits the pages whenever its width changes (metadata panel / thumbs
  // sidebar toggles, window resize, fullscreen enter/exit).
  React.useEffect(() => {
    if (!pdfDoc || numPages === 0 || !fitWidth) return
    const container = scrollRef.current
    if (!container) return
    recomputeFit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => recomputeFit())
    ro.observe(container)
    return () => ro.disconnect()
  }, [pdfDoc, numPages, fitWidth, recomputeFit])

  // ---- Track the scroll container width ----
  // The highlight overlay offsets depend on where the `mx-auto` canvas sits
  // inside each page container. Panel/sidebar toggles change the container
  // width without necessarily changing the scale (manual zoom mode), so the
  // width is mirrored into state to re-trigger the highlight geometry.
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ---- Page rendering (window-based virtualization) ----
   *
   * All page wrapper divs stay mounted (plain divs — cheap); only the
   * CANVASES are expensive. A render window of ±PAGE_RENDER_RADIUS around
   * `currentPage` (tracked by the IntersectionObserver below) holds live
   * bitmaps. Pages that leave the window are FREED: their running
   * RenderTask is cancelled and the canvas bitmap is shrunk to 1×1 —
   * this is the memory win: a rendered page keeps a full RGBA bitmap in
   * RAM (several MB at fit-width scale; 500 pages ≈ 2.5 GB without
   * windowing), while a 1×1 canvas holds 4 bytes. The freed page flips
   * back to the skeleton placeholder; its wrapper keeps the aspect-ratio
   * slot height, so the scroll geometry barely moves. Documents with
   * ≤ SMALL_DOC_PAGES pages render everything (classic behaviour).
   *
   * `renderAllPages` (print preparation) widens the window to every page.
   * State updates are BATCHED: one flush per pass (flushRenderedPages),
   * never per page — a 300-page render must not re-render the page list
   * 300 times. */
  /**
   * Mirror `renderedPagesRef` into state with a single batched update. The
   * content-equality guard keeps identical snapshots from re-rendering the
   * (potentially 500-item) page list.
   */
  const flushRenderedPages = React.useCallback(() => {
    setRenderedPages((prev) => {
      const live = renderedPagesRef.current
      if (prev.size === live.size) {
        let same = true
        for (const p of prev) {
          if (!live.has(p)) {
            same = false
            break
          }
        }
        if (same) return prev
      }
      return new Set(live)
    })
  }, [])

  React.useEffect(() => {
    if (!pdfDoc || numPages === 0) return
    // Explicit non-null type so the hoisted helper below keeps the narrowed
    // type (TS resets narrowing inside function declarations).
    const doc: PDFDocumentProxy = pdfDoc

    // ---- 1. Compute the wanted set (the render window). ----
    const wanted = new Set<number>()
    if (renderAllPages || numPages <= SMALL_DOC_PAGES) {
      for (let i = 1; i <= numPages; i++) wanted.add(i)
    } else {
      const lo = Math.max(1, currentPage - PAGE_RENDER_RADIUS)
      const hi = Math.min(numPages, currentPage + PAGE_RENDER_RADIUS)
      for (let i = lo; i <= hi; i++) wanted.add(i)
    }
    // Fresh snapshot for post-await re-verification: a superseded pass must
    // be able to tell whether its just-finished page is still wanted.
    currentWindowRef.current = wanted

    // ---- 2. Free the pages outside the window. ----
    // In-flight tasks for pages that left the window are cancelled.
    renderTasksRef.current.forEach((entry, pageNum) => {
      if (wanted.has(pageNum)) return
      try {
        entry.task.cancel()
      } catch {
        /* already finished */
      }
      renderTasksRef.current.delete(pageNum)
    })
    // Completed bitmaps are freed — see the effect header for why shrinking
    // the canvas to 1×1 is the actual memory win.
    let freedAny = false
    pageBitmapsRef.current.forEach((_params, pageNum) => {
      if (wanted.has(pageNum)) return
      pageBitmapsRef.current.delete(pageNum)
      renderedPagesRef.current.delete(pageNum)
      const canvas = canvasRefs.current[pageNum - 1]
      if (canvas) {
        canvas.width = 1
        canvas.height = 1
        canvas.style.width = ''
        canvas.style.height = ''
      }
      freedAny = true
    })
    if (freedAny) flushRenderedPages()

    // ---- 3. Render the wanted pages (missing or stale zoom/rotation). ----
    let cancelled = false
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1

    async function renderWindow() {
      try {
        for (const pageNum of wanted) {
          if (cancelled) return
          // Skip pages that already hold a bitmap at the current params —
          // a window move must not re-render its overlapping pages, but a
          // zoom/rotation change must re-render them in place.
          const params = pageBitmapsRef.current.get(pageNum)
          if (
            params &&
            params.scale === scale &&
            params.rotation === rotation
          ) {
            continue
          }
          // An in-flight task from a previous (superseded) pass renders this
          // page — let it finish when its params still match (its completion
          // path does the bookkeeping), but cancel one started under a
          // zoom/rotation that has since changed.
          const inFlight = renderTasksRef.current.get(pageNum)
          if (inFlight) {
            if (inFlight.scale === scale && inFlight.rotation === rotation) {
              continue
            }
            try {
              inFlight.task.cancel()
            } catch {
              /* already finished */
            }
            renderTasksRef.current.delete(pageNum)
          }
          const canvas = canvasRefs.current[pageNum - 1]
          if (!canvas) continue
          try {
            const page = await doc.getPage(pageNum)
            if (cancelled) return
            if (
              renderTasksRef.current.has(pageNum) ||
              (pageBitmapsRef.current.get(pageNum)?.scale === scale &&
                pageBitmapsRef.current.get(pageNum)?.rotation === rotation)
            ) {
              continue
            }
            // The window may have moved on while getPage resolved — the
            // newest pass owns this page now; do not allocate a bitmap for
            // a page nobody wants anymore.
            if (!currentWindowRef.current.has(pageNum)) continue
            // Extra rotation is combined with the page's intrinsic rotation,
            // so the 90° turn applies to the rendered canvases.
            const viewport = page.getViewport({
              scale: scale * dpr,
              rotation: (page.rotate + rotation) % 360,
            })
            const ctx = canvas.getContext('2d')
            if (!ctx) continue
            // Set the bitmap size to the device pixels and the CSS size to the
            // logical size so the canvas stays crisp on HiDPI screens.
            canvas.width = Math.floor(viewport.width)
            canvas.height = Math.floor(viewport.height)
            canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
            canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
            // PRE-ALLOCATE the bitmap entry: from this moment the canvas
            // holds (partial) pixels, so the FREE step of any superseding
            // pass can shrink it even when this task is cancelled
            // mid-render or completes after the window moved on (the entry
            // IS the bookkeeping for "this canvas holds pixels").
            pageBitmapsRef.current.set(pageNum, { scale, rotation })
            // `canvas` is typed as required since pdfjs-dist v6; the runtime
            // default for it is exactly `canvasContext.canvas`.
            const task = page.render({
              canvas: ctx.canvas,
              canvasContext: ctx,
              viewport,
            })
            renderTasksRef.current.set(pageNum, { task, scale, rotation })
            try {
              await task.promise
            } finally {
              renderTasksRef.current.delete(pageNum)
            }
            // The pass may have been superseded while awaiting: keep the
            // freshly painted bitmap only if the page is still in the CURRENT
            // window and the document is still this one (a superseding pass
            // may have freed the canvas in between — then this result is
            // discarded and the new pass re-renders it).
            if (docRef.current !== doc || !currentWindowRef.current.has(pageNum)) {
              // Superseded: the window moved past this page while it
              // rendered. Its bitmap entry was either already freed by the
              // newer pass's free step (canvas shrunk) or it is still
              // wanted — either way, do not mark it visible here.
              continue
            }
            renderedPagesRef.current.add(pageNum)
            // Release page resources once rendered (guarded: a cleanup
            // failure must not be mistaken for a render failure below).
            try {
              page.cleanup()
            } catch {
              /* ignore */
            }
            // Jump correction: an explicit jump (pageNav / search navigation /
            // outline / thumbnail click) first scrolls to the placeholder
            // slot; once the target's real bitmap is in, re-align the scroll
            // so the rendered canvas sits exactly at the slot's position.
            // One-shot (pendingScrollTargetRef) — plain scrolling never sets
            // it, so this never fights the user.
            if (pendingScrollTargetRef.current === pageNum) {
              pendingScrollTargetRef.current = null
              // Commit the placeholder→canvas DOM swap for the pages
              // rendered so far (the pass normally flushes once, at its
              // end — the jump target must not wait for the whole window).
              flushRenderedPages()
              // The correction needs the REAL layout: the React commit
              // that flips the skeleton to the canvas happens AFTER this
              // async marking, so retry over a few frames until the target
              // canvas is actually laid out, then align it.
              const align = (left: number) => {
                requestAnimationFrame(() => {
                  try {
                    const cv = canvasRefs.current[pageNum - 1]
                    if (cv && cv.clientWidth > 0) {
                      pageRefs.current[pageNum - 1]?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      })
                    } else if (left > 0) {
                      align(left - 1)
                    }
                  } catch {
                    /* the element may be gone — ignore */
                  }
                })
              }
              align(20)
            }
          } catch (err) {
            // RenderTask throws RenderingCancelledException when cancelled.
            const name = (err as { name?: string } | null)?.name
            if (name === 'RenderingCancelledException') return
            // Otherwise ignore the single-page failure — but drop the
            // half-painted allocation so a later pass can retry it and no
            // partial bitmap leaks outside the window bookkeeping.
            if (pageBitmapsRef.current.delete(pageNum)) {
              renderedPagesRef.current.delete(pageNum)
              const c = canvasRefs.current[pageNum - 1]
              if (c) {
                c.width = 1
                c.height = 1
                c.style.width = ''
                c.style.height = ''
              }
            }
          }
        }
        // The pass finished without cancellation: every wanted page was
        // attempted. Release a pending print preparation — every page is
        // rendered, or the leftovers failed individually and printing
        // proceeds best-effort (the flow can never hang on a broken page).
        if (renderAllPagesRef.current && renderAllResolveRef.current) {
          renderAllResolveRef.current()
        }
      } finally {
        // Single batched state flush per pass — including cancelled passes,
        // so pages completed before the window moved are not lost.
        flushRenderedPages()
      }
    }

    void renderWindow()

    return () => {
      // Only mark this pass as superseded — in-window RenderTasks keep
      // running (their completion path does the bookkeeping); file changes
      // and unmount are handled by the document-loading effect, which
      // cancels every task and destroys the document.
      cancelled = true
    }
  }, [pdfDoc, numPages, scale, rotation, currentPage, renderAllPages, flushRenderedPages])

  /* ---- Print preparation: render EVERY page before the print clone ----
   * `buildPrintClone` (viewer-shell) snapshots the live canvases as data
   * URLs, so with windowed rendering the pages outside the window would
   * print blank. `prepareForPrint` widens the render window to all pages
   * and resolves once (1) every page holds a bitmap at the current
   * scale/rotation AND (2) the React commit that flips those pages from the
   * hidden skeleton placeholders to visible canvases has landed — the clone
   * copies each canvas's className, so snapshotting before that commit
   * would carry `hidden` <img>s and print blank pages.
   *
   * The all-pages window stays open until the print dialog closes
   * (`afterprint`, plus a safety timer for environments where the event
   * never fires): `window.print()` is invoked ~60 ms after the clone is
   * built, and every canvas still holds its live bitmap at that moment.
   * Only afterwards does the normal render window re-narrow and free the
   * out-of-window bitmaps (the memory win). */
  /**
   * Arm the deferred release of the print render-everything window.
   * `release` re-narrows the render window when the print dialog closes;
   * `cancel` only disarms a pending release WITHOUT touching the window —
   * used when a newer preparation re-arms it or on file change / unmount
   * (the document lifecycle resets the mode explicitly there).
   */
  const armPrintWindowRelease = React.useCallback(() => {
    printWindowReleaseRef.current?.cancel()
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const release = () => {
      if (done) return
      done = true
      window.removeEventListener('afterprint', release)
      if (timer) clearTimeout(timer)
      printWindowReleaseRef.current = null
      // A preparation may still be awaiting the render-all pass (a very
      // slow document could outlive the safety timer) — release it so the
      // print flow can never hang; the clone then snapshots best-effort.
      renderAllResolveRef.current?.()
      renderAllResolveRef.current = null
      renderAllPagesRef.current = false
      setRenderAllPages(false)
    }
    const cancel = () => {
      if (done) return
      done = true
      window.removeEventListener('afterprint', release)
      if (timer) clearTimeout(timer)
      printWindowReleaseRef.current = null
    }
    window.addEventListener('afterprint', release)
    timer = setTimeout(release, 60_000)
    printWindowReleaseRef.current = { release, cancel }
  }, [])

  const prepareForPrint = React.useCallback(async () => {
    const doc = docRef.current
    if (!doc || doc.numPages === 0) return
    // Nothing to do when every page already holds a bitmap at the current
    // zoom/rotation (small documents, or a completed render-all).
    let allRendered = true
    for (let i = 1; i <= doc.numPages; i++) {
      const params = pageBitmapsRef.current.get(i)
      if (!params || params.scale !== scale || params.rotation !== rotation) {
        allRendered = false
        break
      }
    }
    if (allRendered) return
    setPreparingPrint(true)
    const toastId = toast.loading('Подготовка к печати…')
    try {
      armPrintWindowRelease()
      await new Promise<void>((resolve) => {
        renderAllResolveRef.current = resolve
        renderAllPagesRef.current = true
        setRenderAllPages(true)
      })
      // Wait for the React commit that swaps the freshly rendered pages
      // from skeleton placeholders to visible canvases (the pass flushed
      // `renderedPages` right before resolving, so the update is already
      // scheduled; React commits it in a scheduler task, which runs before
      // the next animation frame). The small frame budget only covers
      // pathological layouts — a page whose render failed stays hidden and
      // prints blank either way (best effort, like the rest of the flow).
      await new Promise<void>((resolve) => {
        let frames = 0
        const tick = () => {
          let visible = true
          for (let i = 1; i <= doc.numPages; i++) {
            const canvas = canvasRefs.current[i - 1]
            if (canvas && canvas.width > 1 && canvas.clientWidth === 0) {
              visible = false
              break
            }
          }
          if (visible || frames >= 30) resolve()
          else {
            frames++
            requestAnimationFrame(tick)
          }
        }
        requestAnimationFrame(tick)
      })
    } finally {
      renderAllResolveRef.current = null
      toast.dismiss(toastId)
      setPreparingPrint(false)
    }
  }, [scale, rotation, armPrintWindowRelease])

  /* ---- Thumbnail rendering (visible-only virtualization) ----
   * All `.dv-thumb` placeholder divs stay mounted (cheap, each with a
   * stable page-1 aspect-ratio slot so the sidebar scroll height is
   * correct before anything renders). An IntersectionObserver rooted at
   * THIS shell's sidebar scroller tracks the visible band (+ margin) and
   * only those thumbnails render. Painted thumbnails are NEVER un-rendered
   * (0.25-scale bitmaps are tiny). While the sidebar is closed nothing
   * renders (display:none → nothing intersects; reopening re-fires the
   * observer). Small documents (≤ SMALL_DOC_PAGES) render every thumbnail
   * so the classic behaviour is preserved for typical files. */

  // (a) Document lifecycle: cancel the in-flight thumbnail tasks when the
  // document (or the component) goes away. Visibility passes never cancel
  // tasks themselves, so scrolling the sidebar cannot thrash renders.
  React.useEffect(() => {
    return () => {
      thumbTasksRef.current.forEach((rt) => {
        try {
          rt.cancel()
        } catch {
          /* already finished */
        }
      })
      thumbTasksRef.current.clear()
    }
  }, [pdfDoc, numPages])

  // (b) Visibility tracking. Same per-shell sidebar lookup as the sidebar
  // "follow" effect below — in compare mode each PdfViewer observes its own
  // sidebar. Re-attaching on thumbsOpen keeps the closed→open transition
  // deterministic (the observer re-fires entries for the now-visible band);
  // re-attaching on pdfDoc covers switching to another document with the
  // SAME page count (React reuses the .dv-thumb DOM nodes by key, so the
  // observer would otherwise never re-fire and the sidebar would stay
  // blank until its own scroll).
  React.useEffect(() => {
    if (numPages === 0 || typeof IntersectionObserver === 'undefined') return
    let observer: IntersectionObserver | null = null
    let raf = 0
    const attach = () => {
      raf = 0
      const sidebar = scrollRef.current
        ?.closest('[data-viewer-shell]')
        ?.querySelector<HTMLElement>('.dv-thumbs')
      if (!sidebar) return
      observer = new IntersectionObserver(
        (entries) => {
          let changed = false
          for (const entry of entries) {
            const pageNum = Number(
              (entry.target as HTMLElement).dataset.pageNumber || '0',
            )
            if (!pageNum) continue
            if (entry.isIntersecting) {
              if (!visibleThumbPagesRef.current.has(pageNum)) {
                visibleThumbPagesRef.current.add(pageNum)
                changed = true
              }
            } else if (visibleThumbPagesRef.current.has(pageNum)) {
              // Scrolled away — no longer wanted (already-painted ones stay
              // painted; this only stops NEW renders).
              visibleThumbPagesRef.current.delete(pageNum)
              changed = true
            }
          }
          if (changed) setVisibleThumbPages(new Set(visibleThumbPagesRef.current))
        },
        { root: sidebar, rootMargin: THUMB_OBSERVER_MARGIN },
      )
      Array.from(sidebar.querySelectorAll<HTMLElement>('.dv-thumb')).forEach(
        (el) => {
          observer?.observe(el)
        },
      )
    }
    // One frame past the commit so the freshly rendered thumbs exist.
    raf = requestAnimationFrame(attach)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      observer?.disconnect()
    }
  }, [pdfDoc, numPages, thumbsOpen])

  // (c) Render the visible thumbnails (small docs: all of them). One pass
  // per visibility change; a superseded pass keeps the results of tasks
  // that completed after it was replaced (the bitmap is already painted).
  React.useEffect(() => {
    if (!pdfDoc || numPages === 0 || !thumbsOpen) return
    // Explicit non-null type so the hoisted helper below keeps the narrowed
    // type (TS resets narrowing inside function declarations).
    const doc: PDFDocumentProxy = pdfDoc
    let cancelled = false
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1

    async function renderVisibleThumbs() {
      const targets =
        numPages <= SMALL_DOC_PAGES
          ? Array.from({ length: numPages }, (_, i) => i + 1)
          : Array.from(visibleThumbPagesRef.current).sort((a, b) => a - b)
      for (const i of targets) {
        if (cancelled) return
        // Skip already-rendered thumbnails (toggling the sidebar or a
        // visibility pass never re-renders them).
        if (renderedThumbsRef.current.has(i)) continue
        if (thumbTasksRef.current.has(i)) continue
        const canvas = thumbCanvasRefs.current[i - 1]
        if (!canvas) continue
        try {
          const page = await doc.getPage(i)
          if (cancelled) return
          if (renderedThumbsRef.current.has(i) || thumbTasksRef.current.has(i))
            continue
          const viewport = page.getViewport({ scale: THUMB_SCALE * dpr })
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          // Only the bitmap size is set here — the CSS size is controlled by
          // the `.dv-thumb canvas { width: 100%; height: auto }` rule so
          // thumbnails always fit the sidebar width.
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          const task = page.render({
            canvas: ctx.canvas,
            canvasContext: ctx,
            viewport,
          })
          thumbTasksRef.current.set(i, task)
          try {
            await task.promise
          } finally {
            thumbTasksRef.current.delete(i)
          }
          // Keep the painted bitmap even when this pass was superseded by a
          // newer visibility set — but never pollute a NEWER document's
          // thumbnail state after a file switch.
          if (docRef.current !== doc) return
          renderedThumbsRef.current.add(i)
          if (cancelled) return
          page.cleanup()
        } catch (err) {
          const name = (err as { name?: string } | null)?.name
          if (name === 'RenderingCancelledException') return
          // Otherwise ignore the single-thumbnail failure and keep going.
        }
      }
    }

    void renderVisibleThumbs()

    return () => {
      cancelled = true
    }
  }, [pdfDoc, numPages, thumbsOpen, visibleThumbPages])

  // ---- IntersectionObserver: track the most visible page ----
  React.useEffect(() => {
    if (numPages === 0) return
    const root = scrollRef.current
    if (!root) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNum = Number(
            (entry.target as HTMLElement).dataset.pageNumber || '0',
          )
          if (!pageNum) continue
          ratiosRef.current.set(
            pageNum,
            entry.isIntersecting ? entry.intersectionRatio : 0,
          )
        }
        let bestPage = 0
        let bestRatio = -1
        ratiosRef.current.forEach((ratio, page) => {
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestPage = page
          }
        })
        if (bestPage > 0) setCurrentPage(bestPage)
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    )

    const els = pageRefs.current.filter(Boolean) as HTMLDivElement[]
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [numPages])

  // ---- Zoom controls ----
  // Manual zooming leaves fit-width mode; the reset button re-enables it and
  // forces an immediate recomputation (the ResizeObserver effect re-arms
  // itself as well because the `fitWidth` dependency flips).
  const zoomIn = React.useCallback(() => {
    fitWidthRef.current = false
    setFitWidth(false)
    setScale((s) => Math.min(MAX_SCALE, +(s + SCALE_STEP).toFixed(2)))
  }, [])
  const zoomOut = React.useCallback(() => {
    fitWidthRef.current = false
    setFitWidth(false)
    setScale((s) => Math.max(MIN_SCALE, +(s - SCALE_STEP).toFixed(2)))
  }, [])
  const resetZoom = React.useCallback(() => {
    fitWidthRef.current = true
    setFitWidth(true)
    recomputeFit()
  }, [recomputeFit])

  // ---- Scroll helpers ----
  const scrollToPage = React.useCallback((page: number) => {
    const target = pageRefs.current[page - 1]
    if (target) {
      // Explicit jump: remember the target so the render pass re-aligns the
      // scroll AFTER the page's real bitmap lands (the placeholder →
      // canvas height swap can drift the position by a few pixels). One-shot —
      // plain scrolling never sets it, so the correction never fights the user.
      pendingScrollTargetRef.current = page
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setCurrentPage(page)
    }
  }, [])

  /**
   * Scroll the ACTIVE highlight rect into view (centered vertically). The
   * rect element appears in the DOM asynchronously (the `searchIndex`-driven
   * re-render flips the class, and right after a fresh search the geometry
   * effect computes the rects), so the lookup retries over several
   * animation frames and gives up silently when the rect never shows up.
   */
  const scrollActiveRectIntoView = React.useCallback(
    (page: number, retries: number) => {
      const attempt = (left: number) => {
        requestAnimationFrame(() => {
          try {
            const pageEl = pageRefs.current[page - 1]
            const el = pageEl?.querySelector('.dv-hl-rect-active')
            if (el instanceof HTMLElement) {
              el.scrollIntoView({ block: 'center', behavior: 'smooth' })
            } else if (left > 0) {
              attempt(left - 1)
            }
          } catch {
            /* the element may be missing — ignore */
          }
        })
      }
      attempt(retries)
    },
    [],
  )

  // ---- Search ----
  // Matching happens per text item (all occurrences, case-insensitive;
  // matches spanning several items are skipped). The extracted items are
  // cached so the highlight geometry can be recomputed on zoom/rotation
  // without re-extracting the page text.
  const runSearch = React.useCallback(
    async () => {
      const doc = pdfDoc
      const q = searchQuery.trim()
      if (!doc || !q) return
      setSearching(true)
      setSearchResults([])
      setSearchIndex(0)
      setMatchPos({})
      const matches: SearchMatch[] = []
      const positions: Record<number, MatchPos[]> = {}
      try {
        const re = new RegExp(escapeRegExp(q), 'gi')
        textItemsRef.current = new Map()
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          try {
            const tc = await page.getTextContent()
            const items: PdfTextItem[] = []
            for (const it of tc.items) {
              if ('str' in it) items.push(it)
            }
            textItemsRef.current.set(i, items)
            const pagePos: MatchPos[] = []
            const itemStyles = tc.styles as
              | Record<string, { fontFamily?: string }>
              | undefined
            for (
              let itemIndex = 0;
              itemIndex < items.length;
              itemIndex++
            ) {
              const str = items[itemIndex].str
              if (!str) continue
              re.lastIndex = 0
              let m: RegExpExecArray | null
              let measured = false
              while ((m = re.exec(str)) !== null) {
                if (!measured) {
                  // Measure per-character advances only for matched items,
                  // so the highlight boxes land on the actual glyphs.
                  measured = true
                  applyCharOffsets(items[itemIndex], itemStyles)
                }
                pagePos.push({
                  itemIndex,
                  start: m.index,
                  end: m.index + m[0].length,
                })
              }
            }
            if (pagePos.length > 0) {
              positions[i] = pagePos
              // One flat-list entry per individual occurrence.
              for (let p = 0; p < pagePos.length; p++) {
                matches.push({ page: i, posIndex: p })
              }
            }
          } finally {
            page.cleanup()
          }
        }
        setSearchResults(matches)
        setSearchIndex(0)
        setMatchPos(positions)
        if (matches.length === 0) {
          toast.message(`«${q}» не найдено`)
        } else {
          const pagesWithMatches = Object.keys(positions).length
          toast.success(
            `Найдено ${matches.length} ${pluralRu(
              matches.length,
              'совпадение',
              'совпадения',
              'совпадений',
            )} на ${pagesWithMatches} ${pluralRu(
              pagesWithMatches,
              'странице',
              'страницах',
              'страницах',
            )}`,
          )
          // Jump to the first match: its page, then the centered active rect
          // (the rect geometry is computed asynchronously by the effect
          // below, hence the generous retry budget).
          scrollToPage(matches[0].page)
          scrollActiveRectIntoView(
            matches[0].page,
            RECT_SCROLL_RETRIES_SEARCH,
          )
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Ошибка поиска по тексту'
        toast.error(message)
      } finally {
        setSearching(false)
      }
    },
    [pdfDoc, searchQuery, scrollToPage, scrollActiveRectIntoView],
  )

  const clearSearch = React.useCallback(() => {
    setSearchQuery('')
    setSearchResults([])
    setSearchIndex(0)
    setMatchPos({})
    // Drop the cached text items: the next search re-extracts them.
    textItemsRef.current = new Map()
  }, [])

  /**
   * Activate the flat-list match at `idx` (with wrap-around) and scroll to
   * it: a page change scrolls the page container first; afterwards (after
   * the rects re-render) the active rect itself is centered in the viewport.
   */
  const goToMatch = React.useCallback(
    (idx: number) => {
      const total = searchResults.length
      if (total === 0) return
      const next = ((idx % total) + total) % total
      const match = searchResults[next]
      if (!match) return
      setSearchIndex(next)
      const prev = searchResults[searchIndex]
      if (!prev || prev.page !== match.page) {
        scrollToPage(match.page)
      }
      scrollActiveRectIntoView(match.page, RECT_SCROLL_RETRIES_NAV)
    },
    [searchResults, searchIndex, scrollToPage, scrollActiveRectIntoView],
  )

  const goPrevMatch = React.useCallback(() => {
    if (searchResults.length === 0) return
    goToMatch(searchIndex - 1)
  }, [searchResults.length, searchIndex, goToMatch])

  const goNextMatch = React.useCallback(() => {
    if (searchResults.length === 0) return
    goToMatch(searchIndex + 1)
  }, [searchResults.length, searchIndex, goToMatch])

  // ---- In-page highlight geometry ----
  // Recomputes the match rectangles (CSS px, relative to each page
  // container) whenever the search data, zoom, rotation or container width
  // changes. Geometry is derived from the cached text items and the CURRENT
  // viewport, so the rectangles follow zoom & rotation; coordinates are
  // divided by the same device pixel ratio used for rendering so they match
  // the canvas CSS size.
  React.useEffect(() => {
    if (!pdfDoc || searchResults.length === 0) {
      setHlRects((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }
    // Explicit non-null type so the hoisted helper below keeps the narrowed
    // type (TS resets narrowing inside function declarations).
    const doc: PDFDocumentProxy = pdfDoc
    let cancelled = false
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1
    const vpScale = scale * dpr

    async function computeRects() {
      const next: Record<number, HlRect[]> = {}
      // Flat (global) match indices per page, aligned with the page's
      // positions array — each rect remembers which flat-list match it
      // belongs to, so only the active match's rect is highlighted.
      const flatIdxByPage: Record<number, number[]> = {}
      for (let i = 0; i < searchResults.length; i++) {
        const pg = searchResults[i].page
        const arr = flatIdxByPage[pg]
        if (arr) arr.push(i)
        else flatIdxByPage[pg] = [i]
      }
      const seenPages = new Set<number>()
      for (const match of searchResults) {
        if (cancelled) return
        // One geometry pass per page (searchResults may hold several
        // matches of the same page).
        if (seenPages.has(match.page)) continue
        seenPages.add(match.page)
        const items = textItemsRef.current.get(match.page)
        const positions = matchPos[match.page]
        const flatIndices = flatIdxByPage[match.page]
        if (
          !items ||
          !positions ||
          !flatIndices ||
          positions.length === 0 ||
          flatIndices.length !== positions.length
        )
          continue
        try {
          const page = await doc.getPage(match.page)
          if (cancelled) return
          const viewport = page.getViewport({
            scale: vpScale,
            rotation: (page.rotate + rotation) % 360,
          })
          // The canvas is `block mx-auto` inside the page container: it is
          // centered horizontally (clamped at 0 when it overflows) and, once
          // rendered, is the first in-flow child (top = 0). Overlay rects are
          // therefore expressed relative to the container origin.
          const cssW = Math.floor(viewport.width / dpr)
          const containerEl = pageRefs.current[match.page - 1]
          const containerWNow = containerEl ? containerEl.clientWidth : 0
          const canvasLeft = Math.max(0, (containerWNow - cssW) / 2)
          const rects: HlRect[] = []
          for (let posIdx = 0; posIdx < positions.length; posIdx++) {
            const pos = positions[posIdx]
            const item = items[pos.itemIndex]
            if (!item || !item.str) continue
            const tm = item.transform
            if (!tm || tm.length < 6) continue
            // Composed transform: text space → viewport (bitmap px).
            const m = pdfjsLib.Util.transform(viewport.transform, tm)
            const fontHeight = Math.hypot(m[2], m[3])
            if (!Number.isFinite(fontHeight) || fontHeight <= 0) continue
            const fsUser = Math.hypot(tm[2], tm[3])
            if (!Number.isFinite(fsUser) || fsUser <= 0) continue
            // Match character range → text-space x range (em units along the
            // advance direction): measured char offsets when available,
            // otherwise a proportional split of the item advance.
            const len = item.str.length || 1
            let xStartU: number
            let xEndU: number
            if (
              item.charX &&
              item.charX.length === len + 1 &&
              Number.isFinite(item.charX[pos.start]) &&
              Number.isFinite(item.charX[pos.end])
            ) {
              xStartU = item.charX[pos.start] ?? 0
              xEndU = item.charX[pos.end] ?? item.width
            } else {
              xStartU = (item.width * pos.start) / len
              xEndU = (item.width * pos.end) / len
            }
            const xStart = xStartU / fsUser
            const xEnd = xEndU / fsUser
            // Baseline segment endpoints in viewport px.
            const bx0 = m[4] + m[0] * xStart
            const by0 = m[5] + m[1] * xStart
            const bx1 = m[4] + m[0] * xEnd
            const by1 = m[5] + m[1] * xEnd
            // "Up" vector (one em) = (m[2], m[3]); the fifth corner allows
            // 0.1 em below the baseline for descenders.
            const upX = m[2]
            const upY = m[3]
            const xs = [
              bx0,
              bx1,
              bx0 + upX,
              bx1 + upX,
              bx1 - upX * 0.1,
            ]
            const ys = [
              by0,
              by1,
              by0 + upY,
              by1 + upY,
              by1 - upY * 0.1,
            ]
            const leftVp = Math.min(...xs)
            const rightVp = Math.max(...xs)
            const topVp = Math.min(...ys)
            const bottomVp = Math.max(...ys)
            const width = (rightVp - leftVp) / dpr
            const height = (bottomVp - topVp) / dpr
            if (width <= 0 || height <= 0) continue
            rects.push({
              left: canvasLeft + leftVp / dpr,
              top: topVp / dpr,
              width,
              height,
              matchIndex: flatIndices[posIdx] ?? -1,
            })
          }
          next[match.page] = rects
        } catch {
          // Skip pages whose highlight geometry cannot be computed.
        }
      }
      if (!cancelled) setHlRects(next)
    }

    void computeRects()
    return () => {
      cancelled = true
    }
  }, [pdfDoc, scale, rotation, searchResults, matchPos, containerW])

  const pagesArray = React.useMemo(
    () => Array.from({ length: numPages }, (_, i) => i + 1),
    [numPages],
  )

  /* ---- Aspect-ratio placeholders ----
   * Un-rendered page slots (and all thumbnail slots) keep the page-1 aspect
   * ratio, so their heights are already ~correct BEFORE the canvas renders:
   * jumps to far pages land at (nearly) the final position and rendering a
   * page does not shift the scroll geometry. Main pages swap the ratio at
   * extra rotation 90/270 (the rendered viewport swaps width/height);
   * thumbnails never apply the extra rotation, so they always use the plain
   * page-1 ratio. */
  const page1Aspect = React.useMemo(() => {
    if (!page1Size || page1Size.w <= 0 || page1Size.h <= 0) return null
    return page1Size.w / page1Size.h
  }, [page1Size])
  const mainPageAspect = React.useMemo(() => {
    if (page1Aspect == null) return null
    return rotation % 180 === 90 ? 1 / page1Aspect : page1Aspect
  }, [page1Aspect, rotation])

  // ---- Outline helpers ----
  const toggleOutlineNode = React.useCallback((key: string) => {
    setCollapsedOutline((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /**
   * The outline entry that describes the CURRENT page: the deepest (last in
   * document order) node whose destination page is ≤ the current page —
   * the same rule Adobe Reader uses to highlight the active bookmark.
   */
  const activeOutlineKey = React.useMemo(() => {
    if (!outline || outline.length === 0) return null
    let bestKey: string | null = null
    let bestPage = 0
    const walk = (nodes: OutlineNode[]) => {
      for (const n of nodes) {
        if (n.page != null && n.page <= currentPage && n.page >= bestPage) {
          bestPage = n.page
          bestKey = n.key
        }
        if (n.items.length > 0) walk(n.items)
      }
    }
    walk(outline)
    return bestKey
  }, [outline, currentPage])

  /* ---- Sidebar "follow" (auto-scroll to the active item) ----
   * Keeps the ACTIVE outline item and the ACTIVE thumbnail visible in the
   * left sidebar as the current page changes (main pages scrolling, pageNav
   * jumps, search navigation, thumbnail/outline clicks).
   *
   * Trigger deps: `currentPage` (the most visible page), `activeOutlineKey`
   * (the deepest outline node covering it — a derived memo, may flip a
   * render AFTER currentPage), the outline collapse set (collapsing may
   * un-render the active outline item → fall back to the active thumbnail;
   * expanding re-renders it → re-centre), and `thumbsOpen` (a closed→open
   * transition re-runs the effect so the sidebar opens already positioned at
   * the current page). The sidebar's own scrolling never re-fires the effect
   * — there are NO scroll listeners on the sidebar, so the user's manual
   * sidebar position survives until the page actually changes. */
  /* «Night mode» (screen-only colour inversion of the rendered pages —
   * white documents become dark). Global store flag, persisted; the print
   * clone strips the class, so printing/export keeps natural colours. */
  const nightMode = useViewerUiStore((s) => s.nightMode)
  const toggleNightMode = useViewerUiStore((s) => s.toggleNightMode)
  const sidebarFollowRafRef = React.useRef(0)

  React.useEffect(() => {
    // Only act while the sidebar is open and the document is loaded.
    if (!thumbsOpen || numPages === 0) return
    // rAF coalescing: while the user scrolls the MAIN pages container, the
    // IntersectionObserver fires many currentPage updates (several per
    // frame); cancelling + re-scheduling one frame callback collapses them
    // into a single scroll write per frame. The write itself is INSTANT (a
    // direct scrollTop assignment — NOT smooth scrolling, which would
    // lag/queue behind fast page changes, and NOT scrollIntoView, which
    // scrolls every scrollable ancestor and would hijack the main document
    // viewport). Only the sidebar's own scrollTop is ever written.
    cancelAnimationFrame(sidebarFollowRafRef.current)
    sidebarFollowRafRef.current = requestAnimationFrame(() => {
      sidebarFollowRafRef.current = 0
      try {
        // Robust lookup: walk up from THIS viewer's pages scroller to its
        // enclosing shell, then query that shell's thumbs sidebar — in
        // compare mode each PdfViewer instance finds its own sidebar.
        const shell = scrollRef.current?.closest('[data-viewer-shell]')
        const sidebar = shell?.querySelector<HTMLElement>('.dv-thumbs')
        if (!sidebar || sidebar.classList.contains('hidden')) return

        // Priority 1: the active outline item. It is NOT rendered while its
        // subtree is collapsed — we deliberately do NOT auto-expand the
        // collapsed node (the user's collapse choice is respected) and fall
        // back to the active THUMBNAIL, which is always rendered.
        // A PDF without an outline has no outline item at all — the
        // thumbnail follow keeps working exactly the same way.
        const target =
          sidebar.querySelector<HTMLElement>(
            '.dv-outline-item[data-active="true"]',
          ) ??
          sidebar.querySelector<HTMLElement>('.dv-thumb[data-active="true"]')
        if (!target) return

        // Position via getBoundingClientRect difference: the sidebar is not
        // a positioned element, so the item's offsetParent is a further
        // ancestor and offsetTop would NOT be sidebar-relative. The rect
        // difference (+ the current scrollTop) is immune to the offsetParent
        // chain.
        const boxRect = sidebar.getBoundingClientRect()
        const elRect = target.getBoundingClientRect()
        if (elRect.height <= 0 || boxRect.height <= 0) return // not laid out
        const elTop = elRect.top - boxRect.top + sidebar.scrollTop
        const elBottom = elTop + elRect.height
        // Already fully inside the visible band → do NOT move the scroll
        // (avoids jitter while the user reads / has scrolled the sidebar
        // manually).
        if (
          elTop >= sidebar.scrollTop &&
          elBottom <= sidebar.scrollTop + sidebar.clientHeight
        ) {
          return
        }
        // Centre the item (sidebar items are small), clamped to the scroll
        // range. Direct scrollTop write — see the note above the rAF call.
        const centered = elTop - (sidebar.clientHeight - elRect.height) / 2
        const maxScroll = sidebar.scrollHeight - sidebar.clientHeight
        sidebar.scrollTop = Math.max(0, Math.min(centered, maxScroll))
      } catch {
        /* the sidebar / target may not be laid out yet — best effort */
      }
    })
    return () => {
      cancelAnimationFrame(sidebarFollowRafRef.current)
      sidebarFollowRafRef.current = 0
    }
  }, [thumbsOpen, numPages, currentPage, activeOutlineKey, collapsedOutline])

  // Reset is disabled while the fit-width mode is active (zoom is already at
  // the container-derived fit scale) or when the manual scale coincides with
  // the fit / default scale.
  const isReset =
    fitWidth || Math.abs(scale - (fitScale ?? DEFAULT_SCALE)) < 0.01

  return (
    <ViewerShell
      file={file}
      category="pdf"
      busy={loading || preparingPrint}
      onBeforePrint={prepareForPrint}
      zoom={{
        value: scale * 100,
        min: MIN_SCALE * 100,
        max: MAX_SCALE * 100,
        onZoomIn: zoomIn,
        onZoomOut: zoomOut,
        onReset: resetZoom,
        isReset,
      }}
      rotate={{
        onRotateLeft: () => setRotation((r) => (r + 270) % 360),
        onRotateRight: () => setRotation((r) => (r + 90) % 360),
      }}
      pageNav={{
        page: currentPage,
        total: numPages,
        onGoToPage: scrollToPage,
        unit: 'страница',
      }}
      centerExtra={
        <ShellSearch
          value={searchQuery}
          onChange={setSearchQuery}
          onSubmit={() => void runSearch()}
          onPrev={goPrevMatch}
          onNext={goNextMatch}
          onClear={clearSearch}
          total={searchResults.length}
          activeIndex={searchIndex}
          busy={searching}
          disabled={loading || numPages === 0}
          placeholder="Поиск по тексту…"
          label="Поиск по тексту"
        />
      }
      download={{ mode: 'original' }}
      toolbarEnd={
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
      }
      printRootRef={pagesWrapRef}
      thumbs={
        numPages > 0 || (outline != null && outline.length > 0) ? (
          <>
            {outline != null && outline.length > 0 && (
              <div className="mb-3">
                <p className="dv-outline-title">Оглавление</p>
                <OutlineTree
                  nodes={outline}
                  depth={0}
                  collapsed={collapsedOutline}
                  onToggle={toggleOutlineNode}
                  activeKey={activeOutlineKey}
                  onGo={scrollToPage}
                />
              </div>
            )}
            {outline != null && outline.length > 0 && (
              <p className="dv-outline-title mt-1 mb-1.5">Миниатюры</p>
            )}
            {pagesArray.map((pageNum) => (
              <div
                key={pageNum}
                className="dv-thumb mb-2"
                data-active={currentPage === pageNum ? 'true' : 'false'}
                data-page-number={pageNum}
                // Stable sidebar geometry: every thumbnail slot keeps the
                // page-1 aspect ratio, so the sidebar's scroll height is
                // correct (and the active-thumb "follow" effect works)
                // before the virtualized thumbnails render. Uniform PDFs
                // (the norm) keep the exact height once rendered; mixed-size
                // documents may differ per page — cosmetic only.
                style={
                  page1Aspect != null
                    ? { aspectRatio: page1Aspect }
                    : undefined
                }
                onClick={() => scrollToPage(pageNum)}
                role="button"
                tabIndex={0}
                aria-label={`Страница ${pageNum}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    scrollToPage(pageNum)
                  }
                }}
              >
                <canvas
                  ref={setThumbCanvasRef}
                  data-page-number={pageNum}
                  // Same 1×1 placeholder as the main pages: un-rendered
                  // thumbnail slots hold no bitmap until they render.
                  width={1}
                  height={1}
                />
                <span className="dv-thumb-num">{pageNum}</span>
              </div>
            ))}
          </>
        ) : undefined
      }
      thumbsLabel={
        outline != null && outline.length > 0
          ? 'Структура документа'
          : 'Миниатюры страниц'
      }
    >
      <div
        ref={scrollRef}
        className="dv-scroll dv-doc-bg h-full flex-1 overflow-auto"
      >
        {loading && (
          <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16">
            <Loader2 className="size-8 animate-spin text-primary" />
            <div className="space-y-3 w-full">
              <Skeleton className="h-[60vh] w-full" />
            </div>
            <p className="text-sm text-muted-foreground">
              Открываем документ…
            </p>
          </div>
        )}

        {!loading && error && (
          <div className="mx-auto max-w-md py-16">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="size-6" />
              </div>
              <h3 className="text-base font-semibold">Не удалось открыть PDF</h3>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
        )}

        <div
          ref={pagesWrapRef}
          className={cn('px-2 py-4 sm:px-4', nightMode && 'dv-night')}
        >
          {!loading && !error && pdfDoc && (
            <div className="mx-auto" style={{ maxWidth: '100%' }}>
              {pagesArray.map((pageNum) => {
                const isRendered = renderedPages.has(pageNum)
                return (
                  <div
                    key={pageNum}
                    ref={setPageRef}
                    data-page-number={pageNum}
                    data-dv-page={pageNum}
                    className="dv-pdf-page relative"
                    // Stable placeholder geometry: while the page is
                    // un-rendered (outside the render window) its wrapper
                    // keeps the page-1 aspect ratio, so the slot height is
                    // already ~correct — jumps to far pages land accurately
                    // and rendering the real canvas does not shift the scroll
                    // position. Rendered pages drop the style (the canvas
                    // determines the height; mixed-size PDFs keep their real
                    // per-page heights).
                    style={
                      !isRendered && mainPageAspect != null
                        ? { aspectRatio: mainPageAspect }
                        : undefined
                    }
                  >
                    {!isRendered ? (
                      <Skeleton className="mx-auto h-full min-h-[280px] w-full max-w-[900px] rounded-none" />
                    ) : null}
                    <canvas
                      ref={setCanvasRef}
                      data-page-number={pageNum}
                      // width/height={1} keeps the placeholder bitmap at
                      // 4 bytes (the default 300×150 canvas would allocate
                      // ~180 KB per page — 54 MB for a 300-page document).
                      // The render pass sizes the canvas imperatively; React
                      // never rewrites these (the props never change).
                      width={1}
                      height={1}
                      // Un-rendered pages hide the canvas entirely: it holds
                      // no bitmap (1×1) and must not take layout space — the
                      // aspect-ratio slot above IS the placeholder. The print
                      // clone replaces canvases with <img> carrying the same
                      // class, and print preparation renders every page
                      // first, so printed pages are always the visible ones.
                      className={cn(
                        'mx-auto bg-white',
                        isRendered ? 'block opacity-100' : 'hidden',
                      )}
                    />
                    {/* Search highlight overlay: absolutely positioned over
                        the canvas area, recomputed on zoom/rotation/resize. */}
                    {(hlRects[pageNum] ?? []).length > 0 && (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 z-10"
                      >
                        {(hlRects[pageNum] ?? []).map((rect, rectIdx) => (
                          <div
                            key={rectIdx}
                            className={cn(
                              'dv-hl-rect',
                              rect.matchIndex === searchIndex &&
                                'dv-hl-rect-active',
                            )}
                            style={{
                              left: rect.left,
                              top: rect.top,
                              width: rect.width,
                              height: rect.height,
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <span className="sr-only">Страница {pageNum}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </ViewerShell>
  )
}
