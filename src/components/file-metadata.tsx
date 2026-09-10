'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  CalendarClock,
  Check,
  Copy,
  FileCog,
  FileText,
  FileType2,
  HardDrive,
  Hash,
  Lock,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type LoadedFile,
} from '@/lib/viewers/types'
import { formatBytes, formatDate } from '@/lib/file-utils'
import { cn } from '@/lib/utils'

export function FileMetadata({ file }: { file: LoadedFile }) {
  const [copied, setCopied] = React.useState(false)
  /** Which row's value was just copied (row label), null = none. */
  const [copiedField, setCopiedField] = React.useState<string | null>(null)
  const fieldTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (fieldTimer.current) clearTimeout(fieldTimer.current)
    },
    [],
  )

  const copyValue = React.useCallback(
    async (value: string, label: string) => {
      try {
        await navigator.clipboard.writeText(value)
        setCopiedField(label)
        if (fieldTimer.current) clearTimeout(fieldTimer.current)
        fieldTimer.current = setTimeout(() => setCopiedField(null), 1600)
      } catch {
        toast.error(`Не удалось скопировать «${label}»`)
      }
    },
    [],
  )

  const copyName = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(file.name)
      setCopied(true)
      toast.success('Имя файла скопировано')
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error('Не удалось скопировать имя файла')
    }
  }, [file.name])

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
    <div className="space-y-3.5">
      {/* Panel header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground">
            <FileCog className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">
              Свойства файла
            </h3>
            <p className="truncate text-[11px] text-muted-foreground leading-tight">
              Метаданные открытого документа
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          onClick={copyName}
          aria-label="Скопировать имя файла"
          title="Скопировать имя файла"
        >
          {copied ? (
            <Check className="size-4 text-emerald-500" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
      </div>

      {/* Category badge */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[file.category]}`}
        >
          {CATEGORY_LABELS[file.category]}
        </span>
      </div>

      {/* Fields — each value is copyable (icon appears on row hover). */}
      <dl className="divide-y divide-border/70">
        {rows.map((r) => {
          const justCopied = copiedField === r.label
          return (
            <div
              key={r.label}
              className="group/field flex items-start gap-2.5 py-2 first:pt-1 last:pb-0"
            >
              <span className="mt-0.5 shrink-0 text-muted-foreground/80">
                {r.icon}
              </span>
              <div className="min-w-0 flex-1">
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {r.label}
                </dt>
                <dd className="text-sm font-medium break-all leading-snug">
                  {r.value}
                </dd>
              </div>
              <button
                type="button"
                className={cn(
                  'mt-0.5 shrink-0 rounded p-1 text-muted-foreground/70',
                  'opacity-0 transition-opacity hover:bg-accent hover:text-foreground',
                  'focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
                  'group-hover/field:opacity-100',
                  justCopied && 'opacity-100 text-emerald-500 hover:text-emerald-500',
                )}
                onClick={() => void copyValue(r.value, r.label)}
                aria-label={`Скопировать: ${r.label}`}
                title={`Скопировать: ${r.label}`}
              >
                {justCopied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </div>
          )
        })}
      </dl>

      {/* Privacy note */}
      <div className="flex gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-3 text-[11px] leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span>
          Файл обрабатывается только в вашем браузере. Содержимое не
          отправляется на сервер и не покидает ваше устройство.
        </span>
      </div>
    </div>
  )
}
