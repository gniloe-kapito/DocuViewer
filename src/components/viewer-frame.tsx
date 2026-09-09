'use client'

import * as React from 'react'
import { AlertTriangle, FileQuestion, Loader2 } from 'lucide-react'
import { VIEWER_REGISTRY } from '@/lib/viewers/registry'
import type { LoadedFile } from '@/lib/viewers/types'
import { CATEGORY_LABELS } from '@/lib/viewers/types'

interface ViewerFrameProps {
  file: LoadedFile
}

interface ErrorBoundaryState {
  error: Error | null
}

class ViewerErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void; fileName: string },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidUpdate(_prev: unknown, prevState: ErrorBoundaryState) {
    if (prevState.error && !this.state.error) {
      // recovered
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <h3 className="text-lg font-semibold">Ошибка при отображении файла</h3>
          <p className="text-sm text-muted-foreground max-w-md break-words">
            Файл <span className="font-mono">{this.props.fileName}</span> не
            удалось открыть. Возможно, файл повреждён или имеет неподдерживаемую
            структуру.
          </p>
          <pre className="mt-2 max-w-full overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

export function ViewerFrame({ file }: ViewerFrameProps) {
  if (file.category === 'unknown') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <FileQuestion className="h-10 w-10 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Неподдерживаемый формат</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Файл <span className="font-mono">{file.name}</span> не может быть
          открыт. DocuViewer не умеет отображать этот тип файлов.
        </p>
        <p className="text-xs text-muted-foreground/80">
          Поддерживаются: PDF, DOCX, XLSX/XLS/CSV, PPTX, TXT, Markdown, JSON,
          изображения (JPG, PNG, GIF, WebP, SVG, BMP), RTF.
        </p>
      </div>
    )
  }

  // Legacy .doc / .ppt are not truly supported by the client libraries.
  if (
    (file.category === 'docx' && file.extension === 'doc') ||
    (file.category === 'pptx' && file.extension === 'ppt')
  ) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <h3 className="text-lg font-semibold">
          Формат .{file.extension} не поддерживается
        </h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Старые бинарные форматы Office (.doc, .ppt) не обрабатываются на
          стороне клиента. Сохраните файл в современном формате (.docx, .pptx)
          и откройте снова.
        </p>
      </div>
    )
  }

  const Viewer = VIEWER_REGISTRY[file.category]
  if (!Viewer) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Загрузка модуля просмотра ({CATEGORY_LABELS[file.category]})…
        </p>
      </div>
    )
  }

  return (
    <ViewerErrorBoundary fileName={file.name} onReset={() => {}}>
      <Viewer file={file} />
    </ViewerErrorBoundary>
  )
}
