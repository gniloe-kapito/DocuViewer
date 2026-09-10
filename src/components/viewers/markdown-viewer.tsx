'use client'

import * as React from 'react'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { Copy, Eye, Code2, FileText, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ShellSearch, ViewerShell } from '@/components/viewer-shell'
import { useViewerUiStore } from '@/lib/viewer-ui-store'
import { cn } from '@/lib/utils'
import { exportElementToPdf, pdfFilename } from '@/lib/export-pdf'
import { toast } from 'sonner'
import type { LoadedFile } from '@/lib/viewers/types'

interface ViewerProps {
  file: LoadedFile
}

/** Escapes regex metacharacters so the query is matched literally. */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\\]]/g, '\\$&')

/** Escapes text for safe embedding as HTML text (source-mode rendering). */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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

/* Layout-effect variant that is safe during SSR (the markdown viewer is
 * server-rendered on the landing pass): on the server it degrades to a
 * no-op useEffect pass. Using a layout effect for the content publish below
 * prevents a one-frame flash of empty content on mount / mode switches. */
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/**
 * Resolves the textual content of a loaded file.
 * For markdown the `textContent` is already a decoded UTF-8 string
 * provided by `file-utils.ts`. Fall back to decoding the raw
 * `arrayBuffer` if for some reason it is undefined.
 */
function getText(file: LoadedFile): string {
  if (typeof file.textContent === 'string') return file.textContent
  try {
    return new TextDecoder('utf-8').decode(file.arrayBuffer)
  } catch {
    return ''
  }
}

