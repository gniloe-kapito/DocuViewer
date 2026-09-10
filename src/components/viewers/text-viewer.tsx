'use client'

import * as React from 'react'
import { Copy, FileText, Hash, Moon, Sun, WrapText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ShellSearch, ViewerShell } from '@/components/viewer-shell'
import { useViewerUiStore } from '@/lib/viewer-ui-store'
import { exportElementToPdf, pdfFilename } from '@/lib/export-pdf'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { LoadedFile } from '@/lib/viewers/types'

interface ViewerProps {
  file: LoadedFile
}

/**
 * Resolves the textual content of a loaded file.
 * For text/markdown categories `file-utils.ts` already decoded UTF-8
 * into `textContent`; we fall back to decoding the raw `arrayBuffer`
 * if for some reason that field is missing.
 */
function getText(file: LoadedFile): string {
  if (typeof file.textContent === 'string') return file.textContent
  try {
    return new TextDecoder('utf-8').decode(file.arrayBuffer)
  } catch {
    return ''
  }
}

/** One search hit: `start`/`end` are character offsets within `linesArray[line]`. */
interface TextMatch {
  line: number
  start: number
  end: number
}

/** Escapes regex metacharacters so the query is matched literally. */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/* Zoom: 0.5–2, step 0.1. Applied via the CSS `zoom` property, which affects
 * layout, so the scroll container grows/shrinks with the content. */
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const clampZoom = (z: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 10) / 10))

