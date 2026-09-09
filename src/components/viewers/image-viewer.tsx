'use client'

import * as React from 'react'
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  Maximize,
  AlertCircle,
  ImageIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { LoadedFile } from '@/lib/viewers/types'

interface ViewerProps {
  file: LoadedFile
}

const MIN_SCALE = 0.1
const MAX_SCALE = 4
const clampScale = (s: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 100) / 100))

export function ImageViewer({ file }: ViewerProps) {
  const [scale, setScale] = React.useState(1)
  const [rotation, setRotation] = React.useState(0)
  const [naturalSize, setNaturalSize] = React.useState<{ w: number; h: number } | null>(null)
  const [errored, setErrored] = React.useState(false)

  const containerRef = React.useRef<HTMLDivElement>(null)
  const imgRef = React.useRef<HTMLImageElement>(null)

  // Reset transient state when the source changes.
  React.useEffect(() => {
    setScale(1)
    setRotation(0)
    setNaturalSize(null)
    setErrored(false)
  }, [file.url])

  const handleLoad = () => {
    const img = imgRef.current
    const container = containerRef.current
    if (!img) return
    const w = img.naturalWidth
    const h = img.naturalHeight
    setNaturalSize({ w, h })

    // Fit-to-container initial scale (never upscale beyond 100%).
    if (container && w > 0 && h > 0) {
      const cw = container.clientWidth
      const ch = container.clientHeight
      if (cw > 0 && ch > 0) {
        const fit = Math.min(cw / w, ch / h, 1)
        if (Number.isFinite(fit) && fit > 0) {
          setScale(clampScale(fit))
        }
      }
    }
  }

  const handleError = () => {
    setErrored(true)
    toast.error('Не удалось загрузить изображение')
  }

  const zoomIn = () => setScale((s) => clampScale(s + 0.1))
  const zoomOut = () => setScale((s) => clampScale(s - 0.1))
  const reset = () => {
    setScale(1)
    setRotation(0)
  }
  const rotateLeft = () => setRotation((r) => r - 90)
  const rotateRight = () => setRotation((r) => r + 90)

  const naturalW = naturalSize?.w ?? 0
  const naturalH = naturalSize?.h ?? 0
  const scaledW = naturalW * scale
  const scaledH = naturalH * scale

  // Bounding box of the rotated+scaled image — this is what the wrapper must
  // occupy so the scroll container knows how much to scroll.
  const isQuarter = Math.abs(Math.round(rotation / 90) % 2) === 1
  const boxW = isQuarter ? scaledH : scaledW
  const boxH = isQuarter ? scaledW : scaledH

  return (
    <div className="dv-scroll h-full overflow-auto flex flex-col">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-card/90 backdrop-blur border-b border-border">
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          <Button
            variant="outline"
            size="icon"
            onClick={zoomOut}
            title="Уменьшить"
            aria-label="Уменьшить"
            disabled={scale <= MIN_SCALE}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span
            className="text-sm tabular-nums min-w-[3.5rem] text-center select-none"
            aria-live="polite"
          >
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={zoomIn}
            title="Увеличить"
            aria-label="Увеличить"
            disabled={scale >= MAX_SCALE}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            title="Сбросить масштаб и поворот"
          >
            <Maximize className="h-4 w-4" />
            100%
          </Button>

          <div className="mx-1 h-5 w-px bg-border" />

          <Button
            variant="outline"
            size="icon"
            onClick={rotateLeft}
            title="Повернуть влево на 90°"
            aria-label="Повернуть влево"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={rotateRight}
            title="Повернуть вправо на 90°"
            aria-label="Повернуть вправо"
          >
            <RotateCw className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-5 w-px bg-border" />

          {naturalSize ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {naturalSize.w} × {naturalSize.h} px
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">загрузка…</span>
          )}

          <span
            className="ml-auto text-xs text-muted-foreground truncate max-w-[40ch]"
            title={file.name}
          >
            {file.name}
          </span>
        </div>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{
          backgroundColor: 'var(--muted)',
          backgroundImage:
            'linear-gradient(45deg, color-mix(in oklch, var(--foreground) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in oklch, var(--foreground) 6%, transparent) 75%), linear-gradient(45deg, color-mix(in oklch, var(--foreground) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in oklch, var(--foreground) 6%, transparent) 75%)',
          backgroundSize: '24px 24px',
          backgroundPosition: '0 0, 12px 12px',
        }}
      >
        {errored ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground p-8 text-center">
            <AlertCircle className="h-10 w-10" />
            <p className="text-sm">Не удалось отобразить изображение.</p>
            <p className="text-xs">{file.name}</p>
          </div>
        ) : (
          <div
            className="flex items-center justify-center overflow-hidden"
            style={{
              width: boxW || '100%',
              height: boxH || '100%',
              minWidth: '100%',
              minHeight: '100%',
            }}
          >
            <img
              ref={imgRef}
              src={file.url}
              alt={file.name}
              onLoad={handleLoad}
              onError={handleError}
              draggable={false}
              className="select-none max-w-none"
              style={{
                // Per spec: scale via transform. The wrapper around the img
                // is sized to the rotated+scaled bounding box (boxW × boxH)
                // and has `overflow: hidden`, so the container's scroll area
                // matches the visual size of the image even though CSS
                // transforms do not affect layout.
                transform: `scale(${scale}) rotate(${rotation}deg)`,
                transformOrigin: 'center center',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
