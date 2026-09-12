'use client'

import * as React from 'react'
import { History, Trash2, X, FileClock, Share2, Copy, Link2Off, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useHistoryStore, type HistoryEntry } from '@/lib/history'
import { CATEGORY_COLORS } from '@/lib/viewers/types'
import { formatBytes, formatDate } from '@/lib/file-utils'
import { revokeKappaShare } from '@/lib/share/kappa'
import { cn } from '@/lib/utils'

interface HistoryPanelProps {
  trigger?: React.ReactNode
}

export function HistoryPanel({ trigger }: HistoryPanelProps) {
  const { entries, loaded, load, remove, clear, unmarkShared } = useHistoryStore()
  const [open, setOpen] = React.useState(false)
  /** Id of the entry whose share revocation is in flight (spinner). */
  const [revokingId, setRevokingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    load()
  }, [load])

  /** «Скопировать ссылку снова» — the stored link includes the secret key
   *  fragment; it lives only in THIS browser's localStorage. */
  const copyShareLink = React.useCallback(async (entry: HistoryEntry) => {
    if (!entry.share) return
    try {
      await navigator.clipboard.writeText(entry.share.link)
      toast.success('Ссылка скопирована')
    } catch {
      toast.error('Не удалось скопировать ссылку')
    }
  }, [])

  /** «Отозвать доступ» — deletes the encrypted blob on kappa.lol with the
   *  locally stored delete key. On success the publication mark is removed
   *  (the local file record itself is kept). */
  const revokeShare = React.useCallback(
    async (entry: HistoryEntry) => {
      if (!entry.share || revokingId) return
      setRevokingId(entry.id)
      try {
        const ok = await revokeKappaShare(entry.share.deleteKey)
        if (ok) {
          unmarkShared(entry.id)
          toast.success('Доступ отозван, файл удалён с сервера')
        } else {
          toast.error(
            'Не удалось отозвать доступ — сервис kappa.lol ответил ошибкой. Попробуйте позже.',
          )
        }
      } catch {
        toast.error('Не удалось связаться с kappa.lol — проверьте подключение.')
      } finally {
        setRevokingId(null)
      }
    },
    [revokingId, unmarkShared],
  )

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">История</span>
            {entries.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                {entries.length}
              </span>
            )}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-4 pt-5 pb-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <FileClock className="h-5 w-5 text-primary" />
            История просмотров
          </SheetTitle>
          <SheetDescription>
            Список последних открытых файлов. Хранится только локально в вашем
            браузере (localStorage).
          </SheetDescription>
        </SheetHeader>
        <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground border-b border-border">
          <span>Записей: {entries.length}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-destructive hover:text-destructive"
            disabled={entries.length === 0}
            onClick={clear}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Очистить
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="px-2 py-2">
            {!loaded ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Загрузка…
              </div>
            ) : entries.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                История пуста. Откройте файл — он появится здесь.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {entries.map((entry: HistoryEntry) => (
                  <li
                    key={entry.id}
                    className="group flex items-start gap-3 rounded-lg border border-border bg-card/50 p-2.5 hover:bg-accent/40 transition-colors"
                  >
                    <span
                      className={cn(
                        'mt-0.5 inline-flex h-7 w-10 shrink-0 items-center justify-center rounded text-[10px] font-bold uppercase border',
                        CATEGORY_COLORS[entry.category as keyof typeof CATEGORY_COLORS] ??
                          CATEGORY_COLORS.unknown,
                      )}
                    >
                      {entry.extension.slice(0, 4) || 'FILE'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="flex items-center gap-1.5 truncate text-sm font-medium"
                        title={entry.name}
                      >
                        <span className="truncate">{entry.name}</span>
                        {entry.share && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                            title={`Документ опубликован — ${formatDate(entry.share.sharedAt)}`}
                          >
                            <Share2 className="size-2.5" aria-hidden />
                            ссылка
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatBytes(entry.size)} · {formatDate(entry.openedAt)}
                      </p>
                      {entry.share && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            className="inline-flex h-6 items-center gap-1 rounded-md border border-primary/40 px-2 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                            onClick={() => void copyShareLink(entry)}
                            title="Скопировать ссылку на опубликованный документ"
                          >
                            <Copy className="size-3" aria-hidden />
                            Скопировать ссылку снова
                          </button>
                          <button
                            type="button"
                            disabled={revokingId === entry.id}
                            className="inline-flex h-6 items-center gap-1 rounded-md border border-destructive/40 px-2 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                            onClick={() => void revokeShare(entry)}
                            title="Удалить файл с сервера kappa.lol — ссылка перестанет открываться"
                          >
                            {revokingId === entry.id ? (
                              <Loader2 className="size-3 animate-spin" aria-hidden />
                            ) : (
                              <Link2Off className="size-3" aria-hidden />
                            )}
                            Отозвать доступ
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Удалить ${entry.name} из истории`}
                      className="shrink-0 rounded p-1 text-muted-foreground/70 hover:bg-destructive/15 hover:text-destructive opacity-0 group-hover:opacity-100"
                      onClick={() => remove(entry.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