// ---- markdown-it singleton ----
// Configured ONCE and reused across renders / files. Uses highlight.js
// for fenced code blocks. `html: false` keeps us safe from arbitrary
// user-supplied HTML (these are arbitrary files, not trusted content).
// The package's default export is a constructor *value*, so the instance
// type is derived via InstanceType.
type MarkdownItInstance = InstanceType<typeof MarkdownIt>
let mdInstance: MarkdownItInstance | null = null
function getMarkdownIt(): MarkdownItInstance {
  if (mdInstance) return mdInstance
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true,
    highlight(str: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, {
            language: lang,
            ignoreIllegals: true,
          }).value}</code></pre>`
        } catch {
          // fall through to auto / plain
        }
      }
      try {
        return `<pre class="hljs"><code>${hljs.highlightAuto(str).value}</code></pre>`
      } catch {
        // fall through to escaped plain
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
    },
  })
  mdInstance = md
  return md
}

export function MarkdownViewer({ file }: ViewerProps) {
  const text = React.useMemo(() => getText(file), [file])

  const [mode, setMode] = React.useState<'preview' | 'source'>('preview')
  const [copied, setCopied] = React.useState(false)

  // «Night mode» — the shared, persisted global flag (see viewer-ui-store).
  // The marker class lands on the content wrapper of the ACTIVE mode (the
  // CSS inverts the .dv-prose block / the source <pre>, light theme only —
  // in dark theme the prose is already dark). While exporting the class is
  // dropped so the html2canvas capture keeps natural colours; print clones
  // strip it via buildPrintClone.
  const nightMode = useViewerUiStore((s) => s.nightMode)
  const toggleNightMode = useViewerUiStore((s) => s.toggleNightMode)
  /** While true the night-mode marker (and only it) is suppressed so the
   *  PDF screenshot export captures natural colours. */
  const [exporting, setExporting] = React.useState(false)

  // Points at the rendered `.dv-prose` block (preview mode) or the source
  // wrapper (source mode) so printing captures the document, not the scroller.
  const printRootRef = React.useRef<HTMLDivElement>(null)

  // ---- Search infrastructure ----
  // The content containers (`.dv-prose` in preview / the source `<pre>`) are
  // React-EMPTY elements: their innerHTML is assigned imperatively by the
  // publish effect below. This is deliberate — React 19 re-applies
  // `dangerouslySetInnerHTML` on EVERY re-render (even with an identical
  // `__html` string), which would wipe the search's <mark> mutations on any
  // state change; owning the assignment ourselves (the same pattern the DOCX
  // viewer uses for docx-preview) means React re-renders never touch the
  // content, and ONE mechanism serves both modes. The search root is the
  // ACTIVE mode's container.
  const searchRootRef = React.useRef<HTMLElement | null>(null)
  /** Pristine innerHTML of the active container — source of every restore. */
  const pristineHtmlRef = React.useRef<string | null>(null)
  /** Incremented on file change AND mode change — aborts in-flight searches. */
  const renderIdRef = React.useRef(0)

  const previewRefCb = React.useCallback((el: HTMLDivElement | null) => {
    printRootRef.current = el
    searchRootRef.current = el
  }, [])
  const sourcePreRefCb = React.useCallback((el: HTMLElement | null) => {
    searchRootRef.current = el
  }, [])

  const [query, setQuery] = React.useState('')
  const [searchTotal, setSearchTotal] = React.useState<number | null>(null)
  const [activeMatch, setActiveMatch] = React.useState(0)
  /** Bumped on every explicit navigation (submit / prev / next) so the
   * scroll-into-view effect re-runs even when the index wraps back to the
   * same value (e.g. a single match re-centred on repeated Enter). */
  const [navTick, setNavTick] = React.useState(0)
  const [searching, setSearching] = React.useState(false)
  /** Query as of the last submit — Enter with an unchanged query advances to
   * the next match instead of re-running the search (text-viewer semantics). */
  const lastSubmittedRef = React.useRef('')

  // ---- Render markdown -> HTML ----
  const rendered = React.useMemo(() => {
    if (!text) return ''
    try {
      const md = getMarkdownIt()
      return md.render(text)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'неизвестная ошибка'
      console.error('Markdown render error', err)
      toast.error('Не удалось обработать Markdown', { description: message })
      return ''
    }
  }, [text])

  // Source mode renders the raw markdown as ESCAPED HTML — so both modes
  // publish a plain HTML string into their container and share the exact
  // same publish/restore/TreeWalker machinery. A leading newline survives
  // innerHTML assignment on <pre> (fragment parsing never runs the start-tag
  // newline-skip — verified), so the source renders verbatim.
  const escapedSource = React.useMemo(() => escapeHtml(text), [text])

  // Reset the search when the file changes (declared BEFORE the publish
  // effect below so the state resets precede the content swap).
  React.useEffect(() => {
    renderIdRef.current += 1 // abort in-flight searches
    lastSubmittedRef.current = ''
    setQuery('')
    setSearchTotal(null)
    setActiveMatch(0)
    setNavTick(0)
  }, [file.id, file.textContent])

  // Publish the ACTIVE mode's content into its container and (re)take the
  // pristine snapshot. Runs after every container (re)mount — mode switches
  // (conditional render) and file switches (new `rendered` / `escapedSource`;
  // identical re-uploads change `file.id`). Re-assigning innerHTML here also
  // wipes any leftover marks on file switches; marks are never snapshotted
  // because the search state is reset before every one of these flows.
  useIsomorphicLayoutEffect(() => {
    const root = searchRootRef.current
    const html = mode === 'preview' ? rendered : escapedSource
    if (!root || !html) {
      if (root) root.innerHTML = ''
      pristineHtmlRef.current = null
      return
    }
    root.innerHTML = html
    // The pristine snapshot is exactly what we just assigned — restoring it
    // re-parses the identical string.
    pristineHtmlRef.current = html
  }, [mode, rendered, escapedSource, file.id])

  /** Restores the pristine innerHTML, removing every search mark. Only
   * rewrites the DOM when marks are actually present (no-op otherwise —
   * avoids needless re-parsing on empty clears). */
  const restorePristine = React.useCallback(() => {
    const root = searchRootRef.current
    const html = pristineHtmlRef.current
    if (!root || html == null) return
    if (root.querySelector('mark.dv-hl')) root.innerHTML = html
  }, [])

  /** Moves the active-match class and (via the effect below) centres the
   * viewport on the match — flat list in document order, wrap-around. */
  const goToMatch = React.useCallback((index: number) => {
    const root = searchRootRef.current
    if (!root) return
    const marks = root.querySelectorAll<HTMLElement>('mark.dv-hl')
    if (marks.length === 0) return
    const idx = ((index % marks.length) + marks.length) % marks.length
    marks.forEach((m, i) => m.classList.toggle('dv-hl-active', i === idx))
    setActiveMatch(idx)
    setNavTick((t) => t + 1)
  }, [])

  const runSearch = React.useCallback(async () => {
    const q = query.trim()
    if (!q || pristineHtmlRef.current == null) return
    const renderId = renderIdRef.current
    setSearching(true)
    // Yield a frame so the toolbar paints the busy spinner before the
    // (synchronous) DOM walk below can block the main thread.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    )
    try {
      // The file or the mode changed while we waited — abort.
      if (renderId !== renderIdRef.current) return
      const root = searchRootRef.current
      if (!root) return
      // Always start from the pristine DOM — removes previous highlights.
      restorePristine()

      const re = new RegExp(escapeRegExp(q), 'gi')
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
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
        toast.success(`Найдено ${total} ${pluralMatches(total)}`)
        goToMatch(0)
      }
    } finally {
      setSearching(false)
    }
  }, [query, restorePristine, goToMatch])

  const handleSubmit = React.useCallback(() => {
    const q = query.trim()
    if (!q) return
    if (lastSubmittedRef.current === q && (searchTotal ?? 0) > 0) {
      // Same query → advance to the next match (wrap-around inside
      // goToMatch; navTick re-centres even when the index is unchanged).
      goToMatch(activeMatch + 1)
      return
    }
    lastSubmittedRef.current = q
    void runSearch()
  }, [query, searchTotal, activeMatch, runSearch, goToMatch])

  const goPrev = React.useCallback(() => {
    if (!searchTotal) return
    goToMatch(activeMatch - 1)
  }, [searchTotal, activeMatch, goToMatch])

  const goNext = React.useCallback(() => {
    if (!searchTotal) return
    goToMatch(activeMatch + 1)
  }, [searchTotal, activeMatch, goToMatch])

  const clearSearch = React.useCallback(() => {
    restorePristine()
    setQuery('')
    setSearchTotal(null)
    setActiveMatch(0)
    setNavTick(0)
    lastSubmittedRef.current = ''
  }, [restorePristine])

  // Re-centre the viewport on the ACTIVE match after explicit navigation
  // (submit / prev / next) and right after a search — inside the CURRENT
  // mode's container (marks are re-created per mode). Typing never moves
  // the viewport: `query` is not a dependency.
  React.useEffect(() => {
    if (searchTotal == null || searchTotal === 0) return
    searchRootRef.current
      ?.querySelector<HTMLElement>('mark.dv-hl-active')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeMatch, navTick, searchTotal])

  /** Mode switch: abort in-flight searches, strip marks from the outgoing
   * container (its pristine snapshot is still the matching one) and reset
   * the whole search state — the incoming container mounts clean and the
   * snapshot effect above re-snapshots it. */
  const handleModeChange = React.useCallback(
    (next: 'preview' | 'source') => {
      if (next === mode) return
      renderIdRef.current += 1
      restorePristine()
      setQuery('')
      setSearchTotal(null)
      setActiveMatch(0)
      setNavTick(0)
      lastSubmittedRef.current = ''
      setMode(next)
    },
    [mode, restorePristine],
  )

  /** «Скачать как PDF» — mirrors the shell's default export path (the
   *  print root is captured as one element; no per-page slicing here since
   * the prose has no [data-dv-page] markers), plus the night-mode guard:
   *  the inversion class is dropped for the capture (html2canvas-pro
   *  re-renders CSS `filter`, so the exported PDF would otherwise be
   *  inverted) and restored right after. */
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

  const handleCopyHtml = React.useCallback(async () => {
    if (!rendered) return
    try {
      await navigator.clipboard.writeText(rendered)
      toast.success('HTML скопирован в буфер обмена')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Не удалось скопировать HTML')
    }
  }, [rendered])

  // ---- Empty file ----
  if (!text) {
    return (
      <ViewerShell file={file} category="markdown">
        <div className="dv-scroll h-full flex-1 overflow-auto">
          <div className="mx-auto max-w-[800px] px-4 py-12 text-center">
            <FileText className="mx-auto size-10 text-muted-foreground" />
            <h3 className="mt-3 text-lg font-semibold">Файл пустой</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Файл{' '}
              <span className="break-all font-mono">{file.name}</span> не содержит
              Markdown.
            </p>
          </div>
        </div>
      </ViewerShell>
    )
  }

  return (
    <ViewerShell
      file={file}
      category="markdown"
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
        /* Layout note (same as text-viewer): the shell's centre cell is
         * `min-w-max`, so this group must keep a bounded max-content
         * (rem-capped) — otherwise the toolbar would overflow the shell
         * into the metadata panel. The search gets its own full-width row
         * (the form is flex-basis-0 and needs real free space); the mode
         * buttons + copy wrap below it. Caps: 28rem from md (fits next to
         * the metadata panel), 43rem from xl. */
        <div className="flex flex-wrap items-center justify-center gap-1.5 md:max-w-[28rem] xl:max-w-[43rem]">
          <div className="flex w-full min-w-0 items-center justify-center gap-1.5">
            <ShellSearch
              value={query}
              onChange={setQuery}
              onSubmit={handleSubmit}
              onPrev={goPrev}
              onNext={goNext}
              onClear={clearSearch}
              total={searchTotal ?? undefined}
              activeIndex={activeMatch}
              busy={searching}
              disabled={!text}
              placeholder="Поиск по документу…"
              label="Поиск по документу Markdown"
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={mode === 'preview' ? 'secondary' : 'ghost'}
              onClick={() => handleModeChange('preview')}
              aria-pressed={mode === 'preview'}
              title="Отрисованный HTML"
            >
              <Eye className="size-4" />
              <span className="hidden sm:inline">Превью</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'source' ? 'secondary' : 'ghost'}
              onClick={() => handleModeChange('source')}
              aria-pressed={mode === 'source'}
              title="Исходный Markdown"
            >
              <Code2 className="size-4" />
              <span className="hidden sm:inline">Источник</span>
            </Button>

            {mode === 'preview' && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleCopyHtml}
                title="Скопировать отрисованный HTML"
                aria-label="Скопировать HTML"
              >
                <Copy className="size-4" />
                <span className="hidden sm:inline">
                  {copied ? 'Скопировано' : 'Скопировать HTML'}
                </span>
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="dv-scroll h-full flex-1 overflow-auto">
        {mode === 'preview' ? (
          <div
            className={cn(
              'mx-auto max-w-[800px] px-4 py-6',
              nightMode && !exporting && 'dv-night',
            )}
          >
            {rendered ? (
              // React-empty: content published by the layout effect above.
              <div ref={previewRefCb} className="dv-prose" />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Не удалось отрисовать содержимое.
              </p>
            )}
          </div>
        ) : (
          <div
            ref={printRootRef}
            className={cn(
              'mx-auto max-w-[800px] px-4 py-6',
              nightMode && !exporting && 'dv-night',
            )}
          >
            {/* Raw markdown source (escaped) — React-empty as well: the
                * publish layout effect fills it, see the comment above. */}
            <pre
              ref={sourcePreRefCb}
              className="m-0 whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-4 font-mono text-[13px] leading-[1.55]"
            />
          </div>
        )}
      </div>
    </ViewerShell>
  )
}
