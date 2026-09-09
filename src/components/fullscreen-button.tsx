'use client'

import * as React from 'react'
import { Maximize, Minimize } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface FullscreenButtonProps {
  isFullscreen: boolean
  onToggle: () => void
  disabled?: boolean
  className?: string
}

/**
 * A small toolbar button that toggles fullscreen for its viewer container.
 * Shows a Maximize icon when windowed and a Minimize icon when fullscreen.
 */
export function FullscreenButton({
  isFullscreen,
  onToggle,
  disabled,
  className,
}: FullscreenButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={isFullscreen}
      title={isFullscreen ? 'Выйти из полноэкранного режима (Esc)' : 'На весь экран'}
      className={cn('gap-1.5', className)}
    >
      {isFullscreen ? (
        <Minimize className="size-4" />
      ) : (
        <Maximize className="size-4" />
      )}
      <span className="hidden sm:inline">
        {isFullscreen ? 'Свернуть' : 'На весь экран'}
      </span>
    </Button>
  )
}
