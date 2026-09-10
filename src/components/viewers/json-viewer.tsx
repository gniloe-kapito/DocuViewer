'use client'

import * as React from 'react'
import { Copy, Check, AlertCircle, Moon, Sun } from 'lucide-react'
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

/* ------------------------------------------------------------------ */
/* Helpers (module scope)                                             */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escapes regex metacharacters so the query is matched literally. */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One search hit: `start`/`end` are character offsets in the pretty string. */
interface JsonMatch {
  start: number
  end: number
}

const EMPTY_MATCHES: readonly JsonMatch[] = []

/**
 * Fresh tokenizer regex — `/g` regexes are stateful, so a new instance is
 * created for every pass (highlightJson / jsonChunks).
 */
const makeTokenRe = () =>
  /("(?:[^"\\]|\\.)*")(\s*)(:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g

/**
 * Tokenize a pretty-printed JSON string and wrap each token in a coloured
 * span. The span classes (`dv-json-*`) are defined in globals.css.
 *
 * Token classes:
 *  - key        → dv-json-key   (quoted string immediately followed by ':')
 *  - string val → dv-json-string
 *  - true/false → dv-json-bool
 *  - null       → dv-json-null
 *  - number     → dv-json-number
 *  - punct      → dv-json-punct  ({}[],:)
 *
 * All literal text is HTML-escaped before being wrapped.
 *
 * Search: the optional `matches` list (character ranges in `jsonStr`,
 * document-ordered and pre-filtered to hits that lie fully inside a single
 * tokenizer sub-chunk — see filterMarkable) is rendered as
 * `<mark class="dv-hl">` inside the token spans; the mark whose ordinal
 * equals `activeIndex` additionally gets `dv-hl-active`. Without matches the
 * output is byte-identical to the plain highlighter (zero overhead).
 */
function highlightJson(
  jsonStr: string,
  matches: readonly JsonMatch[] = EMPTY_MATCHES,
  activeIndex = 0,
): string {
  // Order matters: the key alternative (quoted string + optional ws + ':')
  // is tried first so that a string value followed by a colon is correctly
  // classified as a key rather than a plain string.
  const re = makeTokenRe()

  /** Escapes jsonStr[from,to) and wraps the contained match ranges in
   * <mark> elements. `mi`/`markOrd` are shared across calls: chunks are
   * emitted in document order and matches are sorted by start, so the
   * emitted mark ordinal === index in the `matches` array. */
  let markOrd = 0
  let mi = 0
  const emit = (from: number, to: number): string => {
    if (from >= to) return ''
    let s = ''
    let pos = from
    while (mi < matches.length && matches[mi].end <= pos) mi++
    while (mi < matches.length && matches[mi].start < to) {
      const hit = matches[mi]
      if (hit.start >= pos && hit.end <= to) {
        if (hit.start > pos) s += escapeHtml(jsonStr.slice(pos, hit.start))
        s += `<mark class="${
          markOrd === activeIndex ? 'dv-hl dv-hl-active' : 'dv-hl'
        }">${escapeHtml(jsonStr.slice(hit.start, hit.end))}</mark>`
        markOrd++
        pos = hit.end
      }
      // else: a hit straddling this chunk's boundary is skipped — unreachable
      // in practice because the match list is pre-filtered (defensive only).
      mi++
    }
    if (pos < to) s += escapeHtml(jsonStr.slice(pos, to))
    return s
  }

  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(jsonStr)) !== null) {
    // Append any whitespace / non-token text between matches (escaped).
    if (m.index > last) {
      out += emit(last, m.index)
    }
    if (m[1] !== undefined && m[3] === ':') {
      // Key token: quoted string + whitespace + colon — three sub-chunks,
      // so a match never crosses the span boundaries inside the token.
      const s0 = m.index
      const s1 = s0 + m[1].length
      const s2 = s1 + m[2].length
      const s3 = s0 + m[0].length
      out += `<span class="dv-json-key">${emit(s0, s1)}</span>`
      out += emit(s1, s2) // whitespace (only \s chars — escaping is identity)
      out += `<span class="dv-json-punct">${emit(s2, s3)}</span>`
    } else if (m[4] !== undefined) {
      // String value.
      out += `<span class="dv-json-string">${emit(
        m.index,
        m.index + m[0].length,
      )}</span>`
    } else if (m[5] !== undefined) {
      const cls = m[5] === 'null' ? 'dv-json-null' : 'dv-json-bool'
      out += `<span class="${cls}">${emit(m.index, m.index + m[0].length)}</span>`
    } else if (m[6] !== undefined) {
      out += `<span class="dv-json-number">${emit(
        m.index,
        m.index + m[0].length,
      )}</span>`
    } else if (m[7] !== undefined) {
      out += `<span class="dv-json-punct">${emit(
        m.index,
        m.index + m[0].length,
      )}</span>`
    }
    last = m.index + m[0].length
  }
  if (last < jsonStr.length) {
    out += emit(last, jsonStr.length)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Search helpers                                                     */
/* ------------------------------------------------------------------ */

/** A maximal run of source text emitted as one escaped HTML text run
 * (token text or inter-token gap). Sorted, non-empty, covering the string. */
interface JsonChunk {
  start: number
  end: number
}

/**
 * Tokenizer sub-chunk ranges of the pretty string. A search hit must lie
 * fully inside ONE chunk to be highlightable: a mark cannot span the
 * boundary between two token spans (e.g. from a string into a following
 * comma) without breaking the span structure. Key tokens contribute three
 * sub-chunks (`"key"`, the whitespace, `:`); every other token and every
 * inter-token gap is one chunk.
 */
function jsonChunks(jsonStr: string): JsonChunk[] {
  const re = makeTokenRe()
  const chunks: JsonChunk[] = []
  const push = (start: number, end: number) => {
    if (end > start) chunks.push({ start, end })
  }
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(jsonStr)) !== null) {
    push(last, m.index)
    if (m[1] !== undefined && m[3] === ':') {
      const s0 = m.index
      const s1 = s0 + m[1].length
      const s2 = s1 + m[2].length
      push(s0, s1)
      push(s1, s2)
      push(s2, s0 + m[0].length)
    } else {
      push(m.index, m.index + m[0].length)
    }
    last = m.index + m[0].length
  }
  push(last, jsonStr.length)
  return chunks
}

