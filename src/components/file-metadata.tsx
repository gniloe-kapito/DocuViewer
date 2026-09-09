'use client'

import * as React from 'react'
import { FileText, HardDrive, FileType2, CalendarClock, Hash } from 'lucide-react'
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type LoadedFile,
} from '@/lib/viewers/types'
import { formatBytes, formatDate } from '@/lib/file-utils'
import { cn } from '@/lib/utils'

export function FileMetadata({ file }: { file: LoadedFile }) {
  const rows: Array<{ icon: React.ReactNode; label: string; value: string }> = [
    {
      icon: <FileText className="h-4 w-4" />,
      label: 'Имя',
      value: file.name,
    },
    {
      icon: <HardDrive className="h-4 w-4" />,
      label: 'Размер',
      value: formatBytes(file.size),
    },
    {
      icon: <Hash className="h-4 w-4" />,
      label: 'Расширение',
      value: file.extension ? `.${file.extension}` : '—',
    },
    {
      icon: <FileType2 className="h-4 w-4" />,
      label: 'Тип (MIME)',
      value: file.type || 'не определён',
    },
    {
      icon: <CalendarClock className="h-4 w-4" />,
      label: 'Изменён',
      value: formatDate(file.lastModified),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
            CATEGORY_COLORS[file.category],
          )}
        >
          {CATEGORY_LABELS[file.category]}
        </span>
      </div>
      <dl className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 text-muted-foreground">{r.icon}</span>
            <div className="min-w-0 flex-1">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {r.label}
              </dt>
              <dd className="font-medium break-all leading-tight">{r.value}</dd>
            </div>
          </div>
        ))}
      </dl>
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
        Файл обрабатывается только в вашем браузере. Содержимое не отправляется
        на сервер и не покидает ваше устройство.
      </div>
    </div>
  )
}
