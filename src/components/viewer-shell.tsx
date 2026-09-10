'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Braces,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileType2,
  ImageIcon,
  Keyboard,
  Loader2,
  PanelRight,
  Presentation,
  Printer,
  RotateCcw,
  RotateCw,
  Search,
  StretchHorizontal,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { FullscreenButton } from '@/components/fullscreen-button'
import { useFullscreen } from '@/lib/use-fullscreen'
import { useViewerUiStore } from '@/lib/viewer-ui-store'
import { exportElementToPdf } from '@/lib/export-pdf'
import { cn } from '@/lib/utils'
import type { FileCategory, LoadedFile } from '@/lib/viewers/types'

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface ShellZoom {
  /** Current zoom percentage (e.g. 120 for 120%). */
  value: number
  min: number
  max: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  /** true when at the default/reset zoom (disables the reset buttons). */
  isReset: boolean
  /** Optional "fit to width" action — renders a dedicated toolbar button
   *  (viewers whose zoom can scale pages to the container width). */
  onFitWidth?: () => void
  /** true while the zoom is locked to the container width (button active). */
  isFit?: boolean
}

export interface ShellPageNav {
  /** 1-based current page / slide number. */
  page: number
  total: number
  onGoToPage: (page: number) => void
  /** Word used in the aria labels, e.g. "страница" or "слайд". */
  unit?: string
}

export interface ShellRotate {
  onRotateLeft?: () => void
  onRotateRight?: () => void
  disabled?: boolean
}

/**
 * Unified search control for the viewer toolbar centre (PDF / TXT / DOCX…).
 * Controlled input + submit + optional results navigation. Matches use the
 * `.dv-hl` / `.dv-hl-active` highlight classes (see globals.css).
 */
export interface ShellSearchProps {
  /** Current query string (controlled input). */
  value: string
  onChange: (value: string) => void
  /** Run the search (form submit / Enter in the input). */
  onSubmit: () => void
  /** Navigate to the previous match (rendered when total > 0). */
  onPrev?: () => void
  /** Navigate to the next match. */
  onNext?: () => void
  /** Clear the search (X button / Escape in the input). */
  onClear?: () => void
  /** Total number of matches — controls the results UI. */
  total?: number
  /** 0-based index of the active match (displayed as index + 1). */
  activeIndex?: number
  /** Search in progress (spinner inside the submit button). */
  busy?: boolean
  /** Disables all controls (e.g. document still loading). */
  disabled?: boolean
  placeholder?: string
  /** Accessible label for the input. */
  label?: string
}

