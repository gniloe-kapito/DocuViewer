'use client'

import * as React from 'react'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { Copy, Eye, Code2, FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { LoadedFile } from '@/lib/viewers/types'

interface ViewerProps {
  file: LoadedFile
}

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
let mdInstance: MarkdownIt | null = null
function getMarkdownIt(): MarkdownIt {
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
            ignoreIllegal: true,
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
      <div className="dv-scroll h-full overflow-auto">
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
    )
  }

  return (
    <div className="dv-scroll h-full overflow-auto">
      {/* Sticky toolbar: Источник / Превью toggle + copy HTML */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          MD
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={mode === 'preview' ? 'secondary' : 'ghost'}
            onClick={() => setMode('preview')}
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
            onClick={() => setMode('source')}
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

      {/* Body */}
      {mode === 'preview' ? (
        <div className="mx-auto max-w-[800px] px-4 py-6">
          {rendered ? (
            <div
              className="dv-prose"
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Не удалось отрисовать содержимое.
            </p>
          )}
        </div>
      ) : (
        <div className="mx-auto max-w-[800px] px-4 py-6">
          <pre className="m-0 whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-4 font-mono text-[13px] leading-[1.55]">
            {text}
          </pre>
        </div>
      )}
    </div>
  )
}
