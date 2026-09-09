'use client'

import * as React from 'react'
import { X, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type LoadedFile,
} from '@/lib/viewers/types'
import { formatBytes } from '@/lib/file-utils'

interface DocumentTabsProps {
  files: LoadedFile[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
}

const CAT_ICON: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOC',
  xlsx: 'XLS',
  pptx: 'PPT',
  text: 'TXT',
  markdown: 'MD',
  json: '{}',
  image: 'IMG',
  rtf: 'RTF',
  unknown: '?',
}

export function DocumentTabs({
  files,
  activeId,
  onSelect,
  onClose,
  onAdd,
}: DocumentTabsProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
      {files.map((file) => {
        const active = file.id === activeId
        return (
          <div
            key={file.id}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            onClick={() => onSelect(file.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(file.id)
              }
            }}
            className={cn(
              'group flex shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 cursor-pointer transition-colors max-w-[220px] sm:max-w-[260px]',
              active
                ? 'bg-card text-card-foreground border-border'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted border-transparent',
            )}
          >
            <span
              className={cn(
                'flex h-6 w-9 shrink-0 items-center justify-center rounded text-[10px] font-bold tracking-tight border',
                CATEGORY_COLORS[file.category],
              )}
            >
              {CAT_ICON[file.category] ?? 'FILE'}
            </span>
            <span className="flex flex-col min-w-0">
              <span
                className="truncate text-xs sm:text-sm font-medium leading-tight"
                title={file.name}
              >
                {file.name}
              </span>
              <span className="text-[10px] text-muted-foreground/80 leading-tight">
                {formatBytes(file.size)}
              </span>
            </span>
            <button
              type="button"
              aria-label={`Закрыть ${file.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onClose(file.id)
              }}
              className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground/70 opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 h-9 px-2 text-muted-foreground"
        onClick={onAdd}
        aria-label="Открыть ещё файл"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