export function ShellSearch({
  value,
  onChange,
  onSubmit,
  onPrev,
  onNext,
  onClear,
  total,
  activeIndex,
  busy,
  disabled,
  placeholder,
  label,
}: ShellSearchProps) {
  const hasResults = total != null && total > 0
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  /* Global search shortcuts. Multi-shell guard (compare mode): when two
   * viewer shells are mounted, only the first shell's search input is
   * focused by Ctrl+F, and only it reacts to F3 — the second pane's
   * listener stays silent (its input remains reachable by click).
   * Ctrl/Cmd+F focuses the input (preventDefault so the browser find bar
   * never opens), F3 / Shift+F3 jump between matches. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || busy) return
      // Multi-shell guard (compare mode): when two viewer shells are
      // mounted, only the FIRST one in DOM order owns the global shortcuts —
      // otherwise every key (zoom/rotate/fullscreen/arrows) would act on
      // BOTH panes at once.
      if (
        inputRef.current &&
        document.querySelectorAll('[data-viewer-shell]').length > 1 &&
        inputRef.current.closest('[data-viewer-shell]') !==
          document.querySelector('[data-viewer-shell]')
      ) {
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        return
      }
      if (e.key === 'F3' && hasResults) {
        e.preventDefault()
        if (e.shiftKey) onPrev?.()
        else onNext?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [disabled, busy, hasResults, onPrev, onNext])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!disabled && !busy) onSubmit()
      }}
      className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5"
      role="search"
      aria-label={label ?? 'Поиск по документу'}
    >
      <div className="relative min-w-0 flex-1 basis-[9rem] sm:flex-none">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title="Ctrl+F — фокус · F3 / Shift+F3 — совпадения · Esc — очистить"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && onClear) {
              e.preventDefault()
              onClear()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          placeholder={placeholder ?? 'Поиск по тексту…'}
          disabled={disabled || busy}
          className="h-8 w-full min-w-0 pl-8 sm:w-56 sm:flex-none"
          aria-label={label ?? 'Поиск по тексту'}
        />
      </div>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={disabled || busy || !value.trim()}
        aria-label="Найти"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            <Search className="size-4 sm:hidden" />
            <span className="hidden sm:inline">Найти</span>
          </>
        )}
      </Button>
      {hasResults && (
        <>
          <span
            className="text-xs text-muted-foreground tabular-nums whitespace-nowrap"
            aria-live="polite"
          >
            {(activeIndex ?? 0) + 1}/{total}
          </span>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8"
            onClick={onPrev}
            disabled={!onPrev || total === 1}
            aria-label="Предыдущее совпадение"
            title="Предыдущее совпадение"
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8"
            onClick={onNext}
            disabled={!onNext || total === 1}
            aria-label="Следующее совпадение"
            title="Следующее совпадение"
          >
            <ChevronDown className="size-4" />
          </Button>
          {onClear && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={onClear}
              aria-label="Очистить поиск"
              title="Очистить поиск (Esc)"
            >
              <X className="size-4" />
            </Button>
          )}
        </>
      )}
    </form>
  )
}


export interface ViewerShellProps {
  file: LoadedFile
  category: FileCategory
  /** Disables toolbar controls (e.g. while the document is loading). */
  busy?: boolean

  /* ---- toolbar: centre controls ---- */
  zoom?: ShellZoom
  rotate?: ShellRotate
  pageNav?: ShellPageNav
  /** Format-specific extras rendered after the standard centre controls. */
  centerExtra?: React.ReactNode

  /* ---- toolbar: right side ---- */
  /** Extra items before the standard right-side buttons (badges, etc.). */
  toolbarEnd?: React.ReactNode
  /**
   * 'screenshot' → "Скачать как PDF" (html2canvas + jsPDF, client-side).
   * 'original'   → "Скачать" (download the source file as-is).
   * Omit the prop entirely to hide the download button.
   */
  download?: { mode: 'screenshot' | 'original' }
  /**
   * Fully custom export flow (e.g. PPTX re-renders each slide before
   * capturing). When provided it replaces the default behaviour.
   */
  onExportPdf?: () => Promise<void>

  /* ---- left thumbnails sidebar ---- */
  /** Sidebar content; omit to render no sidebar at all. */
  thumbs?: React.ReactNode
  thumbsLabel?: string

  /* ---- fullscreen / print ---- */
  /** Fullscreen target; defaults to the shell root itself. */
  fullscreenRef?: React.RefObject<HTMLElement | null>
  /**
   * Element printed by the print button. Should point at the *content*
   * root (pages host, table, text body) — NOT a `h-full` scroll container.
   * Defaults to the shell body.
   */
  printRootRef?: React.RefObject<HTMLElement | null>
  /**
   * Optional pre-print hook, awaited (busy-guarded) BEFORE the print clone
   * is built. Virtualized viewers (PDF with windowed rendering) use it to
   * render every page first — the clone snapshots the live canvases, so
   * un-rendered pages would print blank. Optional: viewers without canvas
   * virtualization are unaffected.
   */
  onBeforePrint?: () => void | Promise<void>
  /** Root scanned for `[data-dv-page]` elements during PDF export. */
  exportRootRef?: React.RefObject<HTMLElement | null>

  /* ---- layout ---- */
  bodyClassName?: string
  className?: string
  children: React.ReactNode
}

