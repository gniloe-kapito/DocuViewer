'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { FileText, ShieldCheck, Github, Loader2, Info, PanelsTopLeft } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { DropZone } from '@/components/drop-zone'
import { DocumentTabs } from '@/components/document-tabs'
import { FileMetadata } from '@/components/file-metadata'
import { HistoryPanel } from '@/components/history-panel'
import { UrlLoadDialog } from '@/components/url-load-dialog'
import { ViewerFrame } from '@/components/viewer-frame'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  fileToLoadedFile,
  urlToLoadedFile,
  revokeLoadedFile,
} from '@/lib/file-utils'
import { useHistoryStore } from '@/lib/history'
import type { LoadedFile } from '@/lib/viewers/types'
import { cn } from '@/lib/utils'

export default function Home() {
  const [files, setFiles] = React.useState<LoadedFile[]>([])
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [processing, setProcessing] = React.useState(false)
  const [showMeta, setShowMeta] = React.useState(true)

  const historyAdd = useHistoryStore((s) => s.add)
  const historyLoad = useHistoryStore((s) => s.load)

  React.useEffect(() => {
    historyLoad()
  }, [historyLoad])

  // Cleanup object URLs on unmount (snapshot current files via ref so this
  // effect only runs once without re-subscribing on every file change).
  const filesRef = React.useRef(files)
  filesRef.current = files
  React.useEffect(() => {
    return () => {
      filesRef.current.forEach(revokeLoadedFile)
    }
  }, [])

  const activeFile = React.useMemo(
    () => files.find((f) => f.id === activeId) ?? null,
    [files, activeId],
  )

  const ingestFiles = React.useCallback(
    async (incoming: FileList | File[]) => {
      const list = Array.from(incoming)
      if (list.length === 0) return
      setProcessing(true)
      try {
        const loaded: LoadedFile[] = []
        const errors: string[] = []
        for (const f of list) {
          try {
            const lf = await fileToLoadedFile(f)
            loaded.push(lf)
            historyAdd({
              id: lf.id,
              name: lf.name,
              size: lf.size,
              category: lf.category,
              extension: lf.extension,
              type: lf.type,
            })
          } catch (err) {
            errors.push(
              `${f.name}: ${err instanceof Error ? err.message : 'ошибка чтения'}`,
            )
          }
        }
        if (loaded.length > 0) {
          setFiles((prev) => {
            const next = [...prev, ...loaded]
            return next
          })
          setActiveId(loaded[loaded.length - 1].id)
          toast.success(
            loaded.length === 1
              ? `Открыт файл «${loaded[0].name}»`
              : `Открыто файлов: ${loaded.length}`,
          )
        }
        errors.forEach((e) => toast.error(e))
      } finally {
        setProcessing(false)
      }
    },
    [historyAdd],
  )

  const ingestUrl = React.useCallback(
    async (url: string) => {
      setProcessing(true)
      try {
        const lf = await urlToLoadedFile(url)
        setFiles((prev) => [...prev, lf])
        setActiveId(lf.id)
        historyAdd({
          id: lf.id,
          name: lf.name,
          size: lf.size,
          category: lf.category,
          extension: lf.extension,
          type: lf.type,
        })
        toast.success(`Открыт файл «${lf.name}»`)
      } finally {
        setProcessing(false)
      }
    },
    [historyAdd],
  )

  const closeFile = React.useCallback((id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id)
      if (target) revokeLoadedFile(target)
      const next = prev.filter((f) => f.id !== id)
      setActiveId((curr) => {
        if (curr !== id) return curr
        const idx = prev.findIndex((f) => f.id === id)
        const neighbor = next[idx] ?? next[idx - 1] ?? null
        return neighbor ? neighbor.id : null
      })
      return next
    })
  }, [])

  // Global paste handler (Ctrl+V) for files copied to clipboard
  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const fileItems: File[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const f = item.getAsFile()
          if (f) fileItems.push(f)
        }
      }
      if (fileItems.length > 0) {
        e.preventDefault()
        ingestFiles(fileItems)
        toast.info(
          fileItems.length === 1
            ? 'Файл вставлен из буфера обмена'
            : `Вставлено файлов: ${fileItems.length}`,
        )
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [ingestFiles])

  const hasFiles = files.length > 0

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-[1400px] px-3 sm:px-5 py-3 flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold leading-tight tracking-tight truncate">
                DocuViewer
              </h1>
              <p className="hidden sm:block text-[11px] text-muted-foreground leading-tight">
                Локальный просмотрщик документов
              </p>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <UrlLoadDialog onLoad={ingestUrl} />
            <HistoryPanel />
            <AboutDialog />
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer noopener"
              className="hidden sm:inline-flex"
              aria-label="GitHub"
            >
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Github className="h-4 w-4" />
              </Button>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 mx-auto w-full max-w-[1400px] px-3 sm:px-5 py-4 sm:py-6">
        {!hasFiles ? (
          <div className="flex flex-col items-center justify-center gap-6 py-6 sm:py-10">
            <div className="text-center max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                100% локально · файлы не покидают ваш браузер
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Откройте и просмотрите документ прямо в браузере
              </h2>
              <p className="text-sm sm:text-base text-muted-foreground">
                Поддержка PDF, DOCX, XLSX/CSV, PPTX, Markdown, JSON, изображений
                и RTF. Перетащите файл или выберите кнопкой — всё обрабатывается
                локально, файлы никуда не загружаются.
              </p>
            </div>
            <DropZone onFiles={ingestFiles} className="w-full max-w-2xl" />
            <FormatGrid />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Tabs row + compact add */}
            <DocumentTabs
              files={files}
              activeId={activeId}
              onSelect={setActiveId}
              onClose={closeFile}
              onAdd={() => {
                // open file picker
                const input = document.createElement('input')
                input.type = 'file'
                input.multiple = true
                input.onchange = () => {
                  if (input.files) ingestFiles(input.files)
                }
                input.click()
              }}
            />

            {/* Compact add-another dropzone */}
            <DropZone onFiles={ingestFiles} compact className="w-full" />

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => setShowMeta((s) => !s)}
              >
                <PanelsTopLeft className="h-3.5 w-3.5" />
                {showMeta ? 'Скрыть панель файла' : 'Показать панель файла'}
              </Button>
            </div>

            {/* Viewer + metadata */}
            {activeFile && (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px]">
                <section
                  className="min-h-[60vh] rounded-xl border border-border bg-card/40 overflow-hidden"
                  aria-label="Просмотр документа"
                >
                  <ViewerFrame file={activeFile} />
                </section>
                <aside
                  className={cn(
                    'rounded-xl border border-border bg-card/40 p-4 h-fit lg:sticky lg:top-[76px]',
                    !showMeta && 'hidden lg:block',
                  )}
                >
                  <FileMetadata file={activeFile} />
                </aside>
              </div>
            )}
          </div>
        )}

        {processing && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/50 backdrop-blur-sm pointer-events-none">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-xl pointer-events-auto">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm font-medium">Обработка файла…</span>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-background/80">
        <div className="mx-auto max-w-[1400px] px-3 sm:px-5 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span>
              Все файлы обрабатываются локально. Ничего не отправляется на сервер.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>Большие файлы могут обрабатываться медленно (клиентский парсинг).</span>
            <span className="hidden md:inline">·</span>
            <span className="hidden md:inline">PPTX — упрощённый рендер.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FormatGrid() {
  const formats: Array<{ label: string; ext: string; color: string }> = [
    { label: 'PDF', ext: 'pdf', color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
    { label: 'Word', ext: 'docx', color: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
    { label: 'Excel', ext: 'xlsx', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
    { label: 'PowerPoint', ext: 'pptx', color: 'bg-orange-500/15 text-orange-700 dark:text-orange-300' },
    { label: 'Markdown', ext: 'md', color: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
    { label: 'JSON', ext: 'json', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
    { label: 'Текст', ext: 'txt', color: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300' },
    { label: 'Изображения', ext: 'img', color: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' },
    { label: 'RTF', ext: 'rtf', color: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300' },
  ]
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 max-w-2xl">
      {formats.map((f) => (
        <div
          key={f.label}
          className={cn(
            'flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium',
            f.color,
          )}
        >
          <span>{f.label}</span>
          <span className="text-[10px] uppercase opacity-60">.{f.ext}</span>
        </div>
      ))}
    </div>
  )
}

function AboutDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="О приложении">
          <Info className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>О DocuViewer</DialogTitle>
          <DialogDescription>
            Полностью клиентский просмотрщик документов для приватного просмотра.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Приватность.</strong> Все файлы
            обрабатываются прямо в браузере. Ничего не отправляется на сервер —
            сайт можно разместить как статический (например, на GitHub Pages).
          </p>
          <p>
            <strong className="text-foreground">Поддерживаемые форматы.</strong>{' '}
            PDF (pdf.js), DOCX (docx-preview), XLSX/XLS/CSV (SheetJS), PPTX
            (извлечение текста/изображений по слайдам), TXT/Markdown
            (markdown-it + highlight.js), JSON, изображения и RTF.
          </p>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
            <p className="font-medium mb-1">⚠️ Ограничения</p>
            <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
              <li>Очень большие файлы обрабатываются медленно (весь парсинг — на стороне клиента).</li>
              <li>PPTX: анимации и переходы не воспроизводятся — упрощённый рендер.</li>
              <li>Файлы не сохраняются после закрытия вкладки (если не включена история в localStorage).</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
