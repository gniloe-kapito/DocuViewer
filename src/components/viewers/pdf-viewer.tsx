'use client'

import * as React from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  PanelLeft,
  RotateCcw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FullscreenButton } from '@/components/fullscreen-button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useFullscreen } from '@/lib/use-fullscreen'
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

interface SearchMatch {
  page: number
  count: number
}

const MIN_SCALE = 0.5
const MAX_SCALE = 3.0
const DEFAULT_SCALE = 1.2
const SCALE_STEP = 0.1
const THUMB_SCALE = 0.25

/** Escape a literal string for safe use inside a RegExp. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  const [searching, setSearching] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<SearchMatch[]>([])
  const [searchTotal, setSearchTotal] = React.useState(0)
  const [searchIndex, setSearchIndex] = React.useState(0)
  const [gotoValue, setGotoValue] = React.useState('')
  // Thumbnails sidebar visibility. Shown by default on desktop (sm+), hidden
  // on mobile to save horizontal space.
  const [showThumbs, setShowThumbs] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return window.innerWidth >= 640
  })
  // Measured toolbar height — drives the sticky sidebar's `top`/`height` so
  // the sidebar sticks just below the (responsive, wrapping) toolbar.
  const [toolbarHeight, setToolbarHeight] = React.useState(49)

  // Refs
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const pageRefs = React.useRef<(HTMLDivElement | null)[]>([])
  const canvasRefs = React.useRef<(HTMLCanvasElement | null)[]>([])
  const thumbCanvasRefs = React.useRef<(HTMLCanvasElement | null)[]>([])
  const loadingTaskRef = React.useRef<PDFDocumentLoadingTask | null>(null)
  const docRef = React.useRef<PDFDocumentProxy | null>(null)
  const renderTasksRef = React.useRef<Map<number, RenderTask>>(new Map())
  const ratiosRef = React.useRef<Map<number, number>>(new Map())
  const searchResultsRef = React.useRef<SearchMatch[]>([])
  const toolbarRef = React.useRef<HTMLDivElement | null>(null)
  const renderedThumbsRef = React.useRef<Set<number>>(new Set())

  // Fullscreen — reuse the scroll container as the fullscreen target.
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(scrollRef)

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
    setCurrentPage(1)
    setSearchResults([])
    setSearchTotal(0)
    setSearchIndex(0)
    setSearchQuery('')
    ratiosRef.current = new Map()
    pageRefs.current = []
    canvasRefs.current = []
    thumbCanvasRefs.current = []
    renderedThumbsRef.current = new Set()

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
        void docRef.current.destroy()
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
          void doc.destroy()
          return
        }
        docRef.current = doc
        setPdfDoc(doc)
        setNumPages(doc.numPages)
        setLoading(false)
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
          void d.destroy()
        } catch {
          /* ignore */
        }
        docRef.current = null
      }
      // Cancel any in-flight render tasks.
      renderTasksRef.current.forEach((rt) => {
        try {
          rt.cancel()
        } catch {
          /* ignore */
        }
      })
      renderTasksRef.current.clear()
    }
    // Re-load whenever the file identity changes.
  }, [file.id, file.arrayBuffer])

  // ---- Page rendering ----
  React.useEffect(() => {
    const doc = pdfDoc
    if (!doc || numPages === 0) return

    // Cancel any in-flight render tasks before starting a fresh pass.
    renderTasksRef.current.forEach((rt) => {
      try {
        rt.cancel()
      } catch {
        /* ignore */
      }
    })
    renderTasksRef.current.clear()

    let cancelled = false
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1

    async function renderAll() {
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return
        const canvas = canvasRefs.current[i - 1]
        if (!canvas) continue
        try {
          const page = await doc.getPage(i)
          if (cancelled) return
          const viewport = page.getViewport({ scale: scale * dpr })
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          // Set the bitmap size to the device pixels and the CSS size to the
          // logical size so the canvas stays crisp on HiDPI screens.
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
          canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
          const task = page.render({ canvasContext: ctx, viewport })
          renderTasksRef.current.set(i, task)
          await task.promise
          if (cancelled) return
          setRenderedPages((prev) => {
            if (prev.has(i)) return prev
            const next = new Set(prev)
            next.add(i)
            return next
          })
          // Release page resources once rendered.
          page.cleanup()
        } catch (err) {
          // RenderTask throws RenderingCancelledException when cancelled.
          const name = (err as { name?: string } | null)?.name
          if (name === 'RenderingCancelledException') return
          // Otherwise ignore the single-page failure and keep going.
        }
      }
    }

    void renderAll()

    return () => {
      cancelled = true
      renderTasksRef.current.forEach((rt) => {
        try {
          rt.cancel()
        } catch {
          /* ignore */
        }
      })
      renderTasksRef.current.clear()
    }
  }, [pdfDoc, numPages, scale])

  // ---- Toolbar height measurement (drives the sticky sidebar offset) ----
  // The toolbar uses flex-wrap so its height varies with viewport width; we
  // observe it and feed the measured height into the sidebar's sticky `top`
  // and `height` so the sidebar sticks just below the toolbar without
  // overlapping it.
  React.useEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    const update = () => setToolbarHeight(el.getBoundingClientRect().height)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- Thumbnail rendering (background, separate from main render) ----
  // Runs after the main document loads, in its own effect. Renders each page
  // at a low scale into a separate set of thumbnail canvases. Cancels on
  // file change / unmount. Skips already-rendered thumbnails so toggling the
  // sidebar never re-renders.
  React.useEffect(() => {
    const doc = pdfDoc
    if (!doc || numPages === 0) return
    let cancelled = false
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1
    const thumbTasks = new Set<RenderTask>()

    async function renderThumbs() {
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return
        if (renderedThumbsRef.current.has(i)) continue
        const canvas = thumbCanvasRefs.current[i - 1]
        if (!canvas) continue
        try {
          const page = await doc.getPage(i)
          if (cancelled) return
          const viewport = page.getViewport({ scale: THUMB_SCALE * dpr })
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          // Only the bitmap size is set here — the CSS size is controlled by
          // the `.dv-pdf-thumb canvas { width: 100%; height: auto }` rule so
          // thumbnails always fit the sidebar width.
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          const task = page.render({ canvasContext: ctx, viewport })
          thumbTasks.add(task)
          try {
            await task.promise
          } finally {
            thumbTasks.delete(task)
          }
          if (cancelled) return
          renderedThumbsRef.current.add(i)
          page.cleanup()
        } catch (err) {
          const name = (err as { name?: string } | null)?.name
          if (name === 'RenderingCancelledException') return
          // Otherwise ignore the single-thumbnail failure and keep going.
        }
      }
    }

    void renderThumbs()

    return () => {
      cancelled = true
      thumbTasks.forEach((rt) => {
        try {
          rt.cancel()
        } catch {
          /* ignore */
        }
      })
      thumbTasks.clear()
    }
  }, [pdfDoc, numPages])

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
  const zoomIn = React.useCallback(() => {
    setScale((s) => Math.min(MAX_SCALE, +(s + SCALE_STEP).toFixed(2)))
  }, [])
  const zoomOut = React.useCallback(() => {
    setScale((s) => Math.max(MIN_SCALE, +(s - SCALE_STEP).toFixed(2)))
  }, [])
  const resetZoom = React.useCallback(() => setScale(DEFAULT_SCALE), [])

  // ---- Scroll helpers ----
  const scrollToPage = React.useCallback((page: number) => {
    const target = pageRefs.current[page - 1]
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setCurrentPage(page)
    }
  }, [])

  const handleGoto = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const n = parseInt(gotoValue, 10)
      if (!Number.isFinite(n)) return
      const clamped = Math.max(1, Math.min(numPages, n))
      scrollToPage(clamped)
      setGotoValue('')
    },
    [gotoValue, numPages, scrollToPage],
  )

  // ---- Search ----
  const runSearch = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const doc = pdfDoc
      const q = searchQuery.trim()
      if (!doc || !q) return
      setSearching(true)
      setSearchResults([])
      setSearchTotal(0)
      setSearchIndex(0)
      const matches: SearchMatch[] = []
      let total = 0
      try {
        const re = new RegExp(escapeRegExp(q), 'gi')
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          try {
            const tc = await page.getTextContent()
            const text = tc.items
              .map((it) => ('str' in it ? (it as { str: string }).str : ''))
              .join('')
            re.lastIndex = 0
            const count = (text.match(re) || []).length
            if (count > 0) {
              matches.push({ page: i, count })
              total += count
            }
          } finally {
            page.cleanup()
          }
        }
        searchResultsRef.current = matches
        setSearchResults(matches)
        setSearchTotal(total)
        setSearchIndex(0)
        if (total === 0) {
          toast.message(`«${q}» не найдено`)
        } else {
          toast.success(
            `Найдено ${total} совпад. на ${matches.length} стр.`,
          )
          // Jump to the first matching page.
          scrollToPage(matches[0].page)
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Ошибка поиска по тексту'
        toast.error(message)
      } finally {
        setSearching(false)
      }
    },
    [pdfDoc, searchQuery, scrollToPage],
  )

  const clearSearch = React.useCallback(() => {
    setSearchQuery('')
    setSearchResults([])
    setSearchTotal(0)
    setSearchIndex(0)
    searchResultsRef.current = []
  }, [])

  const goPrevMatch = React.useCallback(() => {
    if (searchResults.length === 0) return
    const next =
      (searchIndex - 1 + searchResults.length) % searchResults.length
    setSearchIndex(next)
    scrollToPage(searchResults[next].page)
  }, [searchResults, searchIndex, scrollToPage])

  const goNextMatch = React.useCallback(() => {
    if (searchResults.length === 0) return
    const next = (searchIndex + 1) % searchResults.length
    setSearchIndex(next)
    scrollToPage(searchResults[next].page)
  }, [searchResults, searchIndex, scrollToPage])

  const pagesArray = React.useMemo(
    () => Array.from({ length: numPages }, (_, i) => i + 1),
    [numPages],
  )

  const scalePct = Math.round(scale * 100)

  return (
    <div className="dv-scroll h-full overflow-auto bg-muted/30" ref={scrollRef}>
      {/* Toolbar */}
      <div
        ref={toolbarRef}
        className="sticky top-0 z-10 bg-card/90 backdrop-blur border-b border-border"
      >
        <div className="flex flex-wrap items-center gap-2 p-2">
          {/* Thumbnails toggle */}
          <Button
            type="button"
            size="sm"
            variant={showThumbs ? 'default' : 'outline'}
            onClick={() => setShowThumbs((s) => !s)}
            disabled={loading || numPages === 0}
            aria-pressed={showThumbs}
            aria-label="Миниатюры"
            title="Миниатюры"
            className="gap-1.5"
          >
            <PanelLeft className="size-4" />
            <span className="hidden sm:inline">Миниатюры</span>
          </Button>

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={zoomOut}
              disabled={loading || scale <= MIN_SCALE}
              aria-label="Уменьшить"
              title="Уменьшить"
            >
              <ZoomOut className="size-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={resetZoom}
              disabled={loading || scale === DEFAULT_SCALE}
              className="min-w-[3.5rem] tabular-nums"
              title="Сбросить масштаб"
            >
              {scalePct}%
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={zoomIn}
              disabled={loading || scale >= MAX_SCALE}
              aria-label="Увеличить"
              title="Увеличить"
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={resetZoom}
              disabled={loading || scale === DEFAULT_SCALE}
              aria-label="Сбросить масштаб"
              title="Сбросить масштаб"
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>

          <span className="hidden sm:block h-6 w-px bg-border" aria-hidden />

          {/* Page navigation */}
          <div className="flex items-center gap-1.5 text-sm">
            <form onSubmit={handleGoto} className="flex items-center gap-1.5">
              <Input
                type="number"
                min={1}
                max={numPages || undefined}
                value={gotoValue}
                onChange={(e) => setGotoValue(e.target.value)}
                placeholder={String(currentPage)}
                disabled={loading || numPages === 0}
                className="h-8 w-14 tabular-nums"
                aria-label="Перейти на страницу"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={loading || numPages === 0 || !gotoValue}
              >
                Перейти
              </Button>
            </form>
            <span className="text-muted-foreground tabular-nums whitespace-nowrap">
              стр.{' '}
              <span className="text-foreground font-medium">{currentPage}</span>
              {' / '}
              {numPages || '—'}
            </span>
          </div>

          <span className="hidden sm:block h-6 w-px bg-border" aria-hidden />

          {/* Search */}
          <form onSubmit={runSearch} className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по тексту…"
                disabled={loading || numPages === 0 || searching}
                className="h-8 w-44 sm:w-56 pl-8"
                aria-label="Поиск по тексту"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={loading || numPages === 0 || searching || !searchQuery.trim()}
            >
              {searching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <span className="hidden sm:inline">Найти</span>
              )}
            </Button>
            {searchTotal > 0 && (
              <>
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {searchIndex + 1}/{searchResults.length} · {searchTotal}{' '}
                  найдено
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={goPrevMatch}
                  aria-label="Предыдущее совпадение"
                  title="Предыдущее совпадение"
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={goNextMatch}
                  aria-label="Следующее совпадение"
                  title="Следующее совпадение"
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={clearSearch}
                  aria-label="Очистить поиск"
                  title="Очистить поиск"
                >
                  <X className="size-4" />
                </Button>
              </>
            )}
          </form>

          {/* Fullscreen */}
          <FullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            disabled={loading}
            className="ml-auto"
          />
        </div>
      </div>

      {/* Content — flex row: thumbnails sidebar + main pages area */}
      <div className="flex w-full">
        {/* Thumbnails sidebar */}
        <aside
          className={cn('dv-pdf-thumbs dv-scroll', !showThumbs && 'hidden')}
          style={{
            position: 'sticky',
            top: `${toolbarHeight}px`,
            alignSelf: 'flex-start',
            height: `calc(100dvh - ${toolbarHeight}px)`,
            maxHeight: `calc(100dvh - ${toolbarHeight}px)`,
          }}
          aria-label="Миниатюры страниц"
        >
          {pagesArray.map((pageNum) => (
            <div
              key={pageNum}
              className="dv-pdf-thumb mb-2"
              data-active={currentPage === pageNum ? 'true' : 'false'}
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
              <canvas ref={setThumbCanvasRef} data-page-number={pageNum} />
              <span className="dv-pdf-thumb-num">{pageNum}</span>
            </div>
          ))}
        </aside>

        <div className="flex-1 min-w-0 px-2 py-4 sm:px-4">
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

          {!loading && !error && pdfDoc && (
            <div className="mx-auto" style={{ maxWidth: '100%' }}>
              {pagesArray.map((pageNum) => {
                const isRendered = renderedPages.has(pageNum)
                return (
                  <div
                    key={pageNum}
                    ref={setPageRef}
                    data-page-number={pageNum}
                    className="dv-pdf-page relative"
                  >
                    {!isRendered ? (
                      <Skeleton className="mx-auto h-[65vh] min-h-[280px] w-full max-w-[900px] rounded-none" />
                    ) : null}
                    <canvas
                      ref={setCanvasRef}
                      data-page-number={pageNum}
                      className={cn(
                        'block mx-auto bg-white',
                        isRendered ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="sr-only">Страница {pageNum}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