/* ------------------------------------------------------------------ */
/*  Format iconography                                                */
/* ------------------------------------------------------------------ */

interface FormatVisual {
  icon: LucideIcon
  ext: string
  badge: string
}

const FORMAT_VISUALS: Partial<Record<FileCategory, FormatVisual>> = {
  pdf: {
    icon: FileText,
    ext: 'PDF',
    badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30',
  },
  docx: {
    icon: FileType2,
    ext: 'DOCX',
    badge:
      'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  },
  xlsx: {
    icon: FileSpreadsheet,
    ext: 'XLSX',
    badge:
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
  pptx: {
    icon: Presentation,
    ext: 'PPTX',
    badge:
      'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  },
  image: {
    icon: ImageIcon,
    ext: 'IMG',
    badge:
      'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
  },
  json: {
    icon: Braces,
    ext: 'JSON',
    badge:
      'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  markdown: {
    icon: FileCode,
    ext: 'MD',
    badge:
      'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  },
  text: {
    icon: FileText,
    ext: 'TXT',
    badge:
      'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30',
  },
  rtf: {
    icon: FileType2,
    ext: 'RTF',
    badge:
      'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30',
  },
}

/* ------------------------------------------------------------------ */
/*  Keyboard shortcuts                                                 */
/* ------------------------------------------------------------------ */

interface ShortcutRow {
  keys: string[]
  label: string
}

const ZOOM_SHORTCUTS: ShortcutRow[] = [
  { keys: ['+'], label: 'Увеличить масштаб' },
  { keys: ['−'], label: 'Уменьшить масштаб' },
  { keys: ['0'], label: 'Сбросить масштаб' },
  { keys: ['Ctrl', 'Колесо'], label: 'Масштаб колесом мыши' },
]

const PAGES_SHORTCUTS: ShortcutRow[] = [
  { keys: ['←'], label: 'Предыдущая страница' },
  { keys: ['→'], label: 'Следующая страница' },
  { keys: ['Home'], label: 'Первая страница' },
  { keys: ['End'], label: 'Последняя страница' },
]

const ALWAYS_SHORTCUTS: ShortcutRow[] = [
  { keys: ['Ctrl', 'P'], label: 'Печать документа' },
  { keys: ['F'], label: 'Полноэкранный режим' },
  { keys: ['N'], label: 'Ночной режим (инверсия цветов)' },
  { keys: ['Ctrl', 'O'], label: 'Открыть ещё файл' },
  { keys: ['Ctrl', 'V'], label: 'Вставить файл из буфера' },
]

/**
 * True when the user is currently "typing" somewhere — global shortcuts
 * must not fire then (typing "+", "f", "0"… in an input must stay literal).
 */
function isTypingContext(): boolean {
  const el = document.activeElement
  if (!el || el === document.body) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  )
}

/**
 * Some content areas handle arrows themselves (e.g. the PPTX slide area is
 * focusable and navigates slides on ←/→/Space). They opt out of the global
 * arrow handling with `data-dv-local-keys` so keys are not processed twice.
 */
function hasLocalKeyHandling(): boolean {
  const el = document.activeElement
  if (!el || el === document.body) return false
  return (el as HTMLElement).closest?.('[data-dv-local-keys]') != null
}

/* ------------------------------------------------------------------ */
/*  Small toolbar control groups                                      */
/* ------------------------------------------------------------------ */

function ZoomControl({ zoom, busy }: { zoom: ShellZoom; busy?: boolean }) {
  return (
    <div
      className="flex items-center gap-0.5 sm:gap-1"
      role="group"
      aria-label="Масштаб"
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        onClick={zoom.onZoomOut}
        disabled={busy || zoom.value <= zoom.min}
        aria-label="Уменьшить"
        title="Уменьшить (клавиша −)"
      >
        <ZoomOut className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-w-[3.25rem] tabular-nums"
        onClick={zoom.onReset}
        disabled={busy || zoom.isReset}
        title="Сбросить масштаб (клавиша 0)"
        aria-label={`Масштаб ${Math.round(zoom.value)} процентов, сбросить`}
        aria-keyshortcuts="0"
      >
        {Math.round(zoom.value)}%
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        onClick={zoom.onZoomIn}
        disabled={busy || zoom.value >= zoom.max}
        aria-label="Увеличить"
        title="Увеличить (клавиша +)"
      >
        <ZoomIn className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={zoom.onReset}
        disabled={busy || zoom.isReset}
        aria-label="Сбросить масштаб"
        title="Сбросить масштаб (клавиша 0)"
      >
        <RotateCcw className="size-3.5" />
      </Button>
      {zoom.onFitWidth && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'size-8',
            zoom.isFit &&
              'bg-accent/70 text-accent-foreground hover:bg-accent',
          )}
          onClick={zoom.onFitWidth}
          disabled={busy}
          aria-pressed={zoom.isFit ?? false}
          aria-label="Масштаб по ширине окна"
          title="Масштаб по ширине окна (клавиша F)"
          aria-keyshortcuts="F"
        >
          <StretchHorizontal className="size-4" />
        </Button>
      )}
    </div>
  )
}

