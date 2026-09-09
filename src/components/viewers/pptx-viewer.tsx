'use client'

import * as React from 'react'
import JSZip from 'jszip'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, AlertTriangle, Presentation } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FullscreenButton } from '@/components/fullscreen-button'
import { useFullscreen } from '@/lib/use-fullscreen'
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

export function PptxViewer({ file }: ViewerProps) {
  const [slides, setSlides] = React.useState<ParsedSlide[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [current, setCurrent] = React.useState(0)
  const [gotoValue, setGotoValue] = React.useState('')

  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const thumbRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  const { isFullscreen, toggle, supported } = useFullscreen(rootRef)

  React.useEffect(() => {
    let isCancelled = false
    setLoading(true)
    setError(null)
    setSlides([])
    setCurrent(0)
    setGotoValue('')
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

  const goToSlide = React.useCallback((idx: number) => {
    setCurrent((c) => {
      if (slides.length === 0) return c
      const clamped = Math.max(0, Math.min(slides.length - 1, idx))
      return clamped === c ? c : clamped
    })
  }, [slides.length])

  const handlePrev = React.useCallback(() => {
    setCurrent((c) => (c <= 0 ? c : c - 1))
  }, [])

  const handleNext = React.useCallback(() => {
    setCurrent((c) => (c >= slides.length - 1 ? c : c + 1))
  }, [slides.length])

  const handleGotoSubmit = () => {
    const n = parseInt(gotoValue, 10)
    if (Number.isFinite(n)) {
      goToSlide(n - 1) // user enters 1-indexed slide number
    }
    setGotoValue('')
    // Return keyboard focus to the viewer root so arrow-key navigation keeps working.
    rootRef.current?.focus({ preventScroll: true })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Only react when the root itself is focused (not when typing in inputs etc.)
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

  // Auto-scroll the active thumbnail into view inside the strip when current changes
  React.useEffect(() => {
    const el = thumbRefs.current[current]
    if (el) {
      el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    }
  }, [current, slides.length])

  if (loading) {
    return (
      <div className="dv-scroll h-full overflow-auto">
        <div className="flex h-full flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <Presentation className="size-10 animate-pulse text-orange-500" />
          <p className="text-sm">Извлечение слайдов из презентации…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dv-scroll h-full overflow-auto p-6">
        <div className="mx-auto max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="mx-auto size-10 text-destructive" />
          <p className="mt-3 font-medium text-destructive">
            Не удалось открыть презентацию
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  if (slides.length === 0) {
    return (
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
    )
  }

  const active = slides[current]
  const isEmpty =
    active.textParagraphs.length === 0 && active.images.length === 0

  return (
    <div
      ref={rootRef}
      className="dv-scroll h-full overflow-auto bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
      tabIndex={0}
      aria-label="Просмотр PPTX. Используйте стрелки влево/вправо для навигации по слайдам."
      onKeyDown={handleKeyDown}
    >
      <div className="flex min-h-full flex-col">
        {/* Sticky header: amber notice + slide navigation bar */}
        <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>
              Упрощённый просмотр: извлекается текст и изображения. Анимации,
              переходы и точное форматирование не воспроизводятся.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrev}
              disabled={current === 0}
              aria-label="Предыдущий слайд"
            >
              <ChevronLeft className="size-4" />
              <span className="hidden sm:inline">Назад</span>
            </Button>

            <span
              className="min-w-[8rem] text-center text-sm font-medium tabular-nums text-foreground"
              aria-live="polite"
            >
              Слайд {current + 1} из {slides.length}
            </span>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNext}
              disabled={current === slides.length - 1}
              aria-label="Следующий слайд"
            >
              <span className="hidden sm:inline">Вперёд</span>
              <ChevronRight className="size-4" />
            </Button>

            {/* Go to slide */}
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={1}
                max={slides.length}
                value={gotoValue}
                onChange={(e) => setGotoValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleGotoSubmit()
                  }
                }}
                placeholder="№"
                aria-label="Перейти к слайду"
                className="h-8 w-14 px-2 py-1 text-sm tabular-nums"
                inputMode="numeric"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGotoSubmit}
                disabled={gotoValue.trim() === ''}
                aria-label="Перейти к указанному слайду"
              >
                Перейти
              </Button>
            </div>

            <FullscreenButton
              isFullscreen={isFullscreen}
              onToggle={toggle}
              disabled={!supported}
              className="ml-auto"
            />
          </div>
        </div>

        {/* Main slide area — single current slide */}
        <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
          <div
            className="dv-slide relative flex aspect-video w-full max-w-[900px] flex-col items-center justify-center gap-3 rounded-lg p-6 text-center text-black"
            aria-label={`Слайд ${current + 1}`}
          >
            {/* Slide number badge */}
            <div className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
              {active.index}
            </div>

            {isEmpty && <p className="text-sm text-zinc-400">Пустой слайд</p>}

            {active.textParagraphs.length > 0 && (
              <div className="flex w-full flex-col items-center justify-center gap-1 overflow-hidden">
                {active.textParagraphs.map((p, i) => (
                  <p
                    key={i}
                    className={cn(
                      'leading-snug',
                      i === 0 ? 'text-xl font-semibold' : 'text-sm',
                    )}
                  >
                    {p}
                  </p>
                ))}
              </div>
            )}

            {active.images.length > 0 && (
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

        {/* Thumbnail strip */}
        <div className="dv-pptx-thumbs">
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
                className="dv-pptx-thumb"
                data-active={idx === current ? 'true' : 'false'}
                aria-label={`Слайд ${idx + 1} из ${slides.length}`}
                aria-current={idx === current ? 'true' : 'false'}
                onClick={() => goToSlide(idx)}
              >
                <span className="dv-pptx-thumb-num">{slide.index}</span>
                <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-hidden p-1 text-center">
                  {thumbEmpty ? (
                    <span className="text-[8px] text-zinc-400">Пусто</span>
                  ) : (
                    <>
                      {slide.textParagraphs.slice(0, 2).map((p, i) => (
                        <span
                          key={i}
                          className={cn(
                            'block w-full truncate text-[8px] leading-tight',
                            i === 0
                              ? 'font-semibold text-black'
                              : 'text-zinc-700',
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
                          className="mt-0.5 max-h-6 max-w-[70%] object-contain"
                        />
                      )}
                    </>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
