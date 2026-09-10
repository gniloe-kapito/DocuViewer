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

  const supported = getSupportedExtensions()
    .slice(0, 12)
    .join(', ')

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
        'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-card/40 text-center transition-all duration-200',
        dragActive
          ? 'dv-drop-pulse border-primary bg-primary/10 scale-[1.01] shadow-lg'
          : 'border-border hover:border-primary/60 hover:bg-card/70',
        compact ? 'p-6' : 'p-8 sm:p-12 lg:p-16',
        className,
      )}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
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
      <div
        className={cn(
          'flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 transition-transform',
          dragActive && 'scale-110',
        )}
      >
        <UploadCloud className="h-8 w-8 sm:h-10 sm:w-10" />
      </div>
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
        Перетащите документы сюда
      </h2>
      <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-md">
        или нажмите кнопку ниже, чтобы выбрать файлы. Всё обрабатывается локально
        в вашем браузере — файлы никуда не загружаются.
      </p>
      <Button
        type="button"
        size="lg"
        className="mt-5"
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
      <p className="mt-5 text-xs text-muted-foreground/80">
        Поддерживаемые форматы: <span className="font-mono">{supported}</span>…
      </p>
    </div>
  )
}
