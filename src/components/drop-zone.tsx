'use client'

import * as React from 'react'
import { UploadCloud, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSupportedExtensions } from '@/lib/viewers/registry'

interface DropZoneProps {
  onFiles: (files: FileList | File[]) => void
  compact?: boolean
  className?: string
}

export function DropZone({ onFiles, compact = false, className }: DropZoneProps) {
  const [dragActive, setDragActive] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleDrag = React.useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      // only deactivate when leaving the container itself
      if (e.currentTarget === e.target) setDragActive(false)
    }
  }, [])

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onFiles(e.dataTransfer.files)
      }
    },
    [onFiles],
  )

  const handlePick = React.useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onFiles(e.target.files)
      }
      // reset so the same file can be selected again
      e.target.value = ''
    },
    [onFiles],
  )

  if (compact) {
    return (
      <div
        className={cn(
          'relative flex items-center gap-3 rounded-lg border-2 border-dashed border-border bg-card/50 px-4 py-3 transition-colors',
          dragActive && 'border-primary bg-primary/5',
          className,
        )}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <UploadCloud className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground flex-1 truncate">
          Перетащите файлы сюда, чтобы открыть в новой вкладке
        </span>
        <Button type="button" size="sm" variant="outline" onClick={handlePick}>
          <FolderOpen className="h-4 w-4 mr-1.5" />
          Добавить
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleChange}
          accept={getSupportedExtensions().map((e) => '.' + e).join(',')}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'dv-dropzone group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl text-center transition-[border-color,background-color,box-shadow] duration-300',
        compact ? 'p-6' : 'p-8 sm:p-12 lg:p-14',
        className,
      )}
      data-drag={dragActive ? 'true' : undefined}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      aria-label="Перетащите документы или выберите файл"
      onClick={handlePick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handlePick()
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleChange}
        accept={getSupportedExtensions().map((e) => '.' + e).join(',')}
      />

      {/* Soft accent halo — invisible until hover, full glow while a file
          hovers over the zone. Pure decoration, no layout impact. */}
      <div className="dv-drop-halo" aria-hidden="true" />

      {/* Product mark: a stack of documents (NOT a stock "upload to cloud"
          glyph). The three sheets fan out and straighten while dragging —
          the zone itself "reaches" for the file. */}
      <svg
        className="dv-doc-stack mb-5 h-14 w-14 sm:h-16 sm:w-16"
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="dv-drop-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="oklch(0.62 0.16 162)" />
            <stop offset="1" stopColor="oklch(0.74 0.17 60)" />
          </linearGradient>
        </defs>
        <rect className="dv-sheet dv-sheet-back" x="10" y="6" width="30" height="42" rx="3.5" />
        <rect className="dv-sheet dv-sheet-mid" x="16" y="10" width="30" height="42" rx="3.5" />
        <g className="dv-sheet dv-sheet-front">
          <path d="M26.5 14 H44 L54 24 V52.5 A3.5 3.5 0 0 1 50.5 56 H26.5 A3.5 3.5 0 0 1 23 52.5 V17.5 A3.5 3.5 0 0 1 26.5 14 Z" />
          <path className="dv-sheet-fold" d="M44 14 V20.5 A3.5 3.5 0 0 0 47.5 24 H54" />
          <rect className="dv-sheet-line dv-sheet-line-a" x="29" y="30" width="19" height="3.5" rx="1.75" />
          <rect className="dv-sheet-line" x="29" y="38" width="14" height="3.5" rx="1.75" />
          <rect className="dv-sheet-line" x="29" y="46" width="17" height="3.5" rx="1.75" />
        </g>
      </svg>

      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
        Перетащите документы сюда
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground sm:text-base">
        или выберите файл на компьютере — он откроется сразу, без загрузки
        куда-либо
      </p>
      <Button
        type="button"
        size="lg"
        className="dv-cta mt-6"
        onClick={(e) => {
          // Stop propagation so the outer dropzone div doesn't ALSO fire
          // handlePick (which would double-open the dialog in some browsers).
          // We must call handlePick ourselves here — previously stopPropagation
          // alone silently swallowed the click and the dialog never opened.
          e.stopPropagation()
          handlePick()
        }}
      >
        <FolderOpen className="h-4 w-4 mr-2" />
        Выбрать файл
      </Button>
      {/* The ONE shortcut worth advertising (Ctrl+O really works globally).
          Plain small text — not a row of kbd plaques. */}
      <p className="mt-4 text-[11px] text-muted-foreground/70">
        или нажмите Ctrl + O
      </p>
    </div>
  )
}
