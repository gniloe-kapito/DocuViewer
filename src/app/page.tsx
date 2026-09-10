'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Columns2,
  FileText,
  ShieldCheck,
  Github,
  Loader2,
  Info,
  UploadCloud,
  ArrowLeftRight,
  Link2,
  Link2Off,
  X,
} from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { DropZone } from '@/components/drop-zone'
import { DocumentTabs } from '@/components/document-tabs'
import { FileMetadata } from '@/components/file-metadata'
import { HistoryPanel } from '@/components/history-panel'
import { UrlLoadDialog } from '@/components/url-load-dialog'
import { ViewerFrame } from '@/components/viewer-frame'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  fileToLoadedFile,
  urlToLoadedFile,
  revokeLoadedFile,
} from '@/lib/file-utils'
import { useHistoryStore } from '@/lib/history'
import { setupViewerUiPrefs, useViewerUiStore } from '@/lib/viewer-ui-store'
import type { LoadedFile } from '@/lib/viewers/types'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  Compare mode: scroll-sync helper (module scope, pure DOM)          */
/* ------------------------------------------------------------------ */

/**
 * The MAIN vertical scroller of a compare pane. Every viewer renders its
 * document area as `.dv-scroll`; the left thumbnails sidebar (`.dv-thumbs`,
 * PDF/PPTX/XLSX) also carries the class but is a secondary navigation
 * column rendered BEFORE the content area — skipped. The first remaining
 * match is the pane's main content scroller.
 */
function getPaneScroller(pane: HTMLElement | null): HTMLElement | null {
  if (!pane) return null
  const candidates = pane.querySelectorAll<HTMLElement>('.dv-scroll')
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i]
    if (el.classList.contains('dv-thumbs')) continue
    return el
  }
  return null
}