/**
 * Keeps only matches fully inside a single tokenizer sub-chunk — hits that
 * straddle a chunk boundary (a query spanning token edges, e.g. `"pdf",`)
 * cannot be wrapped in a single mark and are skipped, the same per-item
 * approximation as the PDF viewer. The kept list stays in document order,
 * so array index === emitted mark ordinal.
 */
function filterMarkable(
  ranges: readonly JsonMatch[],
  chunks: readonly JsonChunk[],
): JsonMatch[] {
  const kept: JsonMatch[] = []
  for (const r of ranges) {
    // Binary search for the chunk containing r.start (chunks cover the
    // whole string, so exactly one chunk qualifies).
    let lo = 0
    let hi = chunks.length - 1
    let inside = false
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const c = chunks[mid]
      if (c.end <= r.start) {
        lo = mid + 1
      } else if (c.start > r.start) {
        hi = mid - 1
      } else {
        inside = r.end <= c.end
        break
      }
    }
    if (inside) kept.push(r)
  }
  return kept
}

interface ParseResult {
  /** Parsed JS value, or `undefined` if parsing failed completely. */
  value: unknown
  /** Pretty-printed JSON string ready for highlight / copy. */
  pretty: string
  /** Set when the file was interpreted as JSON Lines. */
  jsonl: boolean
  /** Non-fatal per-line errors collected while parsing JSONL. */
  lineErrors: string[]
  /** Fatal error message — when set, the whole file is treated as invalid. */
  fatal: string | null
  /** Root type label, e.g. "массив[12]" / "объект{34}" / "число". */
  typeLabel: string
}

function rootTypeLabel(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `массив[${v.length}]`
  const t = typeof v
  if (t === 'object') {
    return `объект{${Object.keys(v as Record<string, unknown>).length}}`
  }
  if (t === 'string') return `строка (${(v as string).length} симв.)`
  if (t === 'number') return 'число'
  if (t === 'boolean') return 'булево'
  return t
}

