'use client'

import * as React from 'react'
import JSZip from 'jszip'
import { toast } from 'sonner'
import { AlertTriangle, Moon, Presentation, Sun } from 'lucide-react'
import type { jsPDF } from 'jspdf'

import { Button } from '@/components/ui/button'
import { ShellSearch, ViewerShell } from '@/components/viewer-shell'
import { useViewerUiStore } from '@/lib/viewer-ui-store'
import {
  appendElementAsPdfPage,
  createPdfDocument,
  pdfFilename,
} from '@/lib/export-pdf'
import { cn } from '@/lib/utils'
import type { LoadedFile } from '@/lib/viewers/types'

interface ViewerProps {
  file: LoadedFile
}

interface SlideImage {
  src: string
  ext: string
}

interface ParsedSlide {
  index: number
  textParagraphs: string[]
  images: SlideImage[]
}

/** One search hit: `start`/`end` are character offsets within
 *  `slides[slide].textParagraphs[para]`. */
interface SlideMatch {
  /** Slide index (0-based, into the `slides` array — NOT the slide number). */
  slide: number
  /** Paragraph index within that slide. */
  para: number
  start: number
  end: number
}

/** Escapes regex metacharacters so the query is matched literally. */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Russian plural forms for «совпадение» (1/11/21 rules). */
function pluralMatches(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'совпадение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'совпадения'
  }
  return 'совпадений'
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/emf',
  wmf: 'image/wmf',
}

const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/

function mimeForExt(ext: string): string {
  return EXT_MIME[ext.toLowerCase()] || 'application/octet-stream'
}