export default function Home() {
  const [files, setFiles] = React.useState<LoadedFile[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)

  /* ---- Compare-two-files mode ----
   * Side-by-side split: the LEFT pane mirrors the active tab (clicking a
   * tab switches the left document), the RIGHT pane is chosen with a
   * select (defaults to the next open file). Global shortcuts belong to
   * the LEFT pane only (guard in viewer-shell.tsx — only the FIRST
   * [data-viewer-shell] in DOM order reacts). */
  const [compareMode, setCompareMode] = React.useState(false)
  const [rightId, setRightId] = React.useState<string | null>(null)
  // Synchronized (proportional) scrolling for same-format compare pairs —
  // see the scroll-sync effect below. Reset on entering/exiting compare and
  // whenever the pair stops being same-format (self-healing effect).
  const [syncScroll, setSyncScroll] = React.useState(false)
  const [processing, setProcessing] = React.useState(false)
  const [dragOverlay, setDragOverlay] = React.useState(false)

  /* ---- Closed-tabs restore stack (Ctrl+Shift+T) ----
   * A LIFO stack of recently closed tabs. The full LoadedFile object is kept
   * (its `arrayBuffer` stays referenced, so the restore is loss-free); the
   * revoked object URL is re-created from the buffer on restore. Capped so a
   * close-all spree cannot grow the stack unbounded; the oldest entries are
   * dropped first. `closedTop` mirrors the stack top into state for the tabs
   * menu item label; the stack itself is a ref so the close/restore handlers
   * stay referentially stable (they are used by keyboard effects). */
  const closedStackRef = React.useRef<
    Array<{ file: LoadedFile; index: number }>
  >([])
  const [closedTop, setClosedTop] = React.useState<string | null>(null)
  const CLOSED_STACK_MAX = 12

  const pushClosed = React.useCallback(
    (entries: Array<{ file: LoadedFile; index: number }>) => {
      if (entries.length === 0) return
      const stack = closedStackRef.current
      stack.push(...entries)
      if (stack.length > CLOSED_STACK_MAX) {
        closedStackRef.current = stack.slice(stack.length - CLOSED_STACK_MAX)
      }
      setClosedTop(
        closedStackRef.current[closedStackRef.current.length - 1]?.file.name ??
          null,
      )
    },
    [],
  )

  /** Restores the most recently closed tab (Ctrl+Shift+T / menu item / the
   * «Восстановить» action on the close toast). Re-creates the object URL
   * (the original was revoked at close time), re-inserts the file at its
   * original position (clamped to the current tab count) and focuses it. */
  const restoreClosedTab = React.useCallback(() => {
    const stack = closedStackRef.current
    const entry = stack.pop()
    if (!entry) {
      toast.info('Нет недавно закрытых вкладок')
      return
    }
    setClosedTop(stack.length > 0 ? stack[stack.length - 1].file.name : null)
    const { file, index } = entry
    // Re-create the object URL from the kept buffer (type fallback mirrors
    // fileToLoadedFile's own fallback).
    const blob = new Blob([file.arrayBuffer], {
      type: file.type || 'application/octet-stream',
    })
    const restored: LoadedFile = {
      ...file,
      url: URL.createObjectURL(blob),
    }
    setFiles((prev) => {
      // Safety: an id collision should be impossible (ids are unique per
      // load and the file was removed), but a guard is cheaper than a bug.
      if (prev.some((f) => f.id === file.id)) return prev
      const at = Math.min(index, prev.length)
      const next = [...prev]
      next.splice(at, 0, restored)
      return next
    })
    setActiveId(file.id)
    toast.success(`Восстановлена вкладка «${file.name}»`)
  }, [])

  // Right metadata-panel visibility lives in the GLOBAL viewer UI store so
  // that every viewer's toolbar toggle (ViewerShell) and this page agree on
  // the same state — identical behaviour for PDF/DOCX/XLSX/PPTX/…
  // The preferences are persisted to localStorage (setupViewerUiPrefs).
  const metaPanelOpen = useViewerUiStore((s) => s.metaPanelOpen)

  const historyAdd = useHistoryStore((s) => s.add)
  const historyLoad = useHistoryStore((s) => s.load)

  React.useEffect(() => {
    historyLoad()
  }, [historyLoad])

  // Load persisted viewer UI preferences once after hydration (meta panel /
  // thumbs sidebar visibility) and keep saving them on every change.
  React.useEffect(() => {
    setupViewerUiPrefs()
  }, [])

  const activeFile = React.useMemo(
    () => files.find((f) => f.id === activeId) ?? null,
    [files, activeId],
  )

  /* ---- Compare mode: derived state + self-healing ---- */
  /** The right pane's file — null when compare mode is off or impossible. */
  const rightFile = React.useMemo(
    () => files.find((f) => f.id === rightId) ?? null,
    [files, rightId],
  )
  /** True while both compare panes show the SAME file category — the only
   *  case where synchronized (proportional) scrolling is offered. */
  const sameFormatPair = React.useMemo(
    () =>
      compareMode &&
      activeFile != null &&
      rightFile != null &&
      activeFile.category === rightFile.category,
    [compareMode, activeFile, rightFile],
  )
  /** Auto-pick for the right pane: the open file AFTER the active one
   *  (wrapping) — never the active file itself. */
  const pickRight = React.useCallback(
    (current: LoadedFile[]) => {
      if (current.length < 2) return null
      const idx = current.findIndex((f) => f.id === activeId)
      if (idx === -1) return current[0].id === activeId ? current[1].id : current[0].id
      const next = current[(idx + 1) % current.length]
      return next.id === activeId ? null : next.id
    },
    [activeId],
  )
  // Files closed / added → repair the compare mode invariants: exit when
  // fewer than 2 files remain; re-pick the right pane when its file was
  // closed or became the same as the active (left) one.
  React.useEffect(() => {
    if (!compareMode) return
    if (files.length < 2) {
      setCompareMode(false)
      setRightId(null)
      return
    }
    if (!files.some((f) => f.id === rightId) || rightId === activeId) {
      setRightId(pickRight(files))
    }
  }, [files, compareMode, rightId, activeId, pickRight])
  // Entering compare mode → default the right pane.
  React.useEffect(() => {
    if (compareMode && rightId == null && files.length >= 2) {
      setRightId(pickRight(files))
    }
  }, [compareMode, rightId, files, pickRight])
  // Scroll-sync self-healing: the sync turns itself off whenever the pair
  // stops being same-format (file switched on either side) or compare mode
  // ends — same invariant-repair pattern as the pane effects above.
  React.useEffect(() => {
    if (syncScroll && !sameFormatPair) setSyncScroll(false)
  }, [syncScroll, sameFormatPair])
  /** Toggles compare mode (button in the tabs row; only with 2+ files). */
  const toggleCompareMode = React.useCallback(() => {
    setCompareMode((on) => {
      const next = !on
      if (next) {
        toast.info('Режим сравнения: два документа рядом')
      }
      return next
    })
    // Entering compare always starts fresh: scroll sync OFF (exit is also
    // covered by the self-healing effect — this is belt-and-braces).
    setSyncScroll(false)
  }, [])
  /** Swaps the left (active) and right panes. */
  const swapComparePanes = React.useCallback(() => {
    if (activeId == null || rightId == null) return
    setActiveId(rightId)
    setRightId(activeId)
  }, [activeId, rightId])

  /* ---- Compare mode: proportional scroll sync (same-format pairs) ----
   * Vertical-only, ratio-based (document heights differ). Capture-phase
   * listeners sit on the pane <section>s: scroll events do not bubble but
   * DO propagate while capturing, so ANY descendant scroll container is
   * seen — robust to viewer content mounting later (e.g. after a document
   * finishes loading). The ratio is always taken from the pane's MAIN
   * `.dv-scroll` (getPaneScroller skips the .dv-thumbs sidebar) and driven
   * into the other pane's main `.dv-scroll`; the write is idempotent, so
   * a stray event from a secondary scroller merely re-aligns the pair.
   * Loop guard: raised BEFORE the write, lowered in requestAnimationFrame —
   * the driven pane's scroll event (scroll steps run before rAF in the
   * frame) arrives while the guard is still up, so there is no ping-pong.
   * Deps include the pane file objects: switching a file re-runs the effect
   * and re-attaches the listeners (the scroller elements are replaced). */
  const leftPaneRef = React.useRef<HTMLElement | null>(null)
  const rightPaneRef = React.useRef<HTMLElement | null>(null)
  const syncingRef = React.useRef(false)

  React.useEffect(() => {
    if (!compareMode || !syncScroll) return
    const leftPane = leftPaneRef.current
    const rightPane = rightPaneRef.current
    if (!leftPane || !rightPane) return

    const makeHandler =
      (sourcePane: HTMLElement, otherPane: HTMLElement) => () => {
        if (syncingRef.current) return
        const src = getPaneScroller(sourcePane)
        const dst = getPaneScroller(otherPane)
        if (!src || !dst) return
        const srcRange = src.scrollHeight - src.clientHeight
        const dstRange = dst.scrollHeight - dst.clientHeight
        // Nothing to drive (the other document fits its pane) — skip.
        // srcRange <= 0 → ratio 0 (top), never a division by zero.
        if (dstRange <= 0) return
        const ratio = srcRange > 0 ? src.scrollTop / srcRange : 0
        syncingRef.current = true
        dst.scrollTop = ratio * dstRange
        requestAnimationFrame(() => {
          syncingRef.current = false
        })
      }

    const onLeftScroll = makeHandler(leftPane, rightPane)
    const onRightScroll = makeHandler(rightPane, leftPane)
    const opts: AddEventListenerOptions = { capture: true, passive: true }
    leftPane.addEventListener('scroll', onLeftScroll, opts)
    rightPane.addEventListener('scroll', onRightScroll, opts)
    return () => {
      leftPane.removeEventListener('scroll', onLeftScroll, opts)
      rightPane.removeEventListener('scroll', onRightScroll, opts)
      syncingRef.current = false
    }
  }, [compareMode, syncScroll, activeFile, rightFile])

  // Keep the browser tab title in sync with the opened document. The
  // no-file fallback matches the static metadata title in layout.tsx (Next's
  // metadata hydration overwrites early direct assignments, so the strings
  // are kept identical to avoid a flash of a different title).
  React.useEffect(() => {
    document.title = activeFile
      ? `${activeFile.name} — DocuViewer`
      : 'DocuViewer — Client-Side Document Viewer'
  }, [activeFile])

  const ingestFiles = React.useCallback(
    async (incoming: FileList | File[]) => {
      const list = Array.from(incoming)
      if (list.length === 0) return
      setProcessing(true)
      try {
        const loaded: LoadedFile[] = []
        const errors: string[] = []
        for (const f of list) {
          try {
            const lf = await fileToLoadedFile(f)
            loaded.push(lf)
            historyAdd({
              id: lf.id,
              name: lf.name,
              size: lf.size,
              category: lf.category,
              extension: lf.extension,
              type: lf.type,
            })
          } catch (err) {
            errors.push(
              `${f.name}: ${err instanceof Error ? err.message : 'ошибка чтения'}`,
            )
          }
        }
        if (loaded.length > 0) {
          setFiles((prev) => {
            const next = [...prev, ...loaded]
            return next
          })
          setActiveId(loaded[loaded.length - 1].id)
          toast.success(
            loaded.length === 1
              ? `Открыт файл «${loaded[0].name}»`
              : `Открыто файлов: ${loaded.length}`,
          )
        }
        errors.forEach((e) => toast.error(e))
      } finally {
        setProcessing(false)
      }
    },
    [historyAdd],
  )

  const ingestUrl = React.useCallback(
    async (url: string) => {
      setProcessing(true)
      try {
        const lf = await urlToLoadedFile(url)
        setFiles((prev) => [...prev, lf])
        setActiveId(lf.id)
        historyAdd({
          id: lf.id,
          name: lf.name,
          size: lf.size,
          category: lf.category,
          extension: lf.extension,
          type: lf.type,
        })
        toast.success(`Открыт файл «${lf.name}»`)
      } finally {
        setProcessing(false)
      }
    },
    [historyAdd],
  )

  const closeFile = React.useCallback(
    (id: string) => {
      // Closure-based (not updater-based): the updater must stay pure — the
      // push/revoke side effects run once, here, with the current snapshot.
      const idx = files.findIndex((f) => f.id === id)
      if (idx === -1) return
      const target = files[idx]
      pushClosed([{ file: target, index: idx }])
      revokeLoadedFile(target)
      const next = files.filter((f) => f.id !== id)
      setFiles(next)
      if (activeId === id) {
        const neighbor = next[idx] ?? next[idx - 1] ?? null
        setActiveId(neighbor ? neighbor.id : null)
      }
      toast.info(`Вкладка «${target.name}» закрыта`, {
        description: 'Ctrl+Shift+T — восстановить',
      })
    },
    [files, activeId, pushClosed],
  )

  /** Closes every open tab (tabs menu). */
  const closeAllFiles = React.useCallback(() => {
    pushClosed(files.map((file, index) => ({ file, index })))
    files.forEach(revokeLoadedFile)
    setFiles([])
    setActiveId(null)
    toast.info('Все вкладки закрыты', {
      description: 'Ctrl+Shift+T — восстановить последнюю',
    })
  }, [files, pushClosed])

  /** Logo / site-name click — "go home". Closes every open document (via
   *  the same close-all path, so Ctrl+Shift+T can bring them back) and
   *  exits compare mode, returning to the landing screen. No-op when
   *  nothing is open — the click must never feel destructive on an empty
   *  state. */
  const goHome = React.useCallback(() => {
    if (compareMode) {
      setCompareMode(false)
      setSyncScroll(false)
    }
    if (files.length > 0) closeAllFiles()
  }, [compareMode, files.length, closeAllFiles])

  /** Closes every tab except the active one (tabs menu). */
  const closeOtherFiles = React.useCallback(() => {
    const keepId = activeId
    if (keepId == null) return
    const closed = files.filter((f) => f.id !== keepId)
    pushClosed(
      files
        .map((file, index) => ({ file, index }))
        .filter((e) => e.file.id !== keepId),
    )
    closed.forEach(revokeLoadedFile)
    setFiles(files.filter((f) => f.id === keepId))
    toast.info(`Закрыто вкладок: ${closed.length}`, {
      description: 'Ctrl+Shift+T — восстановить последнюю',
    })
  }, [files, activeId, pushClosed])

  /** Drag-to-reorder handler for the tabs strip (see document-tabs.tsx):
   * moves the dragged tab before/after the target tab. */
  const reorderFiles = React.useCallback(
    (dragId: string, targetId: string, after: boolean) => {
      setFiles((prev) => {
        const from = prev.findIndex((f) => f.id === dragId)
        const to = prev.findIndex((f) => f.id === targetId)
        if (from === -1 || to === -1 || from === to) return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        const targetIdx = next.findIndex((f) => f.id === targetId)
        next.splice(after ? targetIdx + 1 : targetIdx, 0, moved)
        return next
      })
    },
    [],
  )

  /** Opens the OS file picker (multi-select). An optional `accept` filter
   *  (e.g. «.pdf» or «.xlsx,.xls,.csv») pre-limits the dialog to one
   *  format family — used by the landing format cards and Ctrl+O (no
   *  filter). A hidden input is created imperatively: it never mounts into
   *  the React tree, so there is nothing to clean up beyond the browser's
   *  own GC of the detached node after click. */
  const openFilePicker = React.useCallback(
    (accept?: string) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      if (accept) input.accept = accept
      input.onchange = () => {
        if (input.files) ingestFiles(input.files)
      }
      input.click()
    },
    [ingestFiles],
  )

  // Global "open file" shortcut (Ctrl/Cmd+O) — opens the OS file picker
  // from anywhere in the app, like desktop editors. preventDefault stops
  // the browser's own "open location" dialog.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        openFilePicker()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openFilePicker])

  // Restore the last closed tab (Ctrl/Cmd+Shift+T) — the browser's own
  // "reopen closed browser tab" is reserved by Chrome and never reaches the
  // page there, but Firefox/Edge deliver it (and the menu item + the close
  // toast hint work everywhere). No typing-guard: the combo never collides
  // with text input.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === 't'
      ) {
        e.preventDefault()
        restoreClosedTab()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [restoreClosedTab])

  // Escape exits the compare mode (when NOT typing — Escape in inputs is
  // owned by the focused control: the search input clears itself, selects
  // close, dialogs dismiss). While a viewer is fullscreen the browser uses
  // Escape to leave fullscreen first, so we stay out of its way then.
  React.useEffect(() => {
    if (!compareMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = document.activeElement
      const typing =
        el &&
        el !== document.body &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          (el as HTMLElement).isContentEditable)
      if (typing || document.fullscreenElement) return
      setCompareMode(false)
      toast.info('Режим сравнения выключен (Esc)')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compareMode])

  // Global paste handler (Ctrl+V) for files copied to clipboard
  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const fileItems: File[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const f = item.getAsFile()
          if (f) fileItems.push(f)
        }
      }
      if (fileItems.length > 0) {
        e.preventDefault()
        ingestFiles(fileItems)
        toast.info(
          fileItems.length === 1
            ? 'Файл вставлен из буфера обмена'
            : `Вставлено файлов: ${fileItems.length}`,
        )
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [ingestFiles])

  // Global drag-and-drop: files can be dropped ANYWHERE on the page (not
  // only onto the drop zone). While a file is dragged over the window a
  // full-screen overlay hints that dropping opens the document. Drops that
  // land on the DropZone itself are handled by its own handlers (they call
  // preventDefault, so `e.defaultPrevented` tells them apart).
  const dragDepth = React.useRef(0)
  React.useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current += 1
      setDragOverlay(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      // Allow the drop anywhere on the page.
      e.preventDefault()
    }
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragOverlay(false)
    }
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0
      setDragOverlay(false)
      // The drop zone already handled drops on itself.
      if (e.defaultPrevented) return
      const dropped = e.dataTransfer?.files
      if (!dropped || dropped.length === 0) return
      e.preventDefault()
      void ingestFiles(dropped)
      toast.info(
        dropped.length === 1
          ? 'Файл открыт перетаскиванием'
          : `Открыто файлов: ${dropped.length}`,
      )
    }
    const onDragEnd = () => {
      dragDepth.current = 0
      setDragOverlay(false)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [ingestFiles])

  const hasFiles = files.length > 0

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-[1400px] px-3 sm:px-5 py-3 flex items-center gap-2 sm:gap-3">
          {/* Logo + site name — click returns to the landing screen from any
              state (closes all documents; they stay restorable via
              Ctrl+Shift+T). */}
          <button
            type="button"
            onClick={goHome}
            title="DocuViewer — на главную"
            aria-label="DocuViewer — вернуться на главный экран"
            className="group -mx-2 flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1 text-left transition-colors hover:bg-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-accent/80"
          >
            <span className="dv-logo-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
              <FileText className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-bold leading-tight tracking-tight sm:text-lg">
                DocuViewer
              </span>
              <span className="hidden text-[11px] leading-tight text-muted-foreground sm:block">
                Локальный просмотрщик документов
              </span>
            </span>
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <UrlLoadDialog onLoad={ingestUrl} />
            <HistoryPanel />
            <AboutDialog />
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer noopener"
              className="hidden sm:inline-flex"
              aria-label="GitHub"
            >
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Github className="h-4 w-4" />
              </Button>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 mx-auto w-full max-w-[1400px] px-3 sm:px-5 py-4 sm:py-6">
        {!hasFiles ? (
          <div className="relative flex flex-col items-center justify-center gap-8 py-8 sm:py-14 lg:py-16">
            {/* Decorative gradient blobs (no layout impact) */}
            <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
              <div className="dv-blob dv-blob-emerald" />
              <div className="dv-blob dv-blob-rose" />
              <div className="dv-blob dv-blob-amber" />
            </div>

            {/* Hero: one calm heading + one human sentence. No badge pills,
                no keyboard-hint plaques — privacy and speed live in the copy
                itself, not in decoration. */}
            <div className="max-w-2xl space-y-4 text-center">
              <h1 className="text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl">
                Откройте документ{' '}
                <span className="dv-gradient-text">прямо в браузере</span>
              </h1>
              <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
                Любые файлы — от PDF и Word до таблиц и презентаций —
                открываются мгновенно и никуда не отправляются: всё остаётся
                в вашем браузере.
              </p>
            </div>

            <DropZone onFiles={ingestFiles} className="w-full max-w-2xl" />
            <FormatRow onPick={openFilePicker} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Tabs row + compact add + compare toggle */}
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <DocumentTabs
                  files={files}
                  activeId={activeId}
                  onSelect={setActiveId}
                  onClose={closeFile}
                  onCloseAll={closeAllFiles}
                  onCloseOthers={closeOtherFiles}
                  onReorder={reorderFiles}
                  restoreName={closedTop}
                  onRestore={restoreClosedTab}
                  onAdd={() => openFilePicker()}
                />
              </div>
              {files.length >= 2 && (
                <Button
                  type="button"
                  variant={compareMode ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn(
                    'h-9 shrink-0 gap-1.5 px-2.5',
                    compareMode && 'shadow-sm',
                  )}
                  onClick={toggleCompareMode}
                  aria-pressed={compareMode}
                  title={
                    compareMode
                      ? 'Выйти из режима сравнения'
                      : 'Сравнить два документа рядом'
                  }
                >
                  <Columns2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Сравнить</span>
                </Button>
              )}
            </div>

            {/* Compact add-another dropzone */}
            <DropZone onFiles={ingestFiles} compact className="w-full" />

            {/* Viewer + metadata panel (single mode) OR compare split.
                Single mode: the metadata panel visibility comes from the
                global store and is toggled by the "Скрыть панель файла"
                button in the unified viewer toolbar (ViewerShell). When the
                panel is closed the aside is not rendered at all, so the
                viewer stretches over the full available width. The top tabs
                row is NEVER affected.
                Compare mode: two panes side-by-side (left = active tab,
                right = chosen file); the metadata panel is hidden to give
                both panes maximum width; global shortcuts belong to the
                LEFT pane (first shell in DOM order — see viewer-shell.tsx). */}
            {activeFile && compareMode && rightFile ? (
              <div className="flex flex-col gap-2" data-compare-active="true">
                {/* Compare toolbar: left select · swap · right select · exit */}
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 px-2.5 py-1.5">
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Columns2 className="size-4 text-primary/80" aria-hidden />
                    <span className="hidden sm:inline">Сравнение</span>
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:justify-center">
                    <Select
                      value={activeId ?? undefined}
                      onValueChange={setActiveId}
                      aria-label="Левая панель сравнения"
                    >
                      <SelectTrigger className="h-8 w-full min-w-0 max-w-[240px] text-xs">
                        <SelectValue placeholder="Левая панель" />
                      </SelectTrigger>
                      <SelectContent>
                        {files
                          .filter((f) => f.id !== rightId)
                          .map((f) => (
                            <SelectItem key={f.id} value={f.id} className="text-xs">
                              <span className="max-w-[220px] truncate">{f.name}</span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8 shrink-0"
                      onClick={swapComparePanes}
                      aria-label="Поменять панели местами"
                      title="Поменять панели местами"
                    >
                      <ArrowLeftRight className="size-4" />
                    </Button>
                    <Select
                      value={rightId ?? undefined}
                      onValueChange={setRightId}
                      aria-label="Правая панель сравнения"
                    >
                      <SelectTrigger className="h-8 w-full min-w-0 max-w-[240px] text-xs">
                        <SelectValue placeholder="Правая панель" />
                      </SelectTrigger>
                      <SelectContent>
                        {files
                          .filter((f) => f.id !== activeId)
                          .map((f) => (
                            <SelectItem key={f.id} value={f.id} className="text-xs">
                              <span className="max-w-[220px] truncate">{f.name}</span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {/* Scroll-sync toggle — same-format pairs only. When the
                        categories differ the button is not rendered at all
                        (the hint line below explains why). */}
                    {sameFormatPair && (
                      <Button
                        type="button"
                        variant={syncScroll ? 'secondary' : 'outline'}
                        size="sm"
                        className={cn(
                          'h-8 shrink-0 gap-1.5 px-2.5',
                          syncScroll && 'shadow-sm',
                        )}
                        onClick={() => setSyncScroll((on) => !on)}
                        aria-pressed={syncScroll}
                        title={
                          syncScroll
                            ? 'Прокрутка панелей синхронизируется пропорционально'
                            : 'Включить синхронную (пропорциональную) прокрутку панелей'
                        }
                      >
                        {syncScroll ? (
                          <Link2 className="size-4 text-primary" />
                        ) : (
                          <Link2Off className="size-4 text-muted-foreground" />
                        )}
                        <span className="hidden sm:inline">Синхр. прокрутка</span>
                      </Button>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={toggleCompareMode}
                    aria-label="Выйти из режима сравнения"
                    title="Выйти из режима сравнения"
                  >
                    <X className="size-4" />
                  </Button>
                </div>

                {/* Panes: side-by-side from lg, stacked on mobile. */}
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-stretch">
                  <section
                    ref={leftPaneRef}
                    className="dv-compare-pane min-w-0 flex flex-col h-[60dvh] min-h-[380px] lg:h-[calc(100dvh-375px)] overflow-hidden"
                    aria-label="Документ для сравнения (левая панель)"
                  >
                    <ViewerFrame file={activeFile} />
                  </section>
                  <section
                    ref={rightPaneRef}
                    className="dv-compare-pane min-w-0 flex flex-col h-[60dvh] min-h-[380px] lg:h-[calc(100dvh-375px)] overflow-hidden"
                    aria-label="Документ для сравнения (правая панель)"
                  >
                    <ViewerFrame file={rightFile} />
                  </section>
                </div>
                <p className="hidden text-center text-[11px] text-muted-foreground/80 lg:block">
                  Левая панель следует за активной вкладкой; горячие клавиши
                  действуют на левую панель. Esc — выход из сравнения.
                  {sameFormatPair && syncScroll && ' Панели прокручиваются синхронно.'}
                  {!sameFormatPair &&
                    ' Синхронная прокрутка доступна для файлов одного формата.'}
                </p>
              </div>
            ) : activeFile ? (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
                <section
                  className="min-w-0 flex-1 h-[65dvh] min-h-[420px] lg:h-[calc(100dvh-295px)] rounded-xl border border-border bg-card/40 overflow-hidden"
                  aria-label="Просмотр документа"
                >
                  <ViewerFrame file={activeFile} />
                </section>
                {metaPanelOpen && (
                  <aside
                    className={cn(
                      'dv-aside-in rounded-xl border border-border bg-card/40 p-4 shrink-0',
                      'lg:sticky lg:top-[76px] lg:self-start lg:h-fit lg:w-[300px] xl:w-[320px]',
                    )}
                  >
                    <FileMetadata file={activeFile} />
                  </aside>
                )}
              </div>
            ) : null}
          </div>
        )}

        {processing && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/50 backdrop-blur-sm pointer-events-none">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-xl pointer-events-auto">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm font-medium">Обработка файла…</span>
            </div>
          </div>
        )}

        {/* Full-screen "drop anywhere" overlay */}
        {dragOverlay && (
          <div
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-8 backdrop-blur-sm"
            aria-hidden="true"
          >
            <div className="dv-drop-overlay flex max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/60 bg-card/95 px-10 py-12 text-center shadow-2xl">
              <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UploadCloud className="size-8 dv-float" />
              </div>
              <p className="text-lg font-semibold tracking-tight">
                Отпустите файл, чтобы открыть
              </p>
              <p className="text-sm text-muted-foreground">
                Файл будет обработан локально прямо в вашем браузере
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Footer — quiet and human: the privacy promise plus the wordmark.
          Deliberately NO technical caveats (parsing speed, render limits):
          that information belongs in the About dialog, not the first screen. */}
      <footer className="mt-auto border-t border-border bg-background/80">
        <div className="mx-auto max-w-[1400px] px-3 sm:px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span>
              Все файлы обрабатываются локально. Ничего не отправляется на сервер.
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 select-none">
            <span className="dv-footer-dot" aria-hidden="true" />
            DocuViewer
          </span>
        </div>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Landing page: supported-formats chip row                           */
/* ------------------------------------------------------------------ */

interface FormatChip {
  /** Short family label shown inside the chip. No descriptions — the
   *  characteristic colour does the talking (red PDF, blue Word, green
   *  Excel, orange PowerPoint…). */
  label: string
  /** `accept` filter for the OS file picker (comma-separated extensions). */
  accept: string
  /** Family colour (text + tinted background + border), light & dark. */
  chip: string
}

const FORMAT_CHIPS: FormatChip[] = [
  {
    label: 'PDF',
    accept: '.pdf',
    chip: 'text-rose-600 dark:text-rose-300 bg-rose-500/10 border-rose-500/25 hover:border-rose-500/50',
  },
  {
    label: 'DOC',
    accept: '.docx',
    chip: 'text-sky-700 dark:text-sky-300 bg-sky-500/10 border-sky-500/25 hover:border-sky-500/50',
  },
  {
    label: 'XLS',
    accept: '.xlsx,.xls,.csv',
    chip: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25 hover:border-emerald-500/50',
  },
  {
    label: 'PPT',
    accept: '.pptx,.ppt',
    chip: 'text-orange-700 dark:text-orange-300 bg-orange-500/10 border-orange-500/25 hover:border-orange-500/50',
  },
  {
    label: 'MD',
    accept: '.md,.markdown,.mdx',
    chip: 'text-violet-700 dark:text-violet-300 bg-violet-500/10 border-violet-500/25 hover:border-violet-500/50',
  },
  {
    label: 'JSON',
    accept: '.json,.jsonl,.geojson',
    chip: 'text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/25 hover:border-amber-500/50',
  },
  {
    label: 'TXT',
    accept: '.txt,.log,.text',
    chip: 'text-zinc-600 dark:text-zinc-300 bg-zinc-500/10 border-zinc-500/25 hover:border-zinc-500/50',
  },
  {
    label: 'IMG',
    accept: '.png,.jpg,.jpeg,.gif,.svg,.webp,.bmp,.avif',
    chip: 'text-teal-700 dark:text-teal-300 bg-teal-500/10 border-teal-500/25 hover:border-teal-500/50',
  },
  {
    label: 'RTF',
    accept: '.rtf',
    chip: 'text-fuchsia-700 dark:text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/25 hover:border-fuchsia-500/50',
  },
]

function FormatRow({ onPick }: { onPick: (accept: string) => void }) {
  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-3.5">
      <p
        className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60"
        aria-hidden="true"
      >
        Поддерживаемые форматы
      </p>
      <div
        className="flex flex-wrap items-center justify-center gap-2"
        role="list"
        aria-label="Поддерживаемые форматы"
      >
        {FORMAT_CHIPS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => onPick(f.accept)}
            aria-label={`Выбрать файл — ${f.label}`}
            title={`Выбрать ${f.label}-файл (${f.accept})`}
            className={cn('dv-format-chip font-mono', f.chip)}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  About dialog                                                       */
/* ------------------------------------------------------------------ */

function AboutDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="О приложении">
          <Info className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>О DocuViewer</DialogTitle>
          <DialogDescription>
            Полностью клиентский просмотрщик документов для приватного просмотра.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Приватность.</strong> Все файлы
            обрабатываются прямо в браузере. Ничего не отправляется на сервер —
            сайт можно разместить как статический (например, на GitHub Pages).
          </p>
          <p>
            <strong className="text-foreground">Поддерживаемые форматы.</strong>{' '}
            PDF (pdf.js), DOCX (docx-preview), XLSX/XLS/CSV (SheetJS), PPTX
            (извлечение текста/изображений по слайдам), TXT/Markdown
            (markdown-it + highlight.js), JSON, изображения и RTF.
          </p>
          <p>
            <strong className="text-foreground">Горячие клавиши.</strong> Ctrl+P —
            печать документа, F — полноэкранный режим, ←/→ — страницы, +/−/0 —
            масштаб. Полный список доступен по кнопке со значком клавиатуры в
            панели инструментов просмотрщика.
          </p>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
            <p className="font-medium mb-1">⚠️ Ограничения</p>
            <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
              <li>Очень большие файлы обрабатываются медленно (весь парсинг — на стороне клиента).</li>
              <li>PPTX: анимации и переходы не воспроизводятся — упрощённый рендер.</li>
              <li>Файлы не сохраняются после закрытия вкладки (если не включена история в localStorage).</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