function parseJsonl(text: string): { values: unknown[]; errors: string[] } {
  const lines = text.split(/\r?\n/)
  const values: unknown[] = []
  const errors: string[] = []
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      values.push(JSON.parse(trimmed))
    } catch (e) {
      errors.push(`Строка ${i + 1}: ${(e as Error).message}`)
    }
  })
  return { values, errors }
}

function parseJsonInput(text: string, ext: string): ParseResult {
  const empty: ParseResult = {
    value: undefined,
    pretty: '',
    jsonl: false,
    lineErrors: [],
    fatal: null,
    typeLabel: '—',
  }

  if (ext === 'jsonl') {
    const { values, errors } = parseJsonl(text)
    return {
      value: values,
      pretty: JSON.stringify(values, null, 2),
      jsonl: true,
      lineErrors: errors,
      fatal: null,
      typeLabel: `массив[${values.length}]`,
    }
  }

  // Try parsing the whole text first.
  try {
    const value = JSON.parse(text)
    return {
      value,
      pretty: JSON.stringify(value, null, 2),
      jsonl: false,
      lineErrors: [],
      fatal: null,
      typeLabel: rootTypeLabel(value),
    }
  } catch (e) {
    const msg = (e as Error).message
    // Fall back to JSONL interpretation.
    const { values, errors } = parseJsonl(text)
    if (values.length > 0) {
      return {
        value: values,
        pretty: JSON.stringify(values, null, 2),
        jsonl: true,
        lineErrors: errors,
        fatal: null,
        typeLabel: `массив[${values.length}]`,
      }
    }
    return { ...empty, fatal: msg }
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function JsonViewer({ file }: ViewerProps) {
  const text = file.textContent ?? ''
  const ext = file.extension

  const parsed = React.useMemo<ParseResult>(
    () => parseJsonInput(text, ext),
    [text, ext],
  )

  // ---- Search (case-insensitive, live; mirrors text-viewer semantics) ----
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  /** Bumped on every explicit navigation (submit / prev / next) so the
   *  scroll-into-view effect re-runs even when the index itself is unchanged. */
  const [navTick, setNavTick] = React.useState(0)
  /** Query as of the last submit — Enter with an unchanged query advances to
   *  the next match instead of restarting from the first one. */
  const lastSubmittedRef = React.useRef('')

  // Reset search state when the file changes.
  React.useEffect(() => {
    setQuery('')
    setActiveIndex(0)
    setNavTick(0)
    lastSubmittedRef.current = ''
  }, [file.id, file.textContent])

  // Points at the JSON content root (error block / highlighted pre), not the
  // scroll container, so the print clone contains only the document body.
  const printRootRef = React.useRef<HTMLDivElement>(null)

  // «Night mode» — the shared, persisted global flag (see viewer-ui-store).
  // The marker class lands on the success-branch content root; the CSS
  // inverts the highlighted <pre> (light theme only — in dark theme the JSON
  // text is already dark). The class is dropped while exporting so the
  // html2canvas capture keeps natural colours; print clones strip it via
  // buildPrintClone.
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

  // Search hits against the RAW pretty string: one pass with a literal
  // case-insensitive regex (the 'i' flag never changes match length, so
  // `start`/`end` are always valid for String.slice; non-overlapping hits),
  // then filtered to hits fully inside a single tokenizer sub-chunk — every
  // counted hit is therefore markable and array index === mark ordinal.
  // Computed only when a query is present: the no-query path (matches === [])
  // keeps highlightJson byte-identical to the plain highlighter.
  const matches = React.useMemo<JsonMatch[]>(() => {
    if (!query || !parsed.pretty) return []
    let re: RegExp
    try {
      re = new RegExp(escapeRegExp(query), 'gi')
    } catch {
      return []
    }
    const raw: JsonMatch[] = []
    for (let m = re.exec(parsed.pretty); m !== null; m = re.exec(parsed.pretty)) {
      raw.push({ start: m.index, end: m.index + m[0].length })
    }
    if (raw.length === 0) return []
    return filterMarkable(raw, jsonChunks(parsed.pretty))
  }, [parsed.pretty, query])

  const total = matches.length
  // Clamp so query edits that shrink the match list keep the index valid.
  const activeIdx = total > 0 ? Math.min(activeIndex, total - 1) : 0

  // Marks re-render synchronously as the user types (the pretty text is
  // already fully rendered as a single <pre>, so marking adds no DOM nodes
  // beyond the <mark> elements themselves).
  const highlighted = React.useMemo(
    () =>
      parsed.pretty ? highlightJson(parsed.pretty, matches, activeIdx) : '',
    [parsed.pretty, matches, activeIdx],
  )

  const [copied, setCopied] = React.useState(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  React.useEffect(() => {
    if (parsed.fatal) {
      toast.error('Ошибка разбора JSON: ' + parsed.fatal)
    }
  }, [parsed.fatal])

  // Scroll the active mark into view after explicit navigation (submit /
  // prev / next). Typing never moves the viewport: the raw `activeIndex`
  // state only changes on navigation, while the clamped `activeIdx` used
  // for rendering does not participate in this effect's dependencies.
  React.useEffect(() => {
    printRootRef.current
      ?.querySelector('mark.dv-hl-active')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex, navTick])

  const handleSubmit = React.useCallback(() => {
    if (!query.trim()) return
    if (total === 0) {
      toast.message(`«${query}» не найдено`)
      return
    }
    if (lastSubmittedRef.current === query) {
      setActiveIndex((activeIdx + 1) % total)
    } else {
      lastSubmittedRef.current = query
      setActiveIndex(0)
    }
    toast.success(`Найдено совпадений: ${total}`)
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

  const handleCopy = async () => {
    if (!parsed.pretty) return
    try {
      await navigator.clipboard.writeText(parsed.pretty)
      setCopied(true)
      toast.success('JSON скопирован в буфер обмена')
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Не удалось скопировать')
    }
  }

  return (
    <ViewerShell
      file={file}
      category="json"
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
         * toolbar would overflow the shell into the metadata panel (same
         * fix as text-viewer). The search gets its own full-width row (the
         * form is flex-basis-0 and needs real free space), the type label +
         * JSONL badge + copy button wrap below it. Caps: 28rem from md
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
              disabled={!parsed.pretty}
              placeholder="Поиск по JSON…"
              label="Поиск по JSON"
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {parsed.typeLabel}
            </span>
            {parsed.jsonl && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                JSONL
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!parsed.pretty}
              title="Скопировать форматированный JSON"
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              <span className="hidden sm:inline">
                {copied ? 'Скопировано' : 'Скопировать'}
              </span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="dv-scroll h-full flex-1 overflow-auto">
        {parsed.fatal ? (
          /* Fatal parse error: search is disabled (ShellSearch gets
           * disabled={!parsed.pretty}) and the raw-text fallback below is
           * deliberately NOT searchable — there are no tokens to mark. */
          <div ref={printRootRef} className="p-4 space-y-3">
            <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="space-y-1">
                <p className="font-medium text-destructive">Не удалось разобрать JSON</p>
                <p className="text-muted-foreground break-words">{parsed.fatal}</p>
              </div>
            </div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Исходный текст
            </p>
            <pre className="font-mono text-sm leading-relaxed p-4 rounded-md border border-border bg-muted/40 overflow-auto whitespace-pre-wrap break-words">
              {text}
            </pre>
          </div>
        ) : (
          <div
            ref={printRootRef}
            className={cn(
              'relative',
              nightMode && !exporting && 'dv-night',
            )}
          >
            {parsed.lineErrors.length > 0 && (
              <div className="mx-4 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                <p className="font-medium mb-1">
                  Часть строк не разобрана ({parsed.lineErrors.length}):
                </p>
                <ul className="space-y-0.5 max-h-32 overflow-y-auto dv-scroll">
                  {parsed.lineErrors.slice(0, 50).map((e, i) => (
                    <li key={i} className="break-words">{e}</li>
                  ))}
                  {parsed.lineErrors.length > 50 && (
                    <li className="italic">…и ещё {parsed.lineErrors.length - 50}</li>
                  )}
                </ul>
              </div>
            )}
            <pre
              className="font-mono text-sm leading-relaxed p-4 whitespace-pre"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </div>
        )}
      </div>
    </ViewerShell>
  )
}

/* recompile-note: search feature added — clear stale module state */
