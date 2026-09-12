'use client'

import * as React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FileWarning,
  KeyRound,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { encryptForShare } from '@/lib/share/crypto'
import {
  KAPPA_MAX_FILE_SIZE,
  ShareUploadError,
  uploadEncryptedShare,
} from '@/lib/share/kappa'
import { buildShareLink } from '@/lib/share/link'
import type { ShareRecord } from '@/lib/history'
import type { LoadedFile } from '@/lib/viewers/types'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Step = 'confirm' | 'working' | 'success' | 'error'
type WorkPhase = 'encrypting' | 'uploading'

interface ShareDialogProps {
  /** The document being published (the active/pane file). */
  file: LoadedFile | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called on successful upload — the page writes the record into the
   *  local history store («Скопировать ссылку снова» / «Отозвать доступ»). */
  onShared?: (file: LoadedFile, share: ShareRecord) => void
}

/* ------------------------------------------------------------------ */
/*  The amber consent warning paragraphs                               */
/* ------------------------------------------------------------------ */

const WARNING_PARAGRAPHS: Array<{
  icon: React.ReactNode
  text: React.ReactNode
}> = [
  {
    icon: <ShieldCheck className="size-4 shrink-0" aria-hidden />,
    text: (
      <>
        Документ будет <strong>зашифрован прямо в вашем браузере</strong>, а
        затем зашифрованная копия будет загружена на сторонний публичный
        сервис kappa.lol — он не связан с DocuViewer и{' '}
        <strong>не сможет прочитать содержимое файла</strong>: сервис видит
        только нечитаемый зашифрованный набор байт.
      </>
    ),
  },
  {
    icon: <KeyRound className="size-4 shrink-0" aria-hidden />,
    text: (
      <>
        Ссылка, которую вы получите после подтверждения,{' '}
        <strong>содержит секретный ключ расшифровки</strong>. Любой человек, у
        которого окажется эта полная ссылка, сможет открыть и просмотреть
        документ — <strong>относитесь к ней как к паролю</strong>: не
        публикуйте её в открытых местах, если не хотите, чтобы документ
        увидели посторонние.
      </>
    ),
  },
  {
    icon: <FileWarning className="size-4 shrink-0" aria-hidden />,
    text: (
      <>
        kappa.lol — независимый сторонний сервис.{' '}
        <strong>Мы не можем гарантировать, что файл останется доступен вечно</strong>{' '}
        — он может быть удалён без предупреждения. Отозвать ссылку можно в
        любой момент из раздела «История», но{' '}
        <strong>только с этого же устройства и браузера</strong>, где вы её
        создали.
      </>
    ),
  },
]

/* ------------------------------------------------------------------ */
/*  ShareDialog                                                        */
/* ------------------------------------------------------------------ */

