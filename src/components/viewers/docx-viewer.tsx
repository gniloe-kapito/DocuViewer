'use client'

import * as React from 'react'
import { renderAsync } from 'docx-preview'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ViewerShell, ShellSearch } from '@/components/viewer-shell'
import { useViewerUiStore } from '@/lib/viewer-ui-store'
import { cn } from '@/lib/utils'
import { exportElementToPdf, pdfFilename } from '@/lib/export-pdf'
import type { LoadedFile } from '@/lib/viewers/types'

interface ViewerProps {
  file: LoadedFile
}

/** One DOCX page thumbnail: a detached, scaled DOM clone of a page section. */
interface DocxThumb {
  page: number
  node: HTMLElement
  w: number
  h: number
}

/** Inner width of a thumbnail preview (168px sidebar minus its paddings). */
const THUMB_WIDTH = 140

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1

/** Escapes a user query for safe embedding into a RegExp literal. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function DocxViewer({ file }: ViewerProps) {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [hasDeviations, setHasDeviations] = React.useState(false)
  const [isEmpty, setIsEmpty] = React.useState(false)
  const [numPages, setNumPages] = React.useState(0)
  const [currentPage, setCurrentPage] = React.useState(1)
  const [zoom, setZoom] = React.useState(1)
  // "Fit width" mode — ON by default (like the PDF viewer): right after
  // renderAsync completes, the pages are scaled to exactly fill the scroll
  // container's content width. Any manual zoom (in/out/reset) turns the
  // mode off, the dedicated toolbar button turns it back on, and a
  // ResizeObserver keeps the zoom locked to the container while it is
  // active. Reset (0 key / buttons) deliberately leaves it OFF: 100% is an
  // explicit user intent, not a container-derived value.
  const [fitWidth, setFitWidth] = React.useState(true)
  /** True while the PDF export capture is running — the zoom wrapper then
   *  renders zoom 1 (html2canvas needs the natural page sizes). */
  const [exporting, setExporting] = React.useState(false)
  const [thumbs, setThumbs] = React.useState<DocxThumb[]>([])

  // ---- Text-search state (see the search section below) ----
  const [searchQuery, setSearchQuery] = React.useState('')
  /** null = no search run yet; 0 = no matches; > 0 = matches. */
  const [searchTotal, setSearchTotal] = React.useState<number | null>(null)
  const [activeMatch, setActiveMatch] = React.useState(0)
  const [searching, setSearching] = React.useState(false)

  const rootRef = React.useRef<HTMLDivElement>(null)
  const hostRef = React.useRef<HTMLDivElement>(null)
  const zoomWrapRef = React.useRef<HTMLDivElement>(null)
  const ratiosRef = React.useRef<Map<number, number>>(new Map())
  /** file.id the current thumbnails were built for (null → not built yet). */
  const thumbsBuiltForRef = React.useRef<string | null>(null)
  /** Pristine host HTML (no highlights) — captured after every render; the
   *  source for each snapshot/restore cycle of the search feature. */
  const pristineHtmlRef = React.useRef<string | null>(null)
  /** Live page observer — re-created by bindPages() after every restore. */
  const observerRef = React.useRef<IntersectionObserver | null>(null)
  /** Incremented per file-render; lets an in-flight search abort cleanly. */
  const renderIdRef = React.useRef(0)
  // Ref mirrors kept in sync on every render (the PDF rotate-guard
  // pattern): handlers and the render effect write them DIRECTLY so the
  // stable recomputeFit callback always reads the fresh values without
  // being re-created, and a manual zoom can never be clobbered by a
  // container-resize recompute (panel/sidebar toggles, window resize).
  const fitWidthRef = React.useRef(fitWidth)
  React.useEffect(() => {
    fitWidthRef.current = fitWidth
  })
  const zoomRef = React.useRef(zoom)
  React.useEffect(() => {
    zoomRef.current = zoom
  })
  /** Export flag mirror — pauses fit recomputes during the PDF capture. */
  const exportingRef = React.useRef(false)
  /** The last fit value this session APPLIED (null → nothing applied yet).
   *  Used to detect real changes and drive the one-frame verification —
   *  see recomputeFit. Reset by the file-change effect and the fit button
   *  so both always force a fresh apply. */
  const lastFitRef = React.useRef<number | null>(null)

  const thumbsOpen = useViewerUiStore((s) => s.thumbsOpen)
  // «Night mode» — the shared, persisted global flag (see viewer-ui-store).
  // The marker class lands on the docx host (the print/export root); the
  // CSS inverts the white section.docx pages. While `exporting` is true the
  // class is dropped so html2canvas captures natural colours (print clones
  // strip it via buildPrintClone).
  const nightMode = useViewerUiStore((s) => s.nightMode)
  const toggleNightMode = useViewerUiStore((s) => s.toggleNightMode)

  // ---- Fit-width zoom ----
  /** Natural (unzoomed) width of a page section, in CSS px. docx-preview
   *  stamps the page size as an inline `width` in CSS `pt` (Word twips ×
   *  0.05 → pt, and 1pt = 4/3px), so the number must be converted before
   *  it can serve as a px width. If the inline value is missing (docx
   *  without a sectPr page size), fall back to the visual rect divided by
   *  the current zoom — the same derivation the thumbnails use. */
  const naturalSectionWidth = React.useCallback((sec: HTMLElement): number => {
    const raw = sec.style.width
    const inline = parseFloat(raw)
    if (Number.isFinite(inline) && inline > 0) {
      return /pt$/i.test(raw) ? (inline * 96) / 72 : inline
    }
    const rect = sec.getBoundingClientRect().width
    return rect > 0 && zoomRef.current > 0 ? rect / zoomRef.current : 0
  }, [])

  /** Recomputes the fit zoom so that
   *    (naturalPageWidth + innerHorizontalPaddings) × zoom
   *  equals the scroll container's content width. The paddings are measured
   *  from the live DOM (getComputedStyle of the scroll container — OUTSIDE
   *  the zoom wrapper — plus the zoom wrapper / host / .docx-wrapper —
 *  INSIDE it, so they scale together with the page); this stays correct
   *  even if the layout CSS changes later. The zoom is applied ONLY while
   *  fit-width mode is active (fitWidthRef): a manual zoom must survive
   *  panel/sidebar/window resizes. Guards against a zero-width container
   *  or not-yet-laid-out sections with a bounded requestAnimationFrame
   *  retry. Because the container may be measured in a TRANSIENT layout
   *  (the thumbnails sidebar mounts in the same commit as the document),
   *  every applied change schedules a one-frame verification pass — the
   *  epsilon guard ends the chain once the measurement is stable. */
  const recomputeFit = React.useCallback(
    function recomputeFit(retries = 0): void {
      if (exportingRef.current) return
      const container = rootRef.current
      const host = hostRef.current
      const zoomWrap = zoomWrapRef.current
      if (!container || !host || !zoomWrap) return

      const section = host.querySelector<HTMLElement>(
        '.docx-wrapper > section.docx',
      )
      const natural = section ? naturalSectionWidth(section) : 0

      const padX = (el: Element | null): number => {
        if (!el) return 0
        const cs = getComputedStyle(el)
        return (
          (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
        )
      }
      const outerPad = padX(container)
      const innerPad =
        padX(zoomWrap) + padX(host) + padX(host.querySelector('.docx-wrapper'))

      const available = container.clientWidth - outerPad
      if (natural <= 0 || available <= 0) {
        // Hidden / zero-width container or sections not laid out yet —
        // retry on the next few frames, but only when a fit is wanted.
        if (fitWidthRef.current && retries < 5) {
          requestAnimationFrame(() => recomputeFit(retries + 1))
        }
        return
      }
      const fit = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, +(available / (natural + innerPad)).toFixed(2)),
      )
      if (fitWidthRef.current) {
        const prevFit = lastFitRef.current
        if (prevFit == null || Math.abs(prevFit - fit) > 0.005) {
          lastFitRef.current = fit
          // Epsilon guard: redundant observer callbacks must not re-render.
          setZoom((z) => (Math.abs(z - fit) > 0.005 ? fit : z))
          // Verify once on the next frame: if this measurement happened in
          // a transient layout, the follow-up pass re-measures the settled
          // one and corrects the zoom (no-op when already stable).
          requestAnimationFrame(() => recomputeFit(0))
        }
      }
    },
    [naturalSectionWidth],
  )

  // ---- Render the .docx into the host container via docx-preview ----
  React.useEffect(() => {
    let isCancelled = false
    renderIdRef.current += 1

    setLoading(true)
    setError(null)
    setHasDeviations(false)
    setIsEmpty(false)
    setNumPages(0)
    setCurrentPage(1)
    setZoom(1)
    // New file → fit-width is the default mode again. The ref is written
    // directly so recomputeFit (called after renderAsync resolves) sees the
    // fresh mode before React flushes the state update.
    fitWidthRef.current = true
    setFitWidth(true)
    // Force the next recomputeFit to apply (not skip as "unchanged").
    lastFitRef.current = null
    setThumbs([])
    thumbsBuiltForRef.current = null
    ratiosRef.current.clear()
    // Drop the pristine snapshot + reset the search state with it.
    pristineHtmlRef.current = null
    setSearchQuery('')
    setSearchTotal(null)
    setActiveMatch(0)
    setSearching(false)

    const host = hostRef.current
    if (host) host.innerHTML = ''

    // Temporarily wrap console.warn so we can detect docx-preview's
    // "rendering deviations" warnings WITHOUT dumping raw WRN text into
    // the UI. The full warnings still reach the real console.
    const originalWarn = console.warn
    let warned = false
    const wrapper: typeof console.warn = (...args) => {
      warned = true
      originalWarn.apply(console, args)
    }
    console.warn = wrapper

    void (async () => {
      if (!host) {
        if (console.warn === wrapper) console.warn = originalWarn
        return
      }
      try {
        // Pass a copy of the arrayBuffer — docx-preview may transfer it.
        // 3rd arg (styleContainer) left undefined → docx-preview injects
        // its <style> tags into the body container (host), which is what we
        // want. A null would match the docs' example but is not type-safe.
        await renderAsync(file.arrayBuffer.slice(0), host, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
        })
        if (isCancelled) return

        const sections = host.querySelectorAll<HTMLElement>(
          '.docx-wrapper > section.docx',
        )
        const count = sections.length
        sections.forEach((s, i) => {
          // data-page-number — used by the IntersectionObserver and page jumps.
          s.setAttribute('data-page-number', String(i + 1))
          // data-dv-page — marks the section as one PDF page for the
          // client-side export (see src/lib/export-pdf.ts).
          s.setAttribute('data-dv-page', String(i + 1))
        })

        // Pristine snapshot for the search feature — taken AFTER the page
        // attributes are stamped so restores keep page navigation and the
        // PDF export working. docx-preview owns this DOM (React never
        // re-renders it), so restoring the string is the only way to strip
        // search highlights without re-parsing the whole file.
        pristineHtmlRef.current = host.innerHTML

        const text = (host.textContent ?? '').trim()
        const hasImages = host.querySelectorAll('img').length > 0

        setNumPages(count)
        setIsEmpty(count === 0 || (text === '' && !hasImages))
        setHasDeviations(warned)
        setCurrentPage(1)
        setLoading(false)
        // Default fit-width: scale the fresh pages to the container width.
        // IMPORTANT: defer past the loading→loaded commit — that very
        // commit mounts the thumbnails sidebar, which RESIZES the scroll
        // container, so a synchronous measurement here would fit the pages
        // to the transient sidebar-less width. Two frames guarantee the
        // commit is flushed and laid out (the ResizeObserver and the
        // verification pass inside recomputeFit cover any remaining race).
        if (count > 0) {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (!isCancelled) recomputeFit()
            }),
          )
        }
      } catch (err) {
        if (isCancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setLoading(false)
        toast.error('Не удалось открыть DOCX', { description: msg })
      } finally {
        // Only restore if our wrapper is still the active console.warn,
        // so we never clobber a concurrent effect's wrapper.
        if (console.warn === wrapper) console.warn = originalWarn
      }
    })()

    return () => {
      isCancelled = true
      if (console.warn === wrapper) console.warn = originalWarn
      if (hostRef.current) hostRef.current.innerHTML = ''
    }
  }, [file.id, file.arrayBuffer, recomputeFit])

  // ---- Fit-width: watch the scroll container size ----
  // The container resizes when the file metadata panel / thumbnails sidebar
  // is toggled, on window resize and on fullscreen enter/exit. recomputeFit
  // applies the new fit ONLY while the mode is on (fitWidthRef guard), so a
  // manual zoom is never clobbered by these layout changes.
  React.useEffect(() => {
    const container = rootRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => recomputeFit())
    ro.observe(container)
    return () => ro.disconnect()
  }, [recomputeFit])

  // ---- Page tracking: IntersectionObserver over the page sections ----
  // bindPages() is idempotent: it disconnects the previous observer and
  // re-observes the CURRENT section elements. It runs after the initial
  // render AND after every pristine-HTML restore (innerHTML re-parsing
  // creates new section nodes, so the old observer's targets are gone).
  const bindPages = React.useCallback(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    ratiosRef.current.clear()

    const root = rootRef.current
    const host = hostRef.current
    if (loading || error || numPages === 0 || !root || !host) return

    const sections = Array.from(
      host.querySelectorAll<HTMLElement>('.docx-wrapper > section.docx'),
    )
    if (sections.length === 0) return

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

    sections.forEach((s) => observer.observe(s))
    observerRef.current = observer
  }, [loading, error, numPages])

  React.useEffect(() => {
    bindPages()
    return () => {
      observerRef.current?.disconnect()
      observerRef.current = null
    }
  }, [bindPages])

  // ---- Thumbnails: scaled DOM clones of the rendered page sections ----
  // Built lazily — only once the panel is open and the document has pages.
  // Clones live outside the React tree (appended via ref callbacks), so we
  // simply drop them when the file changes (state is reset above).
  React.useEffect(() => {
    if (!thumbsOpen) return
    if (loading || error || numPages === 0) return
    if (thumbsBuiltForRef.current === file.id) return

    const host = hostRef.current
    if (!host) return

    const sections = Array.from(
      host.querySelectorAll<HTMLElement>('.docx-wrapper > section.docx'),
    )
    if (sections.length === 0) return

    // Natural (unzoomed) section size. NOTE: docx-preview writes the page
    // width in CSS `pt`, not px — the number must be converted (1pt = 4/3px)
    // before it can serve as the px width: the clone renders at pt → px, so
    // the scale factor must divide the *px* width, otherwise every clone
    // overflows its 140px box and gets horizontally cropped.
    const naturalWidth = (s: HTMLElement): number => {
      const raw = s.style.width
      const inline = parseFloat(raw)
      if (Number.isFinite(inline) && inline > 0) {
        return /pt$/i.test(raw) ? (inline * 96) / 72 : inline
      }
      return s.getBoundingClientRect().width / zoom
    }
    const naturalHeight = (s: HTMLElement): number => {
      const inline = parseFloat(s.style.height)
      if (Number.isFinite(inline) && inline > 0) return inline
      return s.getBoundingClientRect().height / zoom
    }

    // All pages of a document usually share one width — use the first
    // section as the reference so every clone gets the same scale factor.
    const refWidth = naturalWidth(sections[0])
    const scale = refWidth > 0 ? THUMB_WIDTH / refWidth : 1

    const items: DocxThumb[] = sections.map((s, i) => {
      const clone = s.cloneNode(true) as HTMLElement
      clone.removeAttribute('id')
      clone.style.margin = '0'
      clone.style.zoom = ''
      clone.style.transform = `scale(${scale})`
      // Thumbnails may be built AFTER a search highlighted the host —
      // unwrap any search marks so the previews stay pristine.
      clone.querySelectorAll('mark.dv-hl').forEach((mark) => {
        const parent = mark.parentNode
        if (!parent) return
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
        parent.removeChild(mark)
      })
      return {
        page: i + 1,
        node: clone,
        w: naturalWidth(s),
        h: naturalHeight(s),
      }
    })

    thumbsBuiltForRef.current = file.id
    setThumbs(items)
  }, [numPages, thumbsOpen, loading, error, zoom, file.id])

  // ---- Page navigation helper ----
  const scrollToPage = React.useCallback((page: number) => {
    if (!hostRef.current) return
    const target = hostRef.current.querySelector<HTMLElement>(
      `.docx-wrapper > section.docx[data-page-number="${page}"]`,
    )
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setCurrentPage(page)
    }
  }, [])

  // ---- Text search: snapshot/restore + DOM-walk highlighting ----
  // docx-preview owns the host DOM, so React must never re-render it.
  // Searching therefore (1) restores the pristine innerHTML (dropping any
  // previous highlights), (2) walks the text nodes and wraps each match in
  // <mark class="dv-hl">, (3) re-binds the page observer (innerHTML
  // re-parsing replaces every node, including the observed sections).
  // Highlights live in the host → they scale with the CSS zoom for free
  // and are intentionally kept in the PDF export / print output (the user
  // can clear the search before exporting).
  const restorePristine = React.useCallback(() => {
    const host = hostRef.current
    const html = pristineHtmlRef.current
    if (!host || html == null) return
    host.innerHTML = html
    bindPages()
  }, [bindPages])

  const goToMatch = React.useCallback((index: number) => {
    const host = hostRef.current
    if (!host) return
    const marks = host.querySelectorAll<HTMLElement>('mark.dv-hl')
    if (marks.length === 0) return
    const idx = ((index % marks.length) + marks.length) % marks.length
    marks.forEach((m, i) => m.classList.toggle('dv-hl-active', i === idx))
    // The mark lives inside the scroll container (and the zoom wrapper) —
    // the native scrollIntoView scrolls the right ancestor for us.
    marks[idx].scrollIntoView({ block: 'center', behavior: 'smooth' })
    setActiveMatch(idx)
  }, [])

  const runSearch = React.useCallback(async () => {
    const host = hostRef.current
    const q = searchQuery.trim()
    if (!host || !q || loading || error) return
    if (pristineHtmlRef.current == null) return
    const renderId = renderIdRef.current
    setSearching(true)
    // Yield a frame so the toolbar paints the busy spinner before the
    // (synchronous) DOM walk below can block the main thread.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    )
    try {
      // The file changed while we waited for the frame — abort.
      if (renderId !== renderIdRef.current) return
      // Always start from the pristine DOM — removes previous highlights.
      restorePristine()

      const re = new RegExp(escapeRegExp(q), 'gi')
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
        acceptNode: (node: Node): number => {
          const parent = node.parentElement
          if (
            parent &&
            (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')
          ) {
            return NodeFilter.FILTER_REJECT
          }
          return (node.nodeValue ?? '').trim() === ''
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT
        },
      })
      // Collect the nodes first, mutate after — replacing nodes while the
      // TreeWalker is iterating them is unsafe.
      const textNodes: Text[] = []
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        textNodes.push(n as Text)
      }

      let total = 0
      for (const node of textNodes) {
        const text = node.nodeValue ?? ''
        const parent = node.parentNode
        if (!text || !parent) continue
        re.lastIndex = 0
        const hits: Array<[number, number]> = []
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) {
          hits.push([m.index, m.index + m[0].length])
          if (m[0].length === 0) re.lastIndex += 1 // zero-length safety
        }
        if (hits.length === 0) continue
        const frag = document.createDocumentFragment()
        let pos = 0
        for (const [start, end] of hits) {
          if (pos < start) {
            frag.appendChild(document.createTextNode(text.slice(pos, start)))
          }
          const mark = document.createElement('mark')
          mark.className = 'dv-hl'
          mark.textContent = text.slice(start, end)
          frag.appendChild(mark)
          total += 1
          pos = end
        }
        if (pos < text.length) {
          frag.appendChild(document.createTextNode(text.slice(pos)))
        }
        parent.replaceChild(frag, node)
      }

      setSearchTotal(total)
      setActiveMatch(0)
      if (total === 0) {
        toast.message(`«${q}» не найдено`)
      } else {
        toast.success(`Найдено ${total} совпад.`)
        goToMatch(0)
      }
    } finally {
      setSearching(false)
    }
  }, [searchQuery, loading, error, restorePristine, goToMatch])

  const goPrevMatch = React.useCallback(() => {
    if (!searchTotal) return
    goToMatch(activeMatch - 1)
  }, [searchTotal, activeMatch, goToMatch])

  const goNextMatch = React.useCallback(() => {
    if (!searchTotal) return
    goToMatch(activeMatch + 1)
  }, [searchTotal, activeMatch, goToMatch])

  const clearSearch = React.useCallback(() => {
    restorePristine()
    setSearchQuery('')
    setSearchTotal(null)
    setActiveMatch(0)
  }, [restorePristine])

  // ---- Zoom controls (applied via the CSS `zoom` property) ----
  const zoomPct = Math.round(zoom * 100)
  // Manual zooming leaves fit-width mode. The ref is written FIRST so any
  // in-flight recompute (ResizeObserver callback) sees the fresh mode
  // immediately, before React re-renders.
  const handleZoomIn = React.useCallback(() => {
    fitWidthRef.current = false
    setFitWidth(false)
    setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))
  }, [])
  const handleZoomOut = React.useCallback(() => {
    fitWidthRef.current = false
    setFitWidth(false)
    setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))
  }, [])
  // Reset = explicit 100% request → fit mode stays OFF on purpose: a reset
  // that silently re-locked the zoom to the container width would be
  // surprising (the dedicated fit button exists for exactly that).
  const handleZoomReset = React.useCallback(() => {
    fitWidthRef.current = false
    setFitWidth(false)
    setZoom(1)
  }, [])
  // The dedicated "По ширине" button re-enables the mode and recomputes the
  // fit immediately (the ResizeObserver stays armed for later resizes).
  // lastFitRef is nulled so the recompute always APPLIES (a stale equal
  // value would otherwise be skipped as "unchanged").
  const handleFitWidth = React.useCallback(() => {
    fitWidthRef.current = true
    setFitWidth(true)
    lastFitRef.current = null
    recomputeFit()
  }, [recomputeFit])

  // ---- Client-side PDF export (html2canvas-pro + jsPDF) ----
  const handleExportPdf = React.useCallback(async () => {
    const wrap = zoomWrapRef.current
    const host = hostRef.current
    if (!wrap || !host) return
    // html2canvas must see the natural page sizes, so the wrapper renders
    // zoom 1 while `exporting` is true (declarative style on the JSX below)
    // and fit recomputes are paused (exportingRef) so the zoom cannot
    // change mid-capture. Also temporarily widen the wrapper to the page's
    // natural width — the `max-width: 100%` rule on sections would
    // otherwise clip pages when the viewer container is narrower than the
    // document's page width.
    exportingRef.current = true
    setExporting(true)
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    const prevWidth = wrap.style.width
    const firstSection = host.querySelector<HTMLElement>('section.docx')
    const rawWidth = firstSection?.style.width ?? ''
    const widthNum = parseFloat(rawWidth)
    // docx-preview writes pt; accept px too, ignore anything else.
    const naturalPx = /pt$/i.test(rawWidth)
      ? (widthNum * 96) / 72
      : /px$/i.test(rawWidth)
        ? widthNum
        : 0
    if (naturalPx > wrap.clientWidth) {
      wrap.style.width = `${Math.ceil(naturalPx)}px`
    }
    try {
      await exportElementToPdf(host, file.name)
      toast.success(`PDF сохранён: ${pdfFilename(file.name)}`)
    } finally {
      wrap.style.width = prevWidth
      exportingRef.current = false
      setExporting(false)
      // Self-heal: if the container changed while the recomputes were
      // paused, re-apply the fit now (no-op for a manual zoom).
      recomputeFit()
    }
  }, [file.name, recomputeFit])

  const showThumbsSidebar = !loading && !error && numPages > 0

  return (
    <ViewerShell
      file={file}
      category="docx"
      busy={loading}
      zoom={{
        value: zoomPct,
        min: Math.round(ZOOM_MIN * 100),
        max: Math.round(ZOOM_MAX * 100),
        onZoomIn: handleZoomIn,
        onZoomOut: handleZoomOut,
        onReset: handleZoomReset,
        isReset: zoom === 1,
        onFitWidth: handleFitWidth,
        isFit: fitWidth,
      }}
      pageNav={
        numPages > 1
          ? {
              page: currentPage,
              total: numPages,
              onGoToPage: scrollToPage,
              unit: 'страница',
            }
          : undefined
      }
      centerExtra={
        <ShellSearch
          value={searchQuery}
          onChange={setSearchQuery}
          onSubmit={runSearch}
          onPrev={goPrevMatch}
          onNext={goNextMatch}
          onClear={clearSearch}
          total={searchTotal ?? undefined}
          activeIndex={activeMatch}
          busy={searching}
          disabled={loading || !!error || numPages === 0}
          label="Поиск по документу DOCX"
        />
      }
      toolbarEnd={
        <>
          {hasDeviations ? (
            <span
              className="dv-deviation-badge"
              title="При рендере docx-preview выдал предупреждения. Подробности — в консоли браузера."
            >
              <AlertTriangle className="size-3" />
              Документ отрендерен с возможными отклонениями
            </span>
          ) : null}
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
      printRootRef={hostRef}
      exportRootRef={hostRef}
      thumbs={
        showThumbsSidebar ? (
          <>
            {thumbs.map((t) => {
              const s = t.w > 0 ? THUMB_WIDTH / t.w : 1
              return (
                <div
                  key={t.page}
                  className="dv-thumb mb-2"
                  data-active={currentPage === t.page ? 'true' : 'false'}
                  role="button"
                  tabIndex={0}
                  aria-label={`Страница ${t.page}`}
                  onClick={() => scrollToPage(t.page)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      scrollToPage(t.page)
                    }
                  }}
                >
                  <div
                    className="dv-thumb-clone"
                    style={{
                      width: THUMB_WIDTH,
                      height: Math.max(1, Math.round(t.h * s)),
                    }}
                    ref={(el) => {
                      if (el && t.node.parentElement !== el) {
                        el.replaceChildren(t.node)
                      }
                    }}
                  />
                  <span className="dv-thumb-num">{t.page}</span>
                </div>
              )
            })}
          </>
        ) : null
      }
      thumbsLabel="Миниатюры страниц"
    >
      <div
        ref={rootRef}
        className="dv-scroll h-full flex-1 overflow-auto bg-background"
      >
        {/* Body */}
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm">Рендеринг DOCX…</p>
          </div>
        ) : error ? (
          <div className="mx-auto max-w-[800px] px-4 py-6">
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            >
              <AlertTriangle className="size-5 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium">Ошибка рендеринга</p>
                <p className="mt-1 break-words">{error}</p>
              </div>
            </div>
          </div>
        ) : isEmpty ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Документ пуст или не содержит извлекаемого содержимого.
          </p>
        ) : null}

        {/* Zoom wrapper: CSS `zoom` scales the whole document while the
            IntersectionObserver-based pagination keeps working. During the
            PDF export the zoom is forced to 1 declaratively (html2canvas
            needs the natural page sizes). It also carries the `dv-night`
            marker (dropped while exporting so the capture keeps natural
            page colours) — the CSS inverts the section.docx pages inside. */}
        <div
          ref={zoomWrapRef}
          style={{ zoom: exporting ? 1 : zoom }}
          className={cn(nightMode && !exporting && 'dv-night')}
        >
          {/* docx-preview injects .docx-wrapper > section.docx pages here. */}
          <div ref={hostRef} className="dv-docx-host2" />
        </div>
      </div>
    </ViewerShell>
  )
}