function RotateControl({
  rotate,
  busy,
}: {
  rotate: ShellRotate
  busy?: boolean
}) {
  const buttons: Array<{
    label: string
    icon: LucideIcon
    onClick?: () => void
  }> = [
    { label: 'Повернуть влево на 90°', icon: RotateCcw, onClick: rotate.onRotateLeft },
    { label: 'Повернуть вправо на 90°', icon: RotateCw, onClick: rotate.onRotateRight },
  ]
  return (
    <div
      className="flex items-center gap-0.5 sm:gap-1"
      role="group"
      aria-label="Поворот"
    >
      {buttons.map(
        (b) =>
          b.onClick && (
            <Button
              key={b.label}
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              onClick={b.onClick}
              disabled={busy || rotate.disabled}
              aria-label={b.label}
              title={b.label}
            >
              <b.icon className="size-4" />
            </Button>
          ),
      )}
    </div>
  )
}

function PageNavControl({
  nav,
  busy,
}: {
  nav: ShellPageNav
  busy?: boolean
}) {
  const unit = nav.unit ?? 'страница'
  // Local editing value: null → the input mirrors the current page.
  const [editing, setEditing] = React.useState<string | null>(null)

  const display = editing ?? String(nav.page)

  const commit = () => {
    if (editing !== null && editing.trim() !== '') {
      const n = parseInt(editing, 10)
      if (Number.isFinite(n)) {
        const clamped = Math.max(1, Math.min(nav.total, n))
        nav.onGoToPage(clamped)
      }
    }
    setEditing(null)
  }

  return (
    <div
      className="flex items-center gap-0.5 sm:gap-1"
      role="group"
      aria-label={`Навигация: ${unit}`}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => nav.onGoToPage(Math.max(1, nav.page - 1))}
        disabled={busy || nav.page <= 1}
        aria-label="Предыдущая страница"
        title="Предыдущая страница (←)"
        aria-keyshortcuts="ArrowLeft"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Input
        type="number"
        min={1}
        max={nav.total}
        value={display}
        onChange={(e) => setEditing(e.target.value)}
        onFocus={(e) => {
          setEditing(String(nav.page))
          e.target.select()
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            setEditing(null)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        disabled={busy || nav.total <= 1}
        className="h-8 w-11 sm:w-14 tabular-nums text-center"
        aria-label={`Текущая ${unit}, введите номер для перехода`}
        inputMode="numeric"
      />
      <span
        className="text-xs sm:text-sm text-muted-foreground tabular-nums whitespace-nowrap select-none"
        aria-live="polite"
      >
        / {nav.total}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-8"
        onClick={() => nav.onGoToPage(Math.min(nav.total, nav.page + 1))}
        disabled={busy || nav.page >= nav.total}
        aria-label="Следующая страница"
        title="Следующая страница (→)"
        aria-keyshortcuts="ArrowRight"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}

/** Small keyboard hint rendered inside the shortcuts popover. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground shadow-[inset_0_-1px_0_0_color-mix(in_oklch,var(--muted-foreground)_25%,transparent)]">
      {children}
    </kbd>
  )
}

function ShortcutsList({ rows }: { rows: ShortcutRow[] }) {
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">{r.label}</span>
          <span className="flex items-center gap-1">
            {r.keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ */
/*  Print helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Clone a DOM subtree for printing. Canvas elements do not survive
 * cloneNode (their bitmap is not copied), so every canvas in the clone is
 * replaced with an <img> carrying the original's bitmap as a data URL.
 * Inline `zoom` styles (used by the XLSX viewer) are stripped so the
 * document always prints at its natural size.
 */
function buildPrintClone(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement
  const originals = Array.from(source.querySelectorAll('canvas'))
  const clones = Array.from(clone.querySelectorAll('canvas'))
  originals.forEach((canvas, i) => {
    const target = clones[i]
    if (!target) return
    try {
      const img = document.createElement('img')
      img.src = canvas.toDataURL('image/png')
      img.alt = ''
      img.className = target.className
      img.style.width = target.style.width || `${canvas.width}px`
      img.style.height = target.style.height || `${canvas.height}px`
      target.replaceWith(img)
    } catch {
      // Tainted canvas (cross-origin) — leave the empty canvas in place.
    }
  })
  // Strip inline CSS zoom (XLSX zoom) — print at natural size. The «night
  // mode» colour inversion is a screen-only comfort feature: clones drop it
  // so printed (and exported) documents keep their natural colours.
  clone.classList.remove('dv-night')
  clone
    .querySelectorAll('.dv-night')
    .forEach((el) => el.classList.remove('dv-night'))
  if (clone.style.zoom) clone.style.zoom = ''
  clone
    .querySelectorAll<HTMLElement>('[style*="zoom"]')
    .forEach((el) => {
      if (el.style.zoom) el.style.zoom = ''
    })
  return clone
}

/* ------------------------------------------------------------------ */
/*  ViewerShell                                                        */
/* ------------------------------------------------------------------ */

export function ViewerShell({
  file,
  category,
  busy,
  zoom,
  rotate,
  pageNav,
  centerExtra,
  toolbarEnd,
  download,
  onExportPdf,
  thumbs,
  thumbsLabel,
  fullscreenRef,
  printRootRef,
  onBeforePrint,
  exportRootRef,
  bodyClassName,
  className,
  children,
}: ViewerShellProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const bodyRef = React.useRef<HTMLDivElement | null>(null)
  const [exporting, setExporting] = React.useState(false)

  const metaPanelOpen = useViewerUiStore((s) => s.metaPanelOpen)
  const toggleMetaPanel = useViewerUiStore((s) => s.toggleMetaPanel)
  const thumbsOpen = useViewerUiStore((s) => s.thumbsOpen)
  const toggleThumbs = useViewerUiStore((s) => s.toggleThumbs)
  const toggleNightMode = useViewerUiStore((s) => s.toggleNightMode)

  const { isFullscreen, toggle: toggleFullscreen, supported } = useFullscreen(
    fullscreenRef ?? rootRef,
  )

  const visual = FORMAT_VISUALS[category] ?? {
    icon: FileText,
    ext: file.extension.toUpperCase(),
    badge: 'bg-muted text-muted-foreground border-border',
  }
  const FormatIcon = visual.icon

  /* ---- Print ---- */
  // Busy guard: a long print preparation (e.g. the PDF viewer rendering
  // every page of a large document) must not be started twice by Ctrl+P
  // spam / double clicks.
  const printPreparingRef = React.useRef(false)
  const handlePrint = React.useCallback(async () => {
    const source = printRootRef?.current ?? bodyRef.current
    if (!source) return
    // Optional viewer hook: virtualized viewers render all pages BEFORE the
    // clone is snapshotted (canvases outside the render window hold no
    // bitmap and would print blank). Failures abort the print with a toast.
    if (onBeforePrint) {
      if (printPreparingRef.current) return
      printPreparingRef.current = true
      try {
        await onBeforePrint()
      } catch (err) {
        toast.error('Не удалось подготовить документ к печати', {
          description: err instanceof Error ? err.message : undefined,
        })
        return
      } finally {
        printPreparingRef.current = false
      }
    }
    const holder = document.createElement('div')
    holder.className = 'dv-print-holder'
    holder.appendChild(buildPrintClone(source))
    document.body.appendChild(holder)
    document.body.classList.add('dv-print-mode')
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      document.body.classList.remove('dv-print-mode')
      holder.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    // Give the browser a moment to lay the print clone out.
    window.setTimeout(() => {
      try {
        window.print()
      } catch {
        toast.error('Не удалось открыть диалог печати')
      }
      // Fallback: some environments never fire afterprint.
      window.setTimeout(cleanup, 60_000)
    }, 60)
  }, [printRootRef, onBeforePrint])

  /* ---- Download / PDF export ---- */
  const downloadOriginal = React.useCallback(() => {
    const a = document.createElement('a')
    a.href = file.url
    a.download = file.name || 'file'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [file.url, file.name])

  const handleExportPdf = React.useCallback(async () => {
    if (download?.mode === 'original') {
      downloadOriginal()
      return
    }
    if (onExportPdf) {
      setExporting(true)
      try {
        await onExportPdf()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error('Не удалось создать PDF', { description: msg })
      } finally {
        setExporting(false)
      }
      return
    }
    const root = exportRootRef?.current ?? printRootRef?.current ?? bodyRef.current
    if (!root) return
    setExporting(true)
    const toastId = toast.loading('Готовим PDF…')
    try {
      await exportElementToPdf(root, file.name)
      toast.success(`PDF сохранён: ${file.name.replace(/\.[^.]+$/, '')}.pdf`, {
        id: toastId,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Не удалось создать PDF', { description: msg, id: toastId })
    } finally {
      setExporting(false)
    }
  }, [
    download?.mode,
    downloadOriginal,
    onExportPdf,
    exportRootRef,
    printRootRef,
    file.name,
  ])

  /* ---- Global keyboard shortcuts ---- */
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Multi-shell guard (compare mode): only the FIRST shell in DOM order
      // owns the global shortcuts — zoom/rotate/fullscreen/arrows/print must
      // not fire on BOTH panes at once. The second pane stays fully usable
      // through its own toolbar controls (clicks are per-pane).
      if (
        rootRef.current &&
        document.querySelectorAll('[data-viewer-shell]').length > 1 &&
        rootRef.current !== document.querySelector('[data-viewer-shell]')
      ) {
        return
      }
      // Ignore repeats (holding a key should not zoom in a hundred times).
      if (e.repeat) return
      // Never hijack browser shortcuts (Ctrl+R, Ctrl+T, Ctrl+L…), except P.
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() !== 'p') return
      if (e.altKey) return
      if (isTypingContext()) return

      // Ctrl+P → print the document (not the whole site chrome).
      if (ctrl && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        void handlePrint()
        return
      }

      // F → fullscreen
      if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        e.preventDefault()
        if (supported) toggleFullscreen()
        return
      }

      // N → night mode (screen-only colour inversion; the flag is global —
      // every open viewer flips at once, the toggle button in the toolbar
      // shows the same state). Russian layout: the N key position is «т».
      if (
        e.key === 'n' ||
        e.key === 'N' ||
        e.key === 'т' ||
        e.key === 'Т'
      ) {
        e.preventDefault()
        toggleNightMode()
        return
      }

      // Zoom keys
      if (zoom) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault()
          if (!busy && zoom.value < zoom.max) zoom.onZoomIn()
          return
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          if (!busy && zoom.value > zoom.min) zoom.onZoomOut()
          return
        }
        if (e.key === '0') {
          e.preventDefault()
          if (!busy && !zoom.isReset) zoom.onReset()
          return
        }
      }

      // Page navigation (arrows) — only when nothing else claims them.
      if (pageNav && !hasLocalKeyHandling()) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          if (!busy && pageNav.page > 1) pageNav.onGoToPage(pageNav.page - 1)
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          if (!busy && pageNav.page < pageNav.total)
            pageNav.onGoToPage(pageNav.page + 1)
          return
        }
        if (e.key === 'Home') {
          e.preventDefault()
          if (!busy && pageNav.page !== 1) pageNav.onGoToPage(1)
          return
        }
        if (e.key === 'End') {
          e.preventDefault()
          if (!busy && pageNav.page !== pageNav.total)
            pageNav.onGoToPage(pageNav.total)
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, zoom, pageNav, handlePrint, toggleFullscreen, supported, toggleNightMode])

  /* ---- Ctrl/⌘ + wheel zoom ----
   * A «viewer-native» behaviour (Adobe/browser-reader style): holding Ctrl
   * (or ⌘ — trackpad pinch synthesises ctrl+wheel too) while wheeling over
   * the shell zooms the document instead of the browser page. The listener
   * lives on THIS shell's root, so in compare mode each pane zooms only
   * itself (unlike the window-level keydown handler there is no cross-fire).
   * preventDefault runs even when zooming is busy/at-limit so the browser's
   * own page zoom never steals the gesture. Wheel events fire in bursts
   * (momentum scrolling) — throttle to one zoom step per ~120 ms. */
  const lastWheelZoomRef = React.useRef(0)
  React.useEffect(() => {
    const root = rootRef.current
    if (!root || !zoom) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      // Not passive: we must be able to cancel the browser's page zoom.
      e.preventDefault()
      if (busy || e.deltaY === 0) return
      const now = performance.now()
      if (now - lastWheelZoomRef.current < 120) return
      if (e.deltaY < 0) {
        if (zoom.value < zoom.max) {
          lastWheelZoomRef.current = now
          zoom.onZoomIn()
        }
      } else {
        if (zoom.value > zoom.min) {
          lastWheelZoomRef.current = now
          zoom.onZoomOut()
        }
      }
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [zoom, busy])

  /* Shortcuts shown in the help popover (only the relevant ones). */
  const shortcutGroups = React.useMemo(() => {
    const groups: Array<{ title: string; rows: ShortcutRow[] }> = [
      { title: 'Общие', rows: ALWAYS_SHORTCUTS },
    ]
    if (pageNav) {
      groups.push({ title: 'Навигация', rows: PAGES_SHORTCUTS })
    }
    if (zoom) {
      groups.push({ title: 'Масштаб', rows: ZOOM_SHORTCUTS })
    }
    return groups
  }, [pageNav, zoom])

  const showThumbsUi = thumbs != null

  return (
    <div
      ref={rootRef}
      data-viewer-shell=""
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden bg-card/40',
        className,
      )}
    >
      {/* ================= Toolbar ================= */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-card/95 px-2 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] backdrop-blur sm:px-3">
        {/* --- left: format, filename, metadata panel toggle --- */}
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <span
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center rounded-md border',
              visual.badge,
            )}
            title={visual.ext}
            aria-hidden="true"
          >
            <FormatIcon className="size-3.5" />
          </span>
          <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:inline">
            {visual.ext}
          </span>
          <span
            className="min-w-0 truncate text-xs font-medium sm:text-sm max-w-[16ch] sm:max-w-[26ch] lg:max-w-[34ch]"
            title={file.name}
          >
            {file.name}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 gap-1.5 px-2 transition-colors',
              metaPanelOpen &&
                'bg-accent/70 text-accent-foreground hover:bg-accent',
            )}
            onClick={toggleMetaPanel}
            aria-pressed={metaPanelOpen}
            title={
              metaPanelOpen
                ? 'Скрыть панель метаданных файла'
                : 'Показать панель метаданных файла'
            }
            aria-label={
              metaPanelOpen
                ? 'Скрыть панель метаданных файла'
                : 'Показать панель метаданных файла'
            }
          >
            <PanelRight
              className={cn(
                'size-4 transition-opacity',
                !metaPanelOpen && 'opacity-50',
              )}
            />
            <span className="hidden xl:inline">
              {metaPanelOpen ? 'Скрыть панель файла' : 'Показать панель файла'}
            </span>
          </Button>
        </div>

        {/* --- centre: zoom / rotate / page nav / extras ---
            Mobile: the group takes a full-width row of its own (basis-full)
            so every control stays reachable. From md up it joins the main
            row: min-w-max keeps it from shrinking below its content, so
            when space runs out the right group wraps to a second row
            instead of the controls overlapping each other. */}
        {(zoom || rotate || pageNav || centerExtra) && (
          <div className="order-3 flex basis-full flex-wrap items-center justify-center gap-1.5 py-0.5 sm:gap-2 md:order-none md:basis-0 md:grow md:min-w-max">
            {zoom && <ZoomControl zoom={zoom} busy={busy} />}
            {zoom && (rotate || pageNav) && (
              <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
            )}
            {rotate && <RotateControl rotate={rotate} busy={busy} />}
            {pageNav && <PageNavControl nav={pageNav} busy={busy} />}
            {centerExtra}
          </div>
        )}

        {/* --- right: shortcuts, download, print, fullscreen --- */}
        <div className="ml-auto flex items-center gap-1.5">
          {toolbarEnd}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hidden size-8 text-muted-foreground sm:inline-flex"
                aria-label="Горячие клавиши"
                title="Горячие клавиши"
              >
                <Keyboard className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Горячие клавиши
              </p>
              <div className="space-y-2.5">
                {shortcutGroups.map((g) => (
                  <div key={g.title}>
                    <p className="mb-1 text-[11px] font-medium text-foreground/70">
                      {g.title}
                    </p>
                    <ShortcutsList rows={g.rows} />
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {download && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleExportPdf}
              disabled={busy || exporting}
              title={
                download.mode === 'screenshot'
                  ? 'Скачать документ как PDF (клиентская конвертация)'
                  : 'Скачать оригинальный файл'
              }
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              <span className="hidden sm:inline">
                {download.mode === 'screenshot' ? 'Скачать как PDF' : 'Скачать'}
              </span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={handlePrint}
            title="Печать документа (Ctrl+P)"
            aria-label="Печать документа"
            aria-keyshortcuts="Control+P"
          >
            <Printer className="size-4" />
            <span className="hidden sm:inline">Печать</span>
          </Button>
          <FullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            disabled={!supported}
            className="h-8"
          />
        </div>
      </div>

      {/* ================= Content row ================= */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* --- left thumbnails sidebar --- */}
        {showThumbsUi && (
          <>
            <aside
              className={cn('dv-thumbs dv-scroll', !thumbsOpen && 'hidden')}
              aria-label={thumbsLabel ?? 'Миниатюры страниц'}
            >
              <div className="dv-thumbs-head">
                {thumbsLabel ?? 'Миниатюры'}
              </div>
              {thumbs}
            </aside>
            <button
              type="button"
              className="dv-thumbs-edge"
              onClick={toggleThumbs}
              aria-label={
                thumbsOpen ? 'Свернуть панель миниатюр' : 'Развернуть панель миниатюр'
              }
              aria-pressed={thumbsOpen}
              title={
                thumbsOpen ? 'Свернуть панель миниатюр' : 'Развернуть панель миниатюр'
              }
            >
              <ChevronLeft
                className={cn('size-3.5', !thumbsOpen && 'rotate-180')}
              />
            </button>
          </>
        )}

        {/* --- main document area --- */}
        <div
          ref={bodyRef}
          className={cn(
            'relative flex min-h-0 min-w-0 flex-1 flex-col',
            bodyClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