export function ShareDialog({
  file,
  open,
  onOpenChange,
  onShared,
}: ShareDialogProps) {
  const [step, setStep] = React.useState<Step>('confirm')
  const [phase, setPhase] = React.useState<WorkPhase>('encrypting')
  const [agreed, setAgreed] = React.useState(false)
  const [errorMsg, setErrorMsg] = React.useState('')
  const [result, setResult] = React.useState<{
    link: string
    fileName: string
  } | null>(null)
  const [copied, setCopied] = React.useState(false)
  const copiedTimer = React.useRef<number | null>(null)

  // EVERY open starts from the unchecked consent screen — the warning about
  // uploading to a third-party service must be consciously accepted each
  // time, never "remembered".
  React.useEffect(() => {
    if (open) {
      setStep('confirm')
      setPhase('encrypting')
      setAgreed(false)
      setErrorMsg('')
      setResult(null)
      setCopied(false)
    }
  }, [open])

  React.useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    }
  }, [])

  /** The consent screen and the in-flight phase cannot be dismissed by
   *  Esc / overlay click / the X button — only an explicit button choice
   *  closes them (the warning must never be "skipped past" accidentally). */
  const blockDismiss = step === 'confirm' || step === 'working'

  const startShare = React.useCallback(async () => {
    if (!file || !agreed) return
    if (file.size > KAPPA_MAX_FILE_SIZE) {
      setErrorMsg(
        `Документ (${Math.round(file.size / (1024 * 1024))} МБ) больше лимита kappa.lol в 100 МиБ — загрузка невозможна. Поделитесь файлом меньшего размера.`,
      )
      setStep('error')
      return
    }
    setStep('working')
    setPhase('encrypting')
    try {
      const encrypted = await encryptForShare(file)
      setPhase('uploading')
      const upload = await uploadEncryptedShare(encrypted.blob)
      const link = buildShareLink(upload.id, encrypted.key, encrypted.iv)
      const record: ShareRecord = {
        kappaId: upload.id,
        deleteKey: upload.deleteKey,
        link,
        sharedAt: Date.now(),
      }
      onShared?.(file, record)
      setResult({ link, fileName: file.name })
      setStep('success')
    } catch (err) {
      setErrorMsg(
        err instanceof ShareUploadError
          ? err.message
          : 'Не удалось зашифровать или загрузить документ. Проверьте подключение к интернету и попробуйте ещё раз.',
      )
      setStep('error')
    }
  }, [file, agreed, onShared])

  const copyLink = React.useCallback(async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.link)
      setCopied(true)
      toast.success('Ссылка скопирована в буфер обмена')
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Не удалось скопировать ссылку')
    }
  }, [result])

  const retry = React.useCallback(() => {
    setAgreed(false)
    setErrorMsg('')
    setStep('confirm')
  }, [])

  /* ---------------- render ---------------- */

  let content: React.ReactNode
  let footer: React.ReactNode

  if (step === 'confirm') {
    content = (
      <>
        <div className="flex items-start gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-amber-300/70 bg-amber-100 shadow-sm dark:border-amber-500/30 dark:bg-amber-400/15">
            <AlertTriangle
              className="size-6 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
          </span>
          <div className="min-w-0 space-y-1">
            <DialogTitle className="text-left text-lg font-bold leading-tight tracking-tight text-amber-950 dark:text-amber-100">
              Прежде чем поделиться
            </DialogTitle>
            <DialogDescription className="text-left break-words text-xs">
              Документ:{' '}
              <span className="font-medium text-amber-900/80 dark:text-amber-200/80">
                {file?.name ?? '—'}
              </span>
            </DialogDescription>
          </div>
        </div>

        <div className="space-y-3.5 rounded-lg border border-amber-200/80 bg-amber-50/70 p-3.5 text-[13px] leading-relaxed text-amber-950/90 dark:border-amber-600/40 dark:bg-amber-950/30 dark:text-amber-100/90">
          {WARNING_PARAGRAPHS.map((p, i) => (
            <p key={i} className="flex gap-2.5">
              <span className="mt-0.5 text-amber-600/80 dark:text-amber-400/80">
                {p.icon}
              </span>
              <span>{p.text}</span>
            </p>
          ))}
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-300/70 bg-amber-100/60 p-3 transition-colors hover:border-amber-400/80 dark:border-amber-600/50 dark:bg-amber-900/30 dark:hover:border-amber-500/60">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5 border-amber-400 data-[state=checked]:border-amber-600 data-[state=checked]:bg-amber-600 dark:data-[state=checked]:border-amber-600 dark:data-[state=checked]:bg-amber-600"
            aria-label="Я понимаю условия и согласен продолжить"
          />
          <span className="text-sm font-medium text-amber-950 dark:text-amber-100">
            Я понимаю условия и согласен продолжить
          </span>
        </label>
      </>
    )
    footer = (
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Отмена
        </Button>
        <Button
          type="button"
          disabled={!agreed}
          onClick={() => void startShare()}
          className="bg-amber-600 text-white shadow-sm hover:bg-amber-700 focus-visible:ring-amber-600/40"
        >
          Продолжить
        </Button>
      </DialogFooter>
    )
  } else if (step === 'working') {
    content = (
      <>
        <DialogTitle className="sr-only">Публикация документа</DialogTitle>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <span className="flex size-14 items-center justify-center rounded-full border border-amber-300/70 bg-amber-100 dark:border-amber-500/30 dark:bg-amber-400/15">
            <Loader2
              className="size-7 animate-spin text-amber-600 dark:text-amber-400"
              aria-hidden
            />
          </span>
          <div className="space-y-1.5">
            <p className="text-base font-semibold tracking-tight">
              {phase === 'encrypting'
                ? 'Шифрование документа…'
                : 'Загрузка зашифрованной копии на kappa.lol…'}
            </p>
            <p className="text-sm text-muted-foreground">
              {phase === 'encrypting'
                ? 'Ключ шифрования создаётся прямо в вашем браузере и попадёт только в ссылку.'
                : 'Сервис получит только нечитаемый набор байт — без имени, типа и содержимого.'}
            </p>
            <p className="text-xs text-muted-foreground/80">
              Не закрывайте это окно до завершения.
            </p>
          </div>
        </div>
      </>
    )
    footer = null
  } else if (step === 'success' && result) {
    content = (
      <>
        <DialogTitle className="sr-only">Ссылка готова</DialogTitle>
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2
            className="size-11 text-emerald-500"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="text-lg font-bold tracking-tight">Ссылка готова</p>
            <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
              Документ{' '}
              <span className="font-medium text-foreground">
                {result.fileName}
              </span>{' '}
              зашифрован и загружен. Любой, у кого есть полная ссылка, сможет
              открыть его в DocuViewer.
            </p>
          </div>

          {/* QR — generated LOCALLY (qrcode.react, pure SVG): the link with
              the secret key never touches any third-party QR API. */}
          <div className="rounded-xl border border-border bg-white p-3 shadow-sm dark:bg-white">
            <QRCodeSVG
              value={result.link}
              size={164}
              marginSize={0}
              fgColor="#1e293b"
              bgColor="#ffffff"
              aria-label="QR-код со ссылкой на документ"
            />
          </div>

          <div className="flex w-full max-w-md items-center gap-2">
            <Input
              readOnly
              value={result.link}
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 font-mono text-xs"
              aria-label="Ссылка на документ"
            />
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0 gap-1.5"
              onClick={() => void copyLink()}
            >
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              {copied ? 'Скопировано' : 'Скопировать'}
            </Button>
          </div>

          <p className="flex max-w-sm items-start gap-1.5 text-left text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck
              className="mt-0.5 size-3.5 shrink-0 text-emerald-500"
              aria-hidden
            />
            Эта ссылка больше нигде не сохраняется, кроме вашей локальной
            истории на этом устройстве.
          </p>
        </div>
      </>
    )
    footer = (
      <DialogFooter className="sm:justify-center">
        <Button type="button" onClick={() => onOpenChange(false)}>
          Готово
        </Button>
      </DialogFooter>
    )
  } else {
    // step === 'error'
    content = (
      <>
        <DialogTitle className="sr-only">Не удалось поделиться</DialogTitle>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
            <AlertTriangle
              className="size-6 text-destructive"
              aria-hidden
            />
          </span>
          <div className="space-y-1.5">
            <p className="text-lg font-bold tracking-tight">
              Не удалось поделиться
            </p>
            <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
              {errorMsg}
            </p>
          </div>
        </div>
      </>
    )
    footer = (
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Закрыть
        </Button>
        <Button type="button" onClick={retry}>
          Попробовать снова
        </Button>
      </DialogFooter>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={!blockDismiss}
        onEscapeKeyDown={(e) => {
          if (blockDismiss) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (blockDismiss) e.preventDefault()
        }}
        className={cnStep(step)}
      >
        {content}
        {footer}
      </DialogContent>
    </Dialog>
  )
}

/** Amber chrome for the consent screen; neutral for the rest. */
function cnStep(step: Step): string {
  if (step === 'confirm') {
    return 'sm:max-w-lg border-amber-300/80 bg-amber-50/95 backdrop-blur dark:border-amber-600/50 dark:bg-amber-950/50'
  }
  if (step === 'working') {
    return 'sm:max-w-md border-amber-300/60 dark:border-amber-600/40'
  }
  return 'sm:max-w-md'
}