function normalizeZipPath(p: string): string {
  const parts = p.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

/** Wait for `n` animation frames — gives React time to flush a re-render into the DOM. */
const nextFrames = (n: number) =>
  new Promise<void>((res) => {
    const go = (k: number) => {
      if (k <= 0) return res()
      requestAnimationFrame(() => go(k - 1))
    }
    go(n)
  })

/** Upper bound for the auto-fitted slide width — slides must not get absurdly huge. */
const MAX_SLIDE_WIDTH = 1280

export function PptxViewer({ file }: ViewerProps) {
  const [slides, setSlides] = React.useState<ParsedSlide[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [current, setCurrent] = React.useState(0)
  /** Auto-fitted slide width in px (null until the container has been measured). */
  const [fitWidth, setFitWidth] = React.useState<number | null>(null)
  /** While true the slide's width transition is disabled — PDF capture must not animate. */
  const [capturing, setCapturing] = React.useState(false)
  /** The slide's flex container (success branch only) — observed for auto-fit. */
  const [containerEl, setContainerEl] = React.useState<HTMLDivElement | null>(null)

  // «Night mode» — the shared, persisted global flag (see viewer-ui-store).
  // The marker class lands on the slide ARENA (the auto-fit container). No
  // style targets the arena itself — the CSS inverts the .dv-slide child —
  // so the arena's scrollbars stay natural. The class is dropped while
  // `capturing` so the html2canvas slide captures keep natural colours (and
  // print clones never see it: the print root is the slide, not the arena).
  const nightMode = useViewerUiStore((s) => s.nightMode)
  const toggleNightMode = useViewerUiStore((s) => s.toggleNightMode)

  // ---- Search (spans ALL slides, live counter — XLSX 2-b pattern) ----
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  /** Bumped on every explicit navigation (submit / prev / next) so the
   *  scroll-into-view effect re-runs even when the index is unchanged. */
  const [navTick, setNavTick] = React.useState(0)
  /** Query as of the last submit — Enter with an unchanged query advances to
   *  the next match instead of restarting from the first one (text-viewer
   *  semantics). */
  const lastSubmittedRef = React.useRef('')

  /** The rendered slide element — print target and PDF capture source. */
  const slideAreaRef = React.useRef<HTMLDivElement | null>(null)
  const thumbRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  /* ---------------------------------------------------------------- */
  /*  Auto-fit width: the slide fills the available container width   */
  /*  (minus its horizontal padding), capped at MAX_SLIDE_WIDTH.      */
  /*  A ResizeObserver on the container reacts to the metadata panel  */
  /*  / thumbnails sidebar toggles and window resizes automatically.  */
  /* ---------------------------------------------------------------- */
  React.useEffect(() => {
    if (!containerEl) return

    const measure = () => {
      const style = window.getComputedStyle(containerEl)
      const padX =
        (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      const available = containerEl.clientWidth - padX
      if (available <= 0) return
      const next = Math.min(available, MAX_SLIDE_WIDTH)
      setFitWidth((prev) =>
        prev !== null && Math.abs(prev - next) < 0.5 ? prev : next,
      )
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(containerEl)
    return () => ro.disconnect()
  }, [containerEl])

  React.useEffect(() => {
    let isCancelled = false
    setLoading(true)
    setError(null)
    setSlides([])
    setCurrent(0)
    setQuery('')
    setActiveIndex(0)
    setNavTick(0)
    lastSubmittedRef.current = ''
    thumbRefs.current = []

    async function parse() {
      try {
        const zip = await JSZip.loadAsync(file.arrayBuffer)
        if (isCancelled) return

        const slidePaths = Object.keys(zip.files)
          .filter((p) => SLIDE_PATH_RE.test(p))
          .sort((a, b) => {
            const na = parseInt(a.match(SLIDE_PATH_RE)![1], 10)
            const nb = parseInt(b.match(SLIDE_PATH_RE)![1], 10)
            return na - nb
          })

        if (slidePaths.length === 0) {
          if (isCancelled) return
          setSlides([])
          setLoading(false)
          return
        }

        const parser = new DOMParser()
        const parsed: ParsedSlide[] = []

        for (const path of slidePaths) {
          if (isCancelled) return
          const n = parseInt(path.match(SLIDE_PATH_RE)![1], 10)
          const slideFile = zip.file(path)
          if (!slideFile) continue
          const xml = await slideFile.async('string')
          if (isCancelled) return

          const doc = parser.parseFromString(xml, 'text/xml')

          // ---- Text paragraphs (a:p -> a:t) ----
          const paragraphs: string[] = []
          const pEls = doc.getElementsByTagName('a:p')
          for (let i = 0; i < pEls.length; i++) {
            const pEl = pEls[i]
            const tEls = pEl.getElementsByTagName('a:t')
            let text = ''
            for (let j = 0; j < tEls.length; j++) {
              text += tEls[j].textContent || ''
            }
            if (text.trim().length > 0) {
              paragraphs.push(text)
            }
          }

          // ---- Build rId -> media path map from the slide's rels file ----
          const relsPath = `ppt/slides/_rels/slide${n}.xml.rels`
          const relsFile = zip.file(relsPath)
          const relMap = new Map<string, string>()
          if (relsFile) {
            const relsXml = await relsFile.async('string')
            if (isCancelled) return
            const relsDoc = parser.parseFromString(relsXml, 'text/xml')
            const relEls = relsDoc.getElementsByTagName('Relationship')
            for (let i = 0; i < relEls.length; i++) {
              const rel = relEls[i]
              const id = rel.getAttribute('Id') || ''
              const target = rel.getAttribute('Target') || ''
              if (!id || !target) continue
              // Target is relative to ppt/slides/ (the rels file lives in ppt/slides/_rels/)
              const abs = normalizeZipPath(`ppt/slides/${target}`)
              relMap.set(id, abs)
            }
          }

          // ---- Resolve images via a:blip r:embed ----
          const images: SlideImage[] = []
          const seenSrcs = new Set<string>()
          const blipEls = doc.getElementsByTagName('a:blip')
          for (let i = 0; i < blipEls.length; i++) {
            const blip = blipEls[i]
            const rId = blip.getAttribute('r:embed') || blip.getAttributeNS(RELS_NS, 'embed')
            if (!rId) continue
            const mediaPath = relMap.get(rId)
            if (!mediaPath) continue
            const mediaFile = zip.file(mediaPath)
            if (!mediaFile) continue
            const base64 = await mediaFile.async('base64')
            if (isCancelled) return
            const ext = mediaPath.split('.').pop()?.toLowerCase() || 'png'
            const mime = mimeForExt(ext)
            const dataUri = `data:${mime};base64,${base64}`
            if (seenSrcs.has(dataUri)) continue
            seenSrcs.add(dataUri)
            images.push({ src: dataUri, ext })
          }

          parsed.push({
            index: n,
            textParagraphs: paragraphs,
            images,
          })
        }

        if (isCancelled) return
        setSlides(parsed)
        setLoading(false)
      } catch (err) {
        if (isCancelled) return
        console.error('PPTX parse error', err)
        const message =
          err instanceof Error ? err.message : 'Не удалось разобрать файл PPTX'
        setError(message)
        setLoading(false)
        toast.error('Не удалось открыть PPTX: ' + message)
      }
    }

    void parse()

    return () => {
      isCancelled = true
    }
  }, [file.id, file.arrayBuffer])

  /** Flat ordered match list over ALL slides (slide order → paragraph order
   *  → occurrence order). Case-insensitive literal regex with 'g' + 'i' —
   *  unlike toLowerCase()+indexOf the 'i' flag never changes string length,
   *  so `start`/`end` are always valid for String.slice — non-overlapping
   *  hits (exec advances lastIndex past each match). Synchronous memo: the
   *  counter and the marks update while the user types, no submit needed.
   *  Empty/whitespace query → [] (zero-overhead path). */
  const matches = React.useMemo<SlideMatch[]>(() => {
    const q = query.trim()
    if (!q || slides.length === 0) return []
    let re: RegExp
    try {
      re = new RegExp(escapeRegExp(q), 'gi')
    } catch {
      return []
    }
    const result: SlideMatch[] = []
    for (let si = 0; si < slides.length; si++) {
      const paras = slides[si].textParagraphs
      for (let pi = 0; pi < paras.length; pi++) {
        const text = paras[pi]
        if (!text) continue
        re.lastIndex = 0
        for (let m = re.exec(text); m !== null; m = re.exec(text)) {
          result.push({
            slide: si,
            para: pi,
            start: m.index,
            end: m.index + m[0].length,
          })
        }
      }
    }
    return result
  }, [slides, query])

  const total = matches.length
  /** Clamp so query edits that shrink the match list keep the index valid. */
  const activeIdx = total > 0 ? Math.min(activeIndex, total - 1) : 0
  const activeMatch = total > 0 ? matches[activeIdx] : null

  /** Per-paragraph matches ON THE CURRENT SLIDE — only the current slide is
   *  rendered, so marks on the other slides appear once navigation lands
   *  there. Same objects as `matches`, so identity comparison identifies
   *  the active mark. */
  const matchesByPara = React.useMemo(() => {
    if (matches.length === 0) return null
    const map = new Map<number, SlideMatch[]>()
    for (const m of matches) {
      if (m.slide !== current) continue
      const arr = map.get(m.para)
      if (arr) arr.push(m)
      else map.set(m.para, [m])
    }
    return map.size > 0 ? map : null
  }, [matches, current])

  const goToSlide = React.useCallback((idx: number) => {
    setCurrent((c) => {
      if (slides.length === 0) return c
      const clamped = Math.max(0, Math.min(slides.length - 1, idx))
      return clamped === c ? c : clamped
    })
  }, [slides.length])

  /** Jump to match #idx: switches the slide when the match lives elsewhere
   *  (React batches both updates, so the scroll effect below sees the new
   *  slide's marks already rendered). */
  const goToMatch = React.useCallback(
    (idx: number) => {
      setActiveIndex(idx)
      const m = matches[idx]
      if (m) goToSlide(m.slide)
      setNavTick((t) => t + 1)
    },
    [matches, goToSlide],
  )

  const goNext = React.useCallback(() => {
    if (total === 0) return
    goToMatch((activeIdx + 1) % total)
  }, [total, activeIdx, goToMatch])

  const goPrev = React.useCallback(() => {
    if (total === 0) return
    goToMatch((activeIdx - 1 + total) % total)
  }, [total, activeIdx, goToMatch])

  const handleSubmit = React.useCallback(() => {
    if (total === 0) {
      toast.message(`«${query}» не найдено`)
      return
    }
    if (lastSubmittedRef.current === query) {
      goToMatch((activeIdx + 1) % total)
    } else {
      lastSubmittedRef.current = query
      goToMatch(0)
    }
    toast.success(`Найдено ${total} ${pluralMatches(total)}`)
  }, [total, query, activeIdx, goToMatch])

  const handleClear = React.useCallback(() => {
    setQuery('')
    setActiveIndex(0)
    lastSubmittedRef.current = ''
  }, [])

  /* Centre the active mark after explicit navigation (submit / prev /
   *  next) and after the slide changes (manual navigation to the slide
   *  where the active match lives re-centres it as well). Typing never
   *  moves the viewport — the counter and the marks update live,
   *  scrolling happens on navigation only (text-viewer semantics). One
   *  rAF lets the freshly switched slide settle; if the mark is not in the
   *  DOM yet, retry a couple of frames and then give up quietly. Skipped
   *  while the PDF export flips slides (the capture loop must not fight a
   *  smooth scroll). */
  React.useEffect(() => {
    if (capturing) return
    let attempts = 0
    let raf = 0
    const tryScroll = () => {
      const el = slideAreaRef.current?.querySelector('mark.dv-hl-active')
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        return
      }
      if (attempts < 2) {
        attempts += 1
        raf = requestAnimationFrame(tryScroll)
      }
    }
    raf = requestAnimationFrame(tryScroll)
    return () => cancelAnimationFrame(raf)
  }, [activeIndex, navTick, current, capturing])

  const handlePrev = React.useCallback(() => {
    setCurrent((c) => (c <= 0 ? c : c - 1))
  }, [])

  const handleNext = React.useCallback(() => {
    setCurrent((c) => (c >= slides.length - 1 ? c : c + 1))
  }, [slides.length])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Only react when the wrapper itself is focused (not when typing in inputs etc.)
    const target = e.target as HTMLElement | null
    if (target && target !== e.currentTarget) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      handlePrev()
    } else if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault()
      handleNext()
    } else if (e.key === 'Home') {
      e.preventDefault()
      goToSlide(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      goToSlide(slides.length - 1)
    }
  }

  // Auto-scroll the active thumbnail into view when the current slide changes
  React.useEffect(() => {
    const el = thumbRefs.current[current]
    if (el) {
      // The sidebar is display:none when collapsed — scrollIntoView is a no-op then.
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [current, slides.length])

  /**
   * Slide-by-slide PDF export: only the current slide lives in the DOM, so we
   * sequentially flip `current`, wait for two animation frames and capture the
   * slide element, then assemble all captures into a single jsPDF document.
   *
   * Search marks (<mark class="dv-hl">) live inside the captured element, so
   * slides with matches export WITH their highlights (same trade-off as the
   * DOCX viewer). The active-match scroll effect is disabled while capturing.
   */
  const handleExportPdf = React.useCallback(async () => {
    const slideEl = slideAreaRef.current
    if (!slideEl || slides.length === 0) return
    const original = current
    let pdf: jsPDF | null = null
    // Disable the width transition while capturing — getBoundingClientRect /
    // html2canvas must see a settled element, not a mid-animation width.
    setCapturing(true)
    try {
      // Let React flush the transition-free render before the first measurement.
      await nextFrames(2)
      for (let i = 0; i < slides.length; i++) {
        if (i !== original) {
          setCurrent(i)
          await nextFrames(2)
        }
        const rect = slideEl.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) continue
        if (!pdf) pdf = createPdfDocument(Math.ceil(rect.width), Math.ceil(rect.height))
        await appendElementAsPdfPage(pdf, slideEl)
      }
      if (pdf) pdf.save(pdfFilename(file.name))
    } finally {
      setCurrent(original)
      setCapturing(false)
    }
  }, [slides.length, current, file.name])

  const active = slides.length > 0 ? slides[current] : null
  const isEmpty =
    active !== null && active.textParagraphs.length === 0 && active.images.length === 0

  /** Renders one paragraph, wrapping query matches into <mark> highlights
   *  (text-viewer's renderLine pattern: plain / marked / active segments).
   *  Returns the plain string when the paragraph has no matches
   *  (zero-overhead path — only paragraphs with hits get segmented).
   *  Thumbnails deliberately stay clean (no marks there). */
  const renderParagraph = (text: string, paraIndex: number): React.ReactNode => {
    const pMatches = matchesByPara?.get(paraIndex)
    if (!pMatches || pMatches.length === 0) return text
    const parts: React.ReactNode[] = []
    let pos = 0
    pMatches.forEach((m, k) => {
      if (m.start > pos) parts.push(text.slice(pos, m.start))
      parts.push(
        <mark
          key={k}
          className={m === activeMatch ? 'dv-hl dv-hl-active' : 'dv-hl'}
        >
          {text.slice(m.start, m.end)}
        </mark>,
      )
      pos = m.end
    })
    if (pos < text.length) parts.push(text.slice(pos))
    return parts
  }

  return (
    <ViewerShell
      file={file}
      category="pptx"
      busy={loading}
      pageNav={
        slides.length > 0
          ? {
              page: current + 1,
              total: slides.length,
              onGoToPage: (p) => goToSlide(p - 1),
              unit: 'слайд',
            }
          : undefined
      }
      centerExtra={
        /* Layout note: the shell's centre cell is `min-w-max`, so this group
         * must stay rem-capped (same solution as the text/xlsx viewers) —
         * otherwise the toolbar would overflow the shell into the metadata
         * panel. The search form takes its own full-width row (it is
         * flex-basis-0 and needs real free space). Caps: 28rem from md
         * (fits next to the metadata panel), 43rem from xl. */
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
              disabled={loading || !!error || slides.length === 0}
              placeholder="Поиск по слайдам…"
              label="Поиск по слайдам"
            />
          </div>
        </div>
      }
      download={{ mode: 'screenshot' }}
      onExportPdf={handleExportPdf}
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
      printRootRef={slideAreaRef}
      thumbs={
        slides.length > 0 ? (
          <div>
            {slides.map((slide, idx) => {
              const thumbEmpty =
                slide.textParagraphs.length === 0 && slide.images.length === 0
              return (
                <button
                  key={slide.index}
                  type="button"
                  ref={(el) => {
                    thumbRefs.current[idx] = el
                  }}
                  className="dv-thumb mb-2"
                  data-active={idx === current ? 'true' : 'false'}
                  aria-label={`Слайд ${idx + 1} из ${slides.length}`}
                  aria-current={idx === current}
                  onClick={() => goToSlide(idx)}
                >
                  <div className="flex aspect-video w-full flex-col items-center justify-center gap-0.5 overflow-hidden bg-white p-1 text-center">
                    {thumbEmpty ? (
                      <span className="text-[9px] text-zinc-400">Пусто</span>
                    ) : (
                      <>
                        {slide.textParagraphs.slice(0, 2).map((p, i) => (
                          <span
                            key={i}
                            className={cn(
                              'block w-full truncate text-[9px] leading-tight',
                              i === 0 ? 'font-semibold text-black' : 'text-zinc-700',
                            )}
                          >
                            {p}
                          </span>
                        ))}
                        {slide.images.length > 0 && (
                          <img
                            src={slide.images[0].src}
                            alt=""
                            aria-hidden="true"
                            className="mt-0.5 max-h-8 max-w-[70%] object-contain"
                          />
                        )}
                      </>
                    )}
                  </div>
                  <span className="dv-thumb-num">{slide.index}</span>
                </button>
              )
            })}
          </div>
        ) : undefined
      }
      thumbsLabel="Миниатюры слайдов"
    >
      {loading ? (
        <div className="dv-scroll h-full overflow-auto">
          <div className="flex h-full flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Presentation className="size-10 animate-pulse text-primary" />
            <p className="text-sm">Извлечение слайдов из презентации…</p>
          </div>
        </div>
      ) : error ? (
        <div className="dv-scroll h-full overflow-auto p-6">
          <div className="mx-auto max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
            <AlertTriangle className="mx-auto size-10 text-destructive" />
            <p className="mt-3 font-medium text-destructive">
              Не удалось открыть презентацию
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : slides.length === 0 ? (
        <div className="dv-scroll h-full overflow-auto p-6">
          <div className="mx-auto max-w-md rounded-lg border border-amber-500/40 bg-amber-500/5 p-6 text-center">
            <Presentation className="mx-auto size-10 text-amber-600" />
            <p className="mt-3 font-medium text-amber-700 dark:text-amber-300">
              Слайды не найдены
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              В этом файле не удалось найти слайды PPTX. Возможно, файл повреждён или
              использует неподдерживаемый формат.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="flex h-full min-h-0 flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          data-dv-local-keys="true"
          aria-label="Просмотр PPTX. Используйте стрелки влево/вправо для навигации по слайдам."
        >
          {/* Compact amber notice */}
          <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/15 px-4 py-1.5 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="truncate">
              Упрощённый просмотр: извлекается текст и изображения. Точное форматирование
              не воспроизводится.
            </span>
          </div>

          {/* Slide area — only the current slide is rendered. The arena
              carries the `dv-night` marker (dropped while capturing so the
              PDF export stays natural — the slide itself is the print root
              and is cloned without the arena). */}
          <div
            ref={setContainerEl}
            className={cn(
              'flex flex-1 items-center justify-center overflow-auto p-4 sm:p-6',
              nightMode && !capturing && 'dv-night',
            )}
          >
            <div
              ref={slideAreaRef}
              data-dv-page="1"
              className={cn(
                'dv-slide relative flex aspect-video flex-col items-center justify-center gap-3 rounded-lg p-6 text-center text-black',
                !capturing && 'transition-[width] duration-200 ease-out',
              )}
              style={
                fitWidth === null ? { width: '100%', maxWidth: '900px' } : { width: fitWidth }
              }
              aria-label={`Слайд ${current + 1}`}
            >
              {/* Slide number badge */}
              <div className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
                {active?.index}
              </div>

              {isEmpty && <p className="text-sm text-zinc-400">Пустой слайд</p>}

              {active && active.textParagraphs.length > 0 && (
                <div className="flex w-full flex-col items-center justify-center gap-1 overflow-hidden">
                  {active.textParagraphs.map((p, i) => (
                    <p
                      key={i}
                      className={cn(
                        'leading-snug',
                        i === 0 ? 'text-xl font-semibold' : 'text-sm',
                      )}
                    >
                      {renderParagraph(p, i)}
                    </p>
                  ))}
                </div>
              )}

              {active && active.images.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {active.images.map((img, i) => (
                    <img
                      key={i}
                      src={img.src}
                      alt={`Изображение ${i + 1} слайда ${active.index}`}
                      className="max-h-[55%] max-w-[80%] object-contain"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </ViewerShell>
  )
}