export function TextViewer({ file }: ViewerProps) {
  const text = React.useMemo(() => getText(file), [file])

  const [wrap, setWrap] = React.useState(true)
  const [showLineNumbers, setShowLineNumbers] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)

  // «Night mode» — the shared, persisted global flag (see viewer-ui-store).
  // The marker class lands on the inner content root (printRootRef — inside
  // the zoom wrapper); the CSS inverts the <pre> / the line-numbered
  // container, so the scroll container and its scrollbars stay natural.
  // The class is dropped while exporting so the html2canvas capture keeps
  // natural colours; print clones strip it via buildPrintClone.
  const nightMode = useViewerUiStore((s) => s.nightMode)
  const toggleNightMode = useViewerUiStore((s) => s.toggleNightMode)
  /** While true the night-mode marker (and only it) is suppressed so the
   *  PDF screenshot export captures natural colours. */
  const [exporting, setExporting] = React.useState(false)

  // ---- Search (case-insensitive, live) ----
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  /** Bumped on every explicit navigation (submit / prev / next) so the
   * scroll-into-view effect re-runs even when the index itself is unchanged. */
  const [navTick, setNavTick] = React.useState(0)
  /** Query as of the last submit — Enter with an unchanged query advances to
   * the next match instead of restarting from the first one. */
  const lastSubmittedRef = React.useRef('')
  /** Hosts the line/row element of the active match (callback ref, attached
   * only to the active line). */
  const activeLineElRef = React.useRef<HTMLElement | null>(null)
  const activeLineRefCb = React.useCallback((el: HTMLElement | null) => {
    activeLineElRef.current = el
  }, [])

  // Reset search state when the file changes (same deps pattern as the zoom
  // reset effect in the other viewers).
  React.useEffect(() => {
    setQuery('')
    setActiveIndex(0)
    setNavTick(0)
    lastSubmittedRef.current = ''
  }, [file.id, file.arrayBuffer])

  // Points at the inner content root (pre / numbered lines) — deliberately
  // NOT the zoom wrapper, so the print clone is not zoomed.
  const printRootRef = React.useRef<HTMLDivElement>(null)

  /** «Скачать как PDF» — mirrors the shell's default export path (the print
   *  root is captured as one element), plus the night-mode guard: the
   *  inversion class is dropped for the capture (html2canvas-pro re-renders
   *  CSS `filter`, so the exported PDF would otherwise be inverted) and
   *  restored right after. */
  const handleExportPdf = React.useCallback(async () => {
    const root = printRootRef.current
    if (!root) return
    setExporting(true)
    const toastId = toast.loading('Готовим PDF…')
    try {
      // Let React flush the marker-less render before the capture.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      await exportElementToPdf(root, file.name)
      toast.success(`PDF сохранён: ${pdfFilename(file.name)}`, {
        id: toastId,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Не удалось создать PDF', { description: msg, id: toastId })
    } finally {
      setExporting(false)
    }
  }, [file.name])

  // ---- Stats: lines / words / characters ----
  const stats = React.useMemo(() => {
    if (text.length === 0) {
      return { lines: 0, words: 0, chars: 0 }
    }
    const lines = text.split('\n').length
    const words = text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0).length
    return { lines, words, chars: text.length }
  }, [text])

  // ---- Line-by-line breakdown for the line-number gutter ----
  const linesArray = React.useMemo(() => text.split('\n'), [text])

  // ---- Search matches: flat ordered list of all occurrences ----
  // One pass over the RAW lines using a case-insensitive literal regex
  // (unlike toLowerCase()+indexOf the 'i' flag never changes string length,
  // so `start`/`end` are always valid for String.slice). Non-overlapping hits.
  const matches = React.useMemo<TextMatch[]>(() => {
    if (!query) return []
    let re: RegExp
    try {
      re = new RegExp(escapeRegExp(query), 'gi')
    } catch {
      return []
    }
    const result: TextMatch[] = []
    for (let li = 0; li < linesArray.length; li++) {
      const line = linesArray[li]
      if (!line) continue
      re.lastIndex = 0
      for (let m = re.exec(line); m !== null; m = re.exec(line)) {
        result.push({ line: li, start: m.index, end: m.index + m[0].length })
      }
    }
    return result
  }, [linesArray, query])

  const total = matches.length
  // Clamp so query edits that shrink the match list keep the index valid.
  const activeIdx = total > 0 ? Math.min(activeIndex, total - 1) : 0
  const activeMatch = total > 0 ? matches[activeIdx] : null
  const activeLineIndex = activeMatch ? activeMatch.line : -1

  // lineIndex → matches on that line (same objects as `matches`, so identity
  // comparison identifies the active mark).
  const matchesByLine = React.useMemo(() => {
    if (matches.length === 0) return null
    const map = new Map<number, TextMatch[]>()
    for (const m of matches) {
      const arr = map.get(m.line)
      if (arr) arr.push(m)
      else map.set(m.line, [m])
    }
    return map
  }, [matches])

  // Scroll the active match's line into view after explicit navigation
  // (submit / prev / next) and after the rendering mode switches (the line
  // element is re-created). Typing never moves the viewport.
  React.useEffect(() => {
    activeLineElRef.current?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    })
  }, [navTick, showLineNumbers])

  const handleSubmit = React.useCallback(() => {
    if (total === 0) return
    if (lastSubmittedRef.current === query) {
      setActiveIndex((activeIdx + 1) % total)
    } else {
      lastSubmittedRef.current = query
      setActiveIndex(0)
    }
    setNavTick((t) => t + 1)
  }, [activeIdx, query, total])

  const goNext = React.useCallback(() => {
    if (total === 0) return
    setActiveIndex((activeIdx + 1) % total)
    setNavTick((t) => t + 1)
  }, [activeIdx, total])

  const goPrev = React.useCallback(() => {
    if (total === 0) return
    setActiveIndex((activeIdx - 1 + total) % total)
    setNavTick((t) => t + 1)
  }, [activeIdx, total])

  const handleClear = React.useCallback(() => {
    setQuery('')
    setActiveIndex(0)
    lastSubmittedRef.current = ''
  }, [])

  // ---- Clipboard copy ----
  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Текст скопирован в буфер обмена')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Не удалось скопировать текст')
    }
  }, [text])

  const zoomIn = () => setZoom((z) => clampZoom(z + 0.1))
  const zoomOut = () => setZoom((z) => clampZoom(z - 0.1))
  const resetZoom = () => setZoom(1)

  // ---- Empty file ----
  if (!text) {
    return (
      <ViewerShell file={file} category="text">
        <div className="dv-scroll h-full flex-1 overflow-auto">
          <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
            <FileText className="size-10 text-muted-foreground" />
            <h3 className="text-lg font-semibold">Файл пустой</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Файл{' '}
              <span className="break-all font-mono">{file.name}</span> не содержит
              текста.
            </p>
          </div>
        </div>
      </ViewerShell>
    )
  }

  const contentClass = cn(
    'm-0 font-mono text-[13px] leading-[1.55]',
    wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
  )

  /** Renders one line, wrapping query matches into <mark> highlights.
   * Returns the plain string when the line has no matches (zero-overhead
   * path — only lines with hits get segmented). */
  const renderLine = (lineIndex: number): React.ReactNode => {
    const line = linesArray[lineIndex]
    const lineMatches = matchesByLine?.get(lineIndex)
    if (!lineMatches || lineMatches.length === 0) return line
    const parts: React.ReactNode[] = []
    let pos = 0
    lineMatches.forEach((m, k) => {
      if (m.start > pos) parts.push(line.slice(pos, m.start))
      parts.push(
        <mark
          key={k}
          className={m === activeMatch ? 'dv-hl dv-hl-active' : 'dv-hl'}
        >
          {line.slice(m.start, m.end)}
        </mark>,
      )
      pos = m.end
    })
    if (pos < line.length) parts.push(line.slice(pos))
    return parts
  }

  return (
    <ViewerShell
      file={file}
      category="text"
      zoom={{
        value: Math.round(zoom * 100),
        min: 50,
        max: 200,
        onZoomIn: zoomIn,
        onZoomOut: zoomOut,
        onReset: resetZoom,
        isReset: zoom === 1,
      }}
      printRootRef={printRootRef}
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
      centerExtra={
        /* Layout note: the shell's centre cell is `min-w-max`, so this group
         * must keep a bounded max-content (rem-capped) — otherwise the toolbar
         * would overflow the shell into the metadata panel. The search gets
         * its own full-width row (the form is flex-basis-0 and needs real
         * free space), stats + toggles wrap below it. Caps: 28rem from md
         * (fits next to the metadata panel), 43rem from xl (single
         * stats/buttons row). */
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
              placeholder="Поиск по тексту…"
              label="Поиск по тексту"
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
              <span>
                <span className="font-semibold text-foreground">{stats.lines}</span>{' '}
                строк
              </span>
              <span aria-hidden className="text-border">·</span>
              <span>
                <span className="font-semibold text-foreground">{stats.words}</span>{' '}
                слов
              </span>
              <span aria-hidden className="text-border">·</span>
              <span>
                <span className="font-semibold text-foreground">{stats.chars}</span>{' '}
                символов
              </span>
            </div>

            <Button
              type="button"
              size="sm"
              variant={wrap ? 'secondary' : 'ghost'}
              onClick={() => setWrap((w) => !w)}
              aria-pressed={wrap}
              title={wrap ? 'Выключить перенос строк' : 'Включить перенос строк'}
            >
              <WrapText className={cn('size-4', !wrap && 'opacity-60')} />
              <span className="hidden sm:inline">
                {wrap ? 'Перенос' : 'Без переноса'}
              </span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant={showLineNumbers ? 'secondary' : 'ghost'}
              onClick={() => setShowLineNumbers((v) => !v)}
              aria-pressed={showLineNumbers}
              title={
                showLineNumbers ? 'Скрыть номера строк' : 'Показать номера строк'
              }
            >
              <Hash className="size-4" />
              <span className="hidden sm:inline">
                {showLineNumbers ? 'С номерами' : 'Без номеров'}
              </span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleCopy}
              title="Скопировать текст в буфер обмена"
              aria-label="Скопировать текст"
            >
              <Copy className="size-4" />
              <span className="hidden sm:inline">
                {copied ? 'Скопировано' : 'Скопировать'}
              </span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="dv-scroll h-full flex-1 overflow-auto">
        {/* CSS `zoom` scales the laid-out content, so the scroll area
            (and line-number gutter) grows/shrinks accordingly. */}
        <div style={{ zoom }}>
          <div
            ref={printRootRef}
            className={cn(nightMode && !exporting && 'dv-night')}
          >
            {showLineNumbers ? (
              <div
                className={cn(
                  'dv-lines font-mono text-[13px] leading-[1.55]',
                  !wrap && 'min-w-max',
                )}
                role="presentation"
              >
                {linesArray.map((_, i) => (
                  <div
                    key={i}
                    className="flex"
                    ref={i === activeLineIndex ? activeLineRefCb : undefined}
                  >
                    <span
                      aria-hidden
                      className="select-none w-12 shrink-0 border-r border-border bg-muted/40 px-2 text-right text-muted-foreground tabular-nums"
                    >
                      {i + 1}
                    </span>
                    <span
                      className={cn(
                        'px-3',
                        wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
                      )}
                    >
                      {renderLine(i)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              matchesByLine ? (
                /* Segmented rendering: only lines with hits become <span>s
                 * (the active line's span carries the scroll ref); all other
                 * lines stay plain strings + '\n' text nodes — visually
                 * identical to the single text node below. */
                <pre className={cn(contentClass, 'px-4 py-3')}>
                  {linesArray.map((_, i) => (
                    <React.Fragment key={i}>
                      {matchesByLine.has(i) ? (
                        <span
                          ref={i === activeLineIndex ? activeLineRefCb : undefined}
                        >
                          {renderLine(i)}
                        </span>
                      ) : (
                        linesArray[i]
                      )}
                      {i < linesArray.length - 1 ? '\n' : null}
                    </React.Fragment>
                  ))}
                </pre>
              ) : (
                <pre className={cn(contentClass, 'px-4 py-3')}>{text}</pre>
              )
            )}
          </div>
        </div>
      </div>
    </ViewerShell>
  )
}

/* recompile-note: clear stale module state */
