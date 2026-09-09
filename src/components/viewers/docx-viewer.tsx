'use client'

import * as React from 'react'
import { renderAsync } from 'docx-preview'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FullscreenButton } from '@/components/fullscreen-button'
import { useFullscreen } from '@/lib/use-fullscreen'
import { cn } from '@/lib/utils'
import type { LoadedFile } from '@/lib/viewers/types'

interface ViewerProps {
  file: LoadedFile
}

export function DocxViewer({ file }: ViewerProps) {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [hasDeviations, setHasDeviations] = React.useState(false)
  const [isEmpty, setIsEmpty] = React.useState(false)
  const [numPages, setNumPages] = React.useState(0)
  const [currentPage, setCurrentPage] = React.useState(1)
  const [gotoValue, setGotoValue] = React.useState('')

  const rootRef = React.useRef<HTMLDivElement>(null)
  const hostRef = React.useRef<HTMLDivElement>(null)
  const ratiosRef = React.useRef<Map<number, number>>(new Map())

  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(rootRef)

  // ---- Render the .docx into the host container via docx-preview ----
  React.useEffect(() => {
    let isCancelled = false

    setLoading(true)
    setError(null)
    setHasDeviations(false)
    setIsEmpty(false)
    setNumPages(0)
    setCurrentPage(1)
    setGotoValue('')
    ratiosRef.current.clear()

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
        sections.forEach((s, i) =>
          s.setAttribute('data-page-number', String(i + 1)),
        )

        const text = (host.textContent ?? '').trim()
        const hasImages = host.querySelectorAll('img').length > 0

        setNumPages(count)
        setIsEmpty(count === 0 || (text === '' && !hasImages))
        setHasDeviations(warned)
        setCurrentPage(1)
        setLoading(false)
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
  }, [file.id, file.arrayBuffer])

  // ---- IntersectionObserver: track the most-visible page section ----
  React.useEffect(() => {
    if (loading || error || numPages === 0) return
    const root = rootRef.current
    const host = hostRef.current
    if (!root || !host) return

    const sections = Array.from(
      host.querySelectorAll<HTMLElement>('.docx-wrapper > section.docx'),
    )
    if (sections.length === 0) return

    ratiosRef.current.clear()

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
    return () => observer.disconnect()
  }, [loading, error, numPages])

  // ---- Page navigation helpers ----
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

  const goToPrev = React.useCallback(() => {
    const n = Math.max(1, currentPage - 1)
    if (n !== currentPage) scrollToPage(n)
  }, [currentPage, scrollToPage])

  const goToNext = React.useCallback(() => {
    const n = Math.min(numPages, currentPage + 1)
    if (n !== currentPage) scrollToPage(n)
  }, [currentPage, numPages, scrollToPage])

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

  const showPagedNav = numPages > 1

  return (
    <div
      ref={rootRef}
      className={cn('dv-scroll h-full overflow-auto bg-background')}
    >
      {/* Toolbar (sticky) */}
      <div className="sticky top-0 z-10 bg-card/90 backdrop-blur border-b border-border flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <FileText className="size-3.5" />
          DOCX
        </span>
        <span
          className="text-xs text-muted-foreground truncate max-w-[24ch] sm:max-w-[40ch]"
          title={file.name}
        >
          {file.name}
        </span>

        {showPagedNav && (
          <div className="flex-1 flex justify-center px-1">
            <div className="flex items-center gap-1.5 text-sm">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                onClick={goToPrev}
                disabled={currentPage <= 1}
                aria-label="Предыдущая страница"
                title="Предыдущая страница"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-muted-foreground tabular-nums whitespace-nowrap text-xs sm:text-sm">
                Страница{' '}
                <span className="text-foreground font-medium">
                  {currentPage}
                </span>{' '}
                из {numPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                onClick={goToNext}
                disabled={currentPage >= numPages}
                aria-label="Следующая страница"
                title="Следующая страница"
              >
                <ChevronRight className="size-4" />
              </Button>
              <form
                onSubmit={handleGoto}
                className="flex items-center gap-1.5 ml-1.5"
              >
                <Input
                  type="number"
                  min={1}
                  max={numPages}
                  value={gotoValue}
                  onChange={(e) => setGotoValue(e.target.value)}
                  placeholder="№"
                  disabled={loading}
                  className="h-8 w-14 tabular-nums"
                  aria-label="Перейти на страницу"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={loading || !gotoValue}
                >
                  <span className="hidden sm:inline">Перейти</span>
                  <span className="sm:hidden">→</span>
                </Button>
              </form>
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {hasDeviations && (
            <span
              className="dv-deviation-badge"
              title="При рендере docx-preview выдал предупреждения. Подробности — в консоли браузера."
            >
              <AlertTriangle className="size-3" />
              Документ отрендерен с возможными отклонениями
            </span>
          )}
          <FullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
          />
        </div>
      </div>

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

      {/* docx-preview injects .docx-wrapper > section.docx pages here. */}
      <div ref={hostRef} className={cn('dv-docx-host2')} />
    </div>
  )
}
