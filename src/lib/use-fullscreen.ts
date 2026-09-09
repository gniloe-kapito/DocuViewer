'use client'

import * as React from 'react'

/**
 * Fullscreen API helper for viewer containers.
 *
 * Tracks the document's fullscreen state and exposes a `toggle` that targets
 * a specific element (the viewer root). Returns `isFullscreen` so callers can
 * render an appropriate icon / label. Falls back gracefully when the API is
 * unavailable (e.g. sandboxed iframes without `allow-fullscreen`).
 */
export function useFullscreen(
  targetRef: React.RefObject<HTMLElement | null>,
): {
  isFullscreen: boolean
  toggle: () => void
  supported: boolean
} {
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  const supported = React.useMemo(() => {
    if (typeof document === 'undefined') return false
    return (
      typeof document.fullscreenElement !== 'undefined' ||
      // older Safari / prefixed
      typeof (document as Document & { webkitFullscreenElement?: unknown })
        .webkitFullscreenElement !== 'undefined'
    )
  }, [])

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const handler = () => {
      const fs =
        document.fullscreenElement ??
        (document as Document & { webkitFullscreenElement?: Element | null })
          .webkitFullscreenElement ??
        null
      setIsFullscreen(!!fs && fs === targetRef.current)
    }
    document.addEventListener('fullscreenchange', handler)
    document.addEventListener('webkitfullscreenchange', handler as EventListener)
    return () => {
      document.removeEventListener('fullscreenchange', handler)
      document.removeEventListener(
        'webkitfullscreenchange',
        handler as EventListener,
      )
    }
  }, [targetRef])

  const toggle = React.useCallback(() => {
    if (typeof document === 'undefined') return
    const el = targetRef.current
    if (!el) return
    const exit = document.exitFullscreen ? document.exitFullscreen.bind(document) : undefined
    const webkitExit = (document as Document & { webkitExitFullscreen?: () => void }).webkitExitFullscreen
    const request = () => {
      const r = el.requestFullscreen ? el.requestFullscreen.bind(el) : null
      const wr = (el as HTMLElement & { webkitRequestFullscreen?: () => void })
        .webkitRequestFullscreen
      if (r) void r.call(el).catch(() => {})
      else if (wr) wr.call(el)
    }
    const inFs =
      document.fullscreenElement ??
      (document as Document & { webkitFullscreenElement?: Element | null })
        .webkitFullscreenElement
    if (inFs) {
      if (exit) void exit()
      else if (webkitExit) webkitExit()
    } else {
      request()
    }
  }, [targetRef])

  return { isFullscreen, toggle, supported }
}
