'use client'

import * as React from 'react'
import { AlertCircle, Info, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ViewerShell, ShellSearch } from '@/components/viewer-shell'
import { useViewerUiStore } from '@/lib/viewer-ui-store'
import { cn } from '@/lib/utils'
import { exportElementToPdf, pdfFilename } from '@/lib/export-pdf'
import type { LoadedFile } from '@/lib/viewers/types'

interface ViewerProps {
  file: LoadedFile
}

/* ------------------------------------------------------------------ */
/* Minimal RTF → HTML parser (module scope)                           */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Decode a single cp1252 / latin-1 byte (0x00–0xFF) to a Unicode string.
 * Bytes 0x80–0x9F use the cp1252 high-ansi mapping; everything else maps
 * directly via `String.fromCharCode`.
 */
function cp1252Char(byte: number): string {
  const cp1252High: Record<number, number> = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
    0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
    0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
    0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
    0x9e: 0x017e, 0x9f: 0x0178,
  }
  if (cp1252High[byte] !== undefined) {
    try {
      return String.fromCodePoint(cp1252High[byte])
    } catch {
      return ''
    }
  }
  return String.fromCharCode(byte)
}

interface RtfState {
  bold: boolean
  italic: boolean
  underline: boolean
  fontSize: number | null // half-points
}

function cloneState(s: RtfState): RtfState {
  return { bold: s.bold, italic: s.italic, underline: s.underline, fontSize: s.fontSize }
}

/**
 * Convert a raw RTF document string into a minimal HTML string.
 *
 * Recognised control words: \b \i \ul \ulnone \plain \par \line \tab \fsN
 * Recognised escapes: \\ \{ \} \'HH (cp1252) \uN? (unicode, negative → +0x10000)
 * Groups ({...}) push/pop formatting state so formatting is scoped correctly.
 *
 * This is intentionally a *simplified* renderer and will not handle tables,
 * embedded images, fields, etc. Output is wrapped in <p> blocks split on
 * \par; inline runs are wrapped in <strong>/<em>/<u>.
 */
function rtfToHtml(rtf: string): string {
  const n = rtf.length
  let i = 0

  let out = ''
  let paragraph = ''
  let textBuf = ''
  const state: RtfState = { bold: false, italic: false, underline: false, fontSize: null }
  const stack: RtfState[] = []

  const flushText = () => {
    if (!textBuf) return
    let frag = escapeHtml(textBuf)
    textBuf = ''
    if (state.bold) frag = `<strong>${frag}</strong>`
    if (state.italic) frag = `<em>${frag}</em>`
    if (state.underline) frag = `<u>${frag}</u>`
    paragraph += frag
  }

  const flushParagraph = () => {
    flushText()
    if (!paragraph) return
    const styleAttr =
      state.fontSize != null
        ? ` style="font-size:${(state.fontSize / 2).toFixed(1)}pt"`
        : ''
    out += `<p${styleAttr}>${paragraph}</p>`
    paragraph = ''
  }

  while (i < n) {
    const c = rtf[i]

    if (c === '\\') {
      flushText()
      const next = rtf[i + 1]

      // Literal escapes.
      if (next === '\\') { paragraph += '\\'; i += 2; continue }
      if (next === '{') { paragraph += '{'; i += 2; continue }
      if (next === '}') { paragraph += '}'; i += 2; continue }

      // Hex byte escape: \'HH (cp1252)
      if (next === "'") {
        const hex = rtf.substr(i + 2, 2)
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          textBuf += cp1252Char(parseInt(hex, 16))
          i += 4
          continue
        }
      }

      // Unicode escape: \uN? (N may be negative; trailing ? is the
      // "substitution char" that should be skipped).
      if (next === 'u') {
        const m = rtf.slice(i).match(/^\\u(-?\d+)\??/)
        if (m) {
          let code = parseInt(m[1], 10)
          if (code < 0) code += 0x10000
          try {
            textBuf += String.fromCodePoint(code)
          } catch {
            // ignore invalid code point
          }
          i += m[0].length
          continue
        }
      }

      // Control word: \word (letters) with optional numeric argument and
      // optional single-space delimiter.
      const cw = rtf.slice(i).match(/^\\([a-zA-Z]+)(-?\d*) ?/)
      if (cw) {
        const word = cw[1].toLowerCase()
        const numStr = cw[2]
        const hasNum = numStr.length > 0
        const num = hasNum ? parseInt(numStr, 10) : 0

        switch (word) {
          case 'par':
            flushParagraph()
            break
          case 'line':
            flushText()
            paragraph += '<br>'
            break
          case 'tab':
            flushText()
            paragraph += '&nbsp;&nbsp;&nbsp;&nbsp;'
            break
          case 'b':
            state.bold = !hasNum || num !== 0
            break
          case 'i':
            state.italic = !hasNum || num !== 0
            break
          case 'ul':
          case 'ulw':
          case 'uld':
          case 'uldb':
          case 'ulth':
            state.underline = !hasNum || num !== 0
            break
          case 'ulnone':
            state.underline = false
            break
          case 'plain':
            state.bold = false
            state.italic = false
            state.underline = false
            state.fontSize = null
            break
          case 'fs':
            if (hasNum) state.fontSize = num
            break
          // Intentionally ignored control words (header / destination words).
          case 'rtf':
          case 'ansi':
          case 'mac':
          case 'pc':
          case 'pca':
          case 'deff':
          case 'adeflang':
          case 'ansiCodepage':
          case 'fonttbl':
          case 'colortbl':
          case 'info':
          case 'stylesheet':
          case 'pict':
          case 'object':
          case 'fldinst':
          case 'nonshppict':
          case 'shppict':
          case 'bin':
            break
          default:
            // Unknown control word — ignore.
            break
        }
        i += cw[0].length
        continue
      }

      // Unknown backslash escape — skip the backslash itself.
      i += 1
      continue
    }

    if (c === '{') {
      flushText()
      stack.push(cloneState(state))
      i += 1
      continue
    }
    if (c === '}') {
      flushText()
      const prev = stack.pop()
      if (prev) {
        state.bold = prev.bold
        state.italic = prev.italic
        state.underline = prev.underline
        state.fontSize = prev.fontSize
      }
      i += 1
      continue
    }

    // Raw CR/LF are not significant in RTF (they are formatting whitespace).
    if (c === '\n' || c === '\r') {
      i += 1
      continue
    }

    textBuf += c
    i += 1
  }

  flushParagraph()
  return out
}

