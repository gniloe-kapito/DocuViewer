'use client'

import * as React from 'react'
import { Copy, FileText, Hash, WrapText } from 'lucide-react'

import { Button } from '@/components/ui/button'
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

export function TextViewer({ file }: ViewerProps) {
  const text = React.useMemo(() => getText(file), [file])

  const [wrap, setWrap] = React.useState(true)
  const [showLineNumbers, setShowLineNumbers] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

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

  // ---- Empty file ----
  if (!text) {
    return (
      <div className="dv-scroll h-full overflow-auto">
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
    )
  }

  const contentClass = cn(
    'm-0 font-mono text-[13px] leading-[1.55]',
    wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
  )

  return (
    <div className="dv-scroll h-full overflow-auto">
      {/* Sticky toolbar: stats + actions */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          TXT
        </span>

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

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={wrap ? 'secondary' : 'ghost'}
            onClick={() => setWrap((w) => !w)}
            aria-pressed={wrap}
            title={wrap ? 'Выключить перенос строк' : 'Включить перенос строк'}
          >
            {wrap ? (
              <WrapText className="size-4" />
            ) : (
              <WrapText className="size-4 opacity-60" />
            )}
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

      {/* Body */}
      {showLineNumbers ? (
        <div
          className={cn(
            'font-mono text-[13px] leading-[1.55]',
            !wrap && 'min-w-max',
          )}
          role="presentation"
        >
          {linesArray.map((line, i) => (
            <div key={i} className="flex">
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
                {line}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <pre className={cn(contentClass, 'px-4 py-3')}>{text}</pre>
      )}
    </div>
  )
}
