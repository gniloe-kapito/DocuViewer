'use client'

import * as React from 'react'
import { AlertCircle, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ViewerShell } from '@/components/viewer-shell'
import { useViewerUiStore } from '@/lib/viewer-ui-store'
import { cn } from '@/lib/utils'
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
  // Points at the centred box (boxW × boxH) that wraps the <img> so that
  // printing captures the image itself, not the scroll container.
  const printRootRef = React.useRef<HTMLDivElement>(null)

  /* «Night mode» — screen-only colour inversion of the picture (the same
   * global flag the PDF viewer uses). The print/export clone strips the
   * class, so printed/exported images keep their natural colours. */
  const nightMode = useViewerUiStore((s) => s.nightMode)
  const toggleNightMode = useViewerUiStore((s) => s.toggleNightMode)

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
  // Preserved pre-migration behaviour: reset restores 100% scale *and*
  // clears the rotation.
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
    <ViewerShell
      file={file}
      category="image"
      zoom={{
        value: Math.round(scale * 100),
        min: 10,
        max: 400,
        onZoomIn: zoomIn,
        onZoomOut: zoomOut,
        onReset: reset,
        isReset: scale === 1 && rotation === 0,
      }}
      rotate={{
        onRotateLeft: rotateLeft,
        onRotateRight: rotateRight,
      }}
      download={{ mode: 'original' }}
      printRootRef={printRootRef}
      toolbarEnd={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'size-8 text-muted-foreground',
            nightMode &&
              'bg-accent/70 text-accent-foreground hover:bg-accent',
          )}
          onClick={toggleNightMode}
          aria-pressed={nightMode}
          title={
            nightMode
              ? 'Выключить ночной режим (вернуть естественные цвета)'
              : 'Ночной режим — инверсия цветов изображения'
          }
          aria-label={
            nightMode ? 'Выключить ночной режим' : 'Включить ночной режим'
          }
        >
          {nightMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      }
      centerExtra={
        naturalSize ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {naturalSize.w} × {naturalSize.h} px
          </span>
        ) : null
      }
    >
      {/* Checkerboard scroll area */}
      <div
        ref={containerRef}
        className="dv-scroll h-full flex-1 overflow-auto"
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
            ref={printRootRef}
            className={cn(
              'flex items-center justify-center overflow-hidden',
              nightMode && 'dv-night',
            )}
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
    </ViewerShell>
  )
}
