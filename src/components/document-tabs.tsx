'use client'

import * as React from 'react'
import { ListX, X, Plus, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type LoadedFile,
} from '@/lib/viewers/types'
import { formatBytes } from '@/lib/file-utils'

interface DocumentTabsProps {
  files: LoadedFile[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
  /** Closes every open tab (menu item, shown when 2+ files are open). */
  onCloseAll?: () => void
  /** Closes every tab except the active one (menu item). */
  onCloseOthers?: () => void
  /** Drag-to-reorder: move `dragId` before/after `targetId`. */
  onReorder?: (dragId: string, targetId: string, after: boolean) => void
  /** Name of the most recently closed tab (null → nothing to restore). */
  restoreName?: string | null
  /** Restores the most recently closed tab (tabs-menu item). */
  onRestore?: () => void
}

const CAT_ICON: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOC',
  xlsx: 'XLS',
  pptx: 'PPT',
  text: 'TXT',
  markdown: 'MD',
  json: '{}',
  image: 'IMG',
  rtf: 'RTF',
  unknown: '?',
}

export function DocumentTabs({
  files,
  activeId,
  onSelect,
  onClose,
  onAdd,
  onCloseAll,
  onCloseOthers,
  onReorder,
  restoreName,
  onRestore,
}: DocumentTabsProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = React.useState(true)
  const [atEnd, setAtEnd] = React.useState(true)

  /* ---- Drag-to-reorder (HTML5 DnD, desktop) ----
   * The dragged tab fades; the tab under the pointer gets an inset shadow
   * on the side the drop will insert at (before/after its midpoint). The
   * indicator uses inset box-shadow instead of a border so it never shifts
   * the tab layout. Touch devices have no HTML5 DnD — reorder is a desktop
   * nicety, all other tab operations remain pointer/keyboard accessible. */
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<{
    id: string
    after: boolean
  } | null>(null)

  const handleDragStart = (e: React.DragEvent, id: string) => {
    if (!onReorder) return
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Some browsers require data for the drag to start at all.
    e.dataTransfer.setData('text/plain', id)
  }
  const handleDragOver = (e: React.DragEvent, id: string) => {
    if (!onReorder || !dragId || dragId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientX > rect.left + rect.width / 2
    setDropTarget((prev) =>
      prev && prev.id === id && prev.after === after ? prev : { id, after },
    )
  }
  const handleDrop = (e: React.DragEvent, id: string) => {
    if (!onReorder || !dragId || dragId === id) return
    e.preventDefault()
    onReorder(dragId, id, dropTarget?.id === id ? dropTarget.after : false)
  }
  const endDrag = () => {
    setDragId(null)
    setDropTarget(null)
  }

  /** Recompute the edge fade flags from the strip's scroll position. */
  const updateEdges = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const start = el.scrollLeft <= 1
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
    setAtStart((prev) => (prev === start ? prev : start))
    setAtEnd((prev) => (prev === end ? prev : end))
  }, [])

  React.useEffect(() => {
    updateEdges()
    // File list changes (tab added/removed) resize the strip — re-check.
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return updateEdges
    const ro = new ResizeObserver(updateEdges)
    ro.observe(el)
    return () => ro.disconnect()
  }, [files.length, updateEdges])

  /**
   * Vertical wheel over the strip scrolls it horizontally (trackpads + wheels).
   * Attached as a NATIVE non-passive listener — React's synthetic onWheel is
   * passive, so preventDefault() there cannot stop the page scroll.
   */
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const canScroll = el.scrollWidth > el.clientWidth + 1
      if (!canScroll) return
      // Only translate purely vertical wheel movement; horizontal input
      // (shift+wheel / trackpad pan) is already handled natively.
      if (e.deltaY !== 0 && e.deltaX === 0) {
        el.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      className="dv-tabs-wrap"
      data-at-start={atStart}
      data-at-end={atEnd}
    >
      <div
        ref={scrollRef}
        onScroll={updateEdges}
        className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar"
      >
        {files.map((file) => {
          const active = file.id === activeId
          const isDragged = dragId === file.id
          const isDropTarget = dropTarget?.id === file.id
          return (
            <div
              key={file.id}
              role="tab"
              tabIndex={0}
              aria-selected={active}
              data-active={active ? 'true' : 'false'}
              title={`${file.name} — средний клик или × закрывает вкладку${
                onReorder ? '; перетащите, чтобы изменить порядок' : ''
              }`}
              draggable={!!onReorder}
              onDragStart={(e) => handleDragStart(e, file.id)}
              onDragOver={(e) => handleDragOver(e, file.id)}
              onDrop={(e) => handleDrop(e, file.id)}
              onDragEnd={endDrag}
              onClick={() => onSelect(file.id)}
              onAuxClick={(e) => {
                // Middle click (button 1) closes the tab, like browser tabs.
                // preventDefault stops the legacy autoscroll behavior.
                if (e.button === 1) {
                  e.preventDefault()
                  onClose(file.id)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(file.id)
                }
              }}
              className={cn(
                'dv-tab group flex shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 cursor-pointer transition-colors max-w-[220px] sm:max-w-[260px]',
                // NOTE: the active tab's top accent + bottom hairline AND the
                // drag-reorder side indicators live in globals.css
                // (.dv-tab[data-active] / .dv-drop-before/after) — one place,
                // correct specificity ordering.
                active
                  ? 'bg-card text-card-foreground border-border'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted border-transparent',
                isDragged && 'opacity-40',
                isDropTarget && (dropTarget?.after ? 'dv-drop-after' : 'dv-drop-before'),
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-9 shrink-0 items-center justify-center rounded text-[10px] font-bold tracking-tight border',
                  CATEGORY_COLORS[file.category],
                )}
              >
                {CAT_ICON[file.category] ?? 'FILE'}
              </span>
              <span className="flex flex-col min-w-0">
                <span
                  className="truncate text-xs sm:text-sm font-medium leading-tight"
                  title={file.name}
                >
                  {file.name}
                </span>
                <span className="text-[10px] text-muted-foreground/80 leading-tight">
                  {formatBytes(file.size)}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Закрыть ${file.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(file.id)
                }}
                className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground/70 opacity-0 transition-all hover:bg-destructive/15 hover:text-destructive active:scale-90 focus:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 h-9 px-2 text-muted-foreground"
          onClick={onAdd}
          aria-label="Открыть ещё файл"
          title="Открыть ещё файл (Ctrl+O)"
        >
          <Plus className="h-4 w-4" />
        </Button>
        {/* Tabs menu: restore + close actions. Rendered whenever any action
            is available — including the single-file case, so a closed tab can
            be restored even when only one remains open. */}
        {(files.length > 1 || (onRestore != null && restoreName != null)) &&
          (onCloseAll || onCloseOthers || onRestore) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 h-9 px-2 text-muted-foreground"
                aria-label="Действия со вкладками"
                title="Действия со вкладками"
              >
                <ListX className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[13rem]">
              {onRestore && (
                <DropdownMenuItem
                  onSelect={() => onRestore()}
                  disabled={!restoreName}
                >
                  <Undo2 className="mr-2 h-3.5 w-3.5" />
                  {restoreName
                    ? `Восстановить «${
                        restoreName.length > 22
                          ? restoreName.slice(0, 21) + '…'
                          : restoreName
                      }»`
                    : 'Нет закрытых вкладок'}
                </DropdownMenuItem>
              )}
              {onCloseOthers && (
                <DropdownMenuItem
                  onSelect={() => onCloseOthers()}
                  disabled={files.length <= 1}
                >
                  <X className="mr-2 h-3.5 w-3.5" />
                  Закрыть другие ({files.length - 1})
                </DropdownMenuItem>
              )}
              {onCloseAll && (
                <DropdownMenuItem
                  onSelect={() => onCloseAll()}
                  className="text-destructive focus:text-destructive"
                >
                  <ListX className="mr-2 h-3.5 w-3.5" />
                  Закрыть все ({files.length})
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {/* Edge fades — indicate more tabs are scrollable (CSS-driven). */}
      <div className="dv-tabs-fade dv-tabs-fade-left" aria-hidden="true" />
      <div className="dv-tabs-fade dv-tabs-fade-right" aria-hidden="true" />
    </div>
  )
}
