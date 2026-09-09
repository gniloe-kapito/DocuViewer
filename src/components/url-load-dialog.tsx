'use client'

import * as React from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

interface UrlLoadDialogProps {
  onLoad: (url: string) => Promise<void>
  trigger?: React.ReactNode
}

export function UrlLoadDialog({ onLoad, trigger }: UrlLoadDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const handleLoad = React.useCallback(async () => {
    const trimmed = url.trim()
    if (!trimmed) {
      toast.error('Введите URL файла')
      return
    }
    try {
      new URL(trimmed)
    } catch {
      toast.error('Некорректный URL')
      return
    }
    setLoading(true)
    try {
      await onLoad(trimmed)
      setOpen(false)
      setUrl('')
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Не удалось загрузить файл по URL',
      )
    } finally {
      setLoading(false)
    }
  }, [url, onLoad])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Link2 className="h-4 w-4" />
            <span className="hidden sm:inline">Открыть по URL</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Открыть документ по URL</DialogTitle>
          <DialogDescription>
            Файл будет загружен напрямую в ваш браузер и обработан локально.
            Убедитесь, что URL поддерживает CORS (прямые ссылки на raw-файлы).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="url-input">URL файла</Label>
          <Input
            id="url-input"
            type="url"
            inputMode="url"
            placeholder="https://example.com/document.pdf"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) {
                e.preventDefault()
                handleLoad()
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            Отмена
          </Button>
          <Button onClick={handleLoad} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Загрузка…
              </>
            ) : (
              'Загрузить'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