/* ------------------------------------------------------------------ */
/* Search helpers (module scope)                                      */
/* ------------------------------------------------------------------ */

/** Escapes regex metacharacters so the query is matched literally. */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Russian plural forms for «совпадение» (1 / 2–4 / 5+). */
function pluralMatches(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'совпадение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'совпадения'
  }
  return 'совпадений'
}

/** Unwraps every search <mark> in place (no innerHTML re-parse). Used by the
 * file-change reset: the html memo compares strings, so re-uploading the
 * SAME file yields an identical `html` string and React then SKIPS re-setting
 * dangerouslySetInnerHTML — stale highlights must be removed by hand. */
function stripSearchMarks(root: HTMLElement | null): void {
  if (!root) return
  root.querySelectorAll('mark.dv-hl').forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  })
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function RtfViewer({ file }: ViewerProps) {
  const text = file.textContent ?? ''

  const { html, error } = React.useMemo(() => {
    try {
      return { html: rtfToHtml(text), error: null as string | null }
    } catch (e) {
      return { html: '', error: (e as Error).message || String(e) }
    }
  }, [text])

  React.useEffect(() => {
    if (error) toast.error('Ошибка разбора RTF: ' + error)
  }, [error])

  /** dangerouslySetInnerHTML prop, memoized for a STABLE IDENTITY. React's
   * update path compares this prop object by reference (not the `__html`
   * string), so an inline literal would re-set innerHTML on every re-render
   * and silently wipe the search marks (state updates like `searching`/
   * `searchTotal` re-render the component constantly). With the memo the
   * innerHTML is re-set ONLY when the html string itself changes. */
  const innerHtml = React.useMemo(() => ({ __html: html }), [html])

  // Points at the rendered document container (not the scroll container)
  // so printing captures the document only.
  const printRootRef = React.useRef<HTMLDivElement>(null)
  /** The .dv-prose element whose innerHTML React owns via
   * dangerouslySetInnerHTML — the host for the search highlights. */
  const proseRef = React.useRef<HTMLDivElement>(null)

  // «Night mode» — the shared, persisted global flag (see viewer-ui-store).
  // The marker class lands on the content wrapper around the .dv-prose host;
  // the CSS inverts the prose (light theme only — in dark theme it is already
  // dark). The class is dropped while exporting so the html2canvas capture
  // keeps natural colours; print clones strip it via buildPrintClone.
  const nightMode = useViewerUiStore((s) => s.nightMode)
  const toggleNightMode = useViewerUiStore((s) => s.toggleNightMode)
  /** While true the night-mode marker (and only it) is suppressed so the
   *  PDF screenshot export captures natural colours. */
  const [exporting, setExporting] = React.useState(false)

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

  // ---- Text search state ----
  const [query, setQuery] = React.useState('')
  /** null = no search run yet; 0 = searched, no matches; > 0 = matches. */
  const [searchTotal, setSearchTotal] = React.useState<number | null>(null)
  const [activeIndex, setActiveIndex] = React.useState(0)
  /** Bumped on every explicit navigation (submit / prev / next) so the
   * active-mark effect re-runs even when the index itself is unchanged. */
  const [navTick, setNavTick] = React.useState(0)
  const [searching, setSearching] = React.useState(false)
  /** Query as of the last submit — Enter with an unchanged query advances to
   * the next match instead of restarting from the first one. */
  const lastSubmittedRef = React.useRef('')
  /** Pristine .dv-prose innerHTML (no highlights) — captured after every
   * html render; the source for each snapshot/restore cycle of the search. */
  const pristineHtmlRef = React.useRef<string | null>(null)
  /** Incremented per file change; lets an in-flight search abort cleanly. */
  const renderIdRef = React.useRef(0)

  // ---- File change: reset the search + wipe any stale marks ----
  // Runs BEFORE the pristine-snapshot effect below (effects run in
  // declaration order), so a snapshot can never capture a highlighted DOM.
  // The in-place unwrap matters for re-uploading the SAME file: `html` is a
  // string-equal memo value, so React skips re-setting
  // dangerouslySetInnerHTML and the marks would otherwise survive.
  React.useEffect(() => {
    renderIdRef.current += 1
    stripSearchMarks(proseRef.current)
    pristineHtmlRef.current = null
    setQuery('')
    setSearchTotal(null)
    setActiveIndex(0)
    setNavTick(0)
    setSearching(false)
    lastSubmittedRef.current = ''
  }, [file.id, file.textContent])

  // ---- Pristine snapshot — AFTER the new html is committed to the DOM ----
  // `file.id` is a dep in addition to `html` so the snapshot also re-runs
  // when the file is swapped for one with identical content (the memo then
  // returns an equal string and React does not re-commit the innerHTML).
  React.useEffect(() => {
    const prose = proseRef.current
    if (prose && html) {
      pristineHtmlRef.current = prose.innerHTML
    }
  }, [html, file.id])

  // ---- Text search: pristine snapshot/restore + DOM-walk highlighting ----
  // React owns .dv-prose through dangerouslySetInnerHTML but only re-sets it
  // when the html STRING changes, so the search mutates the DOM directly
  // (the DOCX-viewer pattern): (1) restore the pristine innerHTML (dropping
  // previous highlights), (2) walk the text nodes and wrap each match in
  // <mark class="dv-hl">, (3) mark the active one and scroll it into view
  // via the [activeIndex, navTick] effect below. Marks live inside
  // printRootRef → they intentionally appear in the print output (the user
  // can clear the search before printing, same trade-off as the DOCX viewer).
  const restorePristine = React.useCallback(() => {
    const prose = proseRef.current
    const pristine = pristineHtmlRef.current
    if (!prose || pristine == null) return
    prose.innerHTML = pristine
  }, [])

  const runSearch = React.useCallback(async () => {
    const prose = proseRef.current
    const q = query.trim()
    if (!prose || !q || !html || error) return
    if (pristineHtmlRef.current == null) return
    const renderId = renderIdRef.current
    setSearching(true)
    // The DOM walk below is synchronous; yield one frame so the toolbar can
    // paint the busy spinner before it potentially blocks the main thread
    // (DOCX-viewer pattern, kept for parity and for large documents).
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    )
    try {
      // The file changed while we waited for the frame — abort.
      if (renderId !== renderIdRef.current) return
      // Always start from the pristine DOM — removes previous highlights.
      restorePristine()

      const re = new RegExp(escapeRegExp(q), 'gi')
      const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT, {
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
      setActiveIndex(0)
      if (total === 0) {
        toast.message(`«${q}» не найдено`)
      } else {
        toast.success(`Найдено ${total} ${pluralMatches(total)}`)
        // Bump the tick so the effect below marks match #0 active and
        // scrolls to it (activeIndex may already be 0).
        setNavTick((t) => t + 1)
      }
    } finally {
      setSearching(false)
    }
  }, [query, html, error, restorePristine])

  const goNext = React.useCallback(() => {
    if (!searchTotal) return
    setActiveIndex((i) => (i + 1) % searchTotal)
    setNavTick((t) => t + 1)
  }, [searchTotal])

  const goPrev = React.useCallback(() => {
    if (!searchTotal) return
    setActiveIndex((i) => (i - 1 + searchTotal) % searchTotal)
    setNavTick((t) => t + 1)
  }, [searchTotal])

  const handleSubmit = React.useCallback(() => {
    const q = query.trim()
    if (!q || !html || error || searching) return
    if (lastSubmittedRef.current === q && searchTotal && searchTotal > 0) {
      // Same query submitted again — advance to the next match instead of
      // re-walking the DOM (Enter semantics of the text viewer).
      goNext()
      return
    }
    lastSubmittedRef.current = q
    void runSearch()
  }, [query, html, error, searching, searchTotal, goNext, runSearch])

  const clearSearch = React.useCallback(() => {
    restorePristine()
    setQuery('')
    setSearchTotal(null)
    setActiveIndex(0)
    setNavTick(0)
    lastSubmittedRef.current = ''
  }, [restorePristine])

  // Mark the active match and scroll it into view after every explicit
  // navigation (submit / prev / next). Typing never moves the viewport —
  // query edits change no dependency of this effect.
  React.useEffect(() => {
    const prose = proseRef.current
    if (!prose || searchTotal == null || searchTotal <= 0) return
    const marks = prose.querySelectorAll<HTMLElement>('mark.dv-hl')
    if (marks.length === 0) return
    const idx = ((activeIndex % marks.length) + marks.length) % marks.length
    marks.forEach((m, i) => m.classList.toggle('dv-hl-active', i === idx))
    // The mark lives inside the .dv-scroll container — the native
    // scrollIntoView scrolls the right ancestor for us.
    marks[idx].scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex, navTick, searchTotal])

  if (error) {
    return (
      <ViewerShell
        file={file}
        category="rtf"
        centerExtra={
          <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <AlertCircle className="size-3.5 shrink-0" />
            Ошибка разбора RTF
          </span>
        }
      >
        <div className="dv-scroll h-full flex-1 overflow-auto">
          <div className="p-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              Не удалось разобрать документ. Показан исходный текст RTF.
            </p>
            <pre className="font-mono text-sm leading-relaxed p-4 rounded-md border border-border bg-muted/40 overflow-auto whitespace-pre-wrap break-words">
              {text}
            </pre>
          </div>
        </div>
      </ViewerShell>
    )
  }

  return (
    <ViewerShell
      file={file}
      category="rtf"
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
         * must keep a bounded max-content (rem-capped) — otherwise the
         * toolbar would overflow the shell into the metadata panel. The
         * search gets its own full-width row (the form is flex-basis-0 and
         * needs real free space), the amber RTF notice wraps below it.
         * Caps: 28rem from md (fits next to the metadata panel), 43rem from
         * xl. */
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
              activeIndex={activeIndex}
              busy={searching}
              disabled={!html}
              placeholder="Поиск по документу…"
              label="Поиск по документу RTF"
            />
          </div>

          <span
            className="flex min-w-0 items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"
            title="Упрощённый просмотр RTF: базовое форматирование, сложные элементы могут не отображаться."
          >
            <Info className="size-3.5 shrink-0" />
            <span className="hidden min-w-0 truncate sm:inline">
              Упрощённый просмотр RTF: базовое форматирование, сложные элементы
              могут не отображаться.
            </span>
            <span className="sm:hidden">Упрощённый просмотр</span>
          </span>
        </div>
      }
    >
      <div className="dv-scroll h-full flex-1 overflow-auto">
        {/* Rendered content — the wrapper carries the `dv-night` marker
            (dropped while exporting; print clones strip it). */}
        <div
          ref={printRootRef}
          className={cn(
            'w-full max-w-[800px] mx-auto px-4 py-6',
            nightMode && !exporting && 'dv-night',
          )}
        >
          {html ? (
            <div
              ref={proseRef}
              className="dv-prose"
              dangerouslySetInnerHTML={innerHtml}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              Документ пуст или не содержит отображаемого текста.
            </p>
          )}
        </div>
      </div>
    </ViewerShell>
  )
}
