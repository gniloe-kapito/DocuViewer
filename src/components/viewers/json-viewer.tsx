'use client'

import * as React from 'react'
import { Copy, Check, AlertCircle, Braces } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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
 */
function highlightJson(jsonStr: string): string {
  // Order matters: the key alternative (quoted string + optional ws + ':')
  // is tried first so that a string value followed by a colon is correctly
  // classified as a key rather than a plain string.
  const re =
    /("(?:[^"\\]|\\.)*")(\s*)(:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g

  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(jsonStr)) !== null) {
    // Append any whitespace / non-token text between matches (escaped).
    if (m.index > last) {
      out += escapeHtml(jsonStr.slice(last, m.index))
    }
    if (m[1] !== undefined && m[3] === ':') {
      // Key token: quoted string + whitespace + colon.
      out += `<span class="dv-json-key">${escapeHtml(m[1])}</span>`
      out += m[2] // whitespace (safe: only space chars matched by \s*)
      out += `<span class="dv-json-punct">:</span>`
    } else if (m[4] !== undefined) {
      // String value.
      out += `<span class="dv-json-string">${escapeHtml(m[4])}</span>`
    } else if (m[5] !== undefined) {
      const cls = m[5] === 'null' ? 'dv-json-null' : 'dv-json-bool'
      out += `<span class="${cls}">${m[5]}</span>`
    } else if (m[6] !== undefined) {
      out += `<span class="dv-json-number">${m[6]}</span>`
    } else if (m[7] !== undefined) {
      out += `<span class="dv-json-punct">${m[7]}</span>`
    }
    last = m.index + m[0].length
  }
  if (last < jsonStr.length) {
    out += escapeHtml(jsonStr.slice(last))
  }
  return out
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

  const highlighted = React.useMemo(
    () => (parsed.pretty ? highlightJson(parsed.pretty) : ''),
    [parsed.pretty],
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
    <div className="dv-scroll h-full overflow-auto flex flex-col">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-card/90 backdrop-blur border-b border-border">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Braces className="h-4 w-4" />
            <span className="font-medium tabular-nums">{parsed.typeLabel}</span>
            {parsed.jsonl && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                JSONL
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!parsed.pretty}
              title="Скопировать форматированный JSON"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Скопировать
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      {parsed.fatal ? (
        <div className="p-4 space-y-3">
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
        <div className="relative">
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
  )
}
