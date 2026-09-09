'use client'

import * as React from 'react'
import { AlertCircle, Info, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
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

  if (error) {
    return (
      <div className="dv-scroll h-full overflow-auto flex flex-col">
        <div className="sticky top-0 z-10 bg-card/90 backdrop-blur border-b border-border">
          <div className="flex items-center gap-2 px-3 py-2 text-sm">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="font-medium text-destructive">Ошибка разбора RTF</span>
          </div>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            Не удалось разобрать документ. Показан исходный текст RTF.
          </p>
          <pre className="font-mono text-sm leading-relaxed p-4 rounded-md border border-border bg-muted/40 overflow-auto whitespace-pre-wrap break-words">
            {text}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="dv-scroll h-full overflow-auto flex flex-col">
      {/* Toolbar with simplified-rendering notice */}
      <div className="sticky top-0 z-10 bg-card/90 backdrop-blur border-b border-border">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <FileText className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" />
          <span className="text-sm font-medium">RTF документ</span>
          <span className="text-xs text-muted-foreground truncate max-w-[50ch]">
            {file.name}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <Info className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              Упрощённый просмотр RTF: базовое форматирование, сложные элементы могут не отображаться.
            </span>
            <span className="sm:hidden">Упрощённый просмотр</span>
          </span>
        </div>
      </div>

      {/* Rendered content */}
      <div className="w-full max-w-[800px] mx-auto px-4 py-6">
        {html ? (
          <div
            className="dv-prose"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Документ пуст или не содержит отображаемого текста.
          </p>
        )}
      </div>
    </div>
  )
}
