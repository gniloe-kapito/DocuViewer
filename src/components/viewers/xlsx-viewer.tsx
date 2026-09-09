'use client'

import * as React from 'react'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'
import { AlertTriangle, Copy, Loader2, Table2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { LoadedFile } from '@/lib/viewers/types'

interface ViewerProps {
  file: LoadedFile
}

const ROW_CAP = 5000
const NUMERIC_RE = /^-?\d+(\.\d+)?$/

interface SheetData {
  rows: string[][]
  totalRows: number
  colCount: number
  truncated: boolean
  empty: boolean
}

function readSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
): SheetData {
  const ws = workbook.Sheets[sheetName]
  if (!ws) {
    return { rows: [], totalRows: 0, colCount: 0, truncated: false, empty: true }
  }
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
  const allRows: string[][] = raw.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) =>
      cell == null ? '' : String(cell),
    ),
  )
  const totalRows = allRows.length
  const truncated = totalRows > ROW_CAP
  const rows = truncated ? allRows.slice(0, ROW_CAP) : allRows
  const colCount = rows.reduce(
    (max, row) => (row.length > max ? row.length : max),
    0,
  )
  return { rows, totalRows, colCount, truncated, empty: totalRows === 0 }
}

export function XlsxViewer({ file }: ViewerProps) {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [workbook, setWorkbook] = React.useState<XLSX.WorkBook | null>(null)
  const [sheetNames, setSheetNames] = React.useState<string[]>([])
  const [activeSheet, setActiveSheet] = React.useState<string>('')

  React.useEffect(() => {
    let isCancelled = false

    setLoading(true)
    setError(null)
    setWorkbook(null)
    setSheetNames([])
    setActiveSheet('')

    try {
      const wb = XLSX.read(file.arrayBuffer, { type: 'array' })
      if (isCancelled) return
      const names = (wb.SheetNames ?? []).filter(Boolean)
      if (names.length === 0) {
        setError('В книге нет листов')
        setLoading(false)
        return
      }
      setWorkbook(wb)
      setSheetNames(names)
      setActiveSheet(names[0])
      setLoading(false)
    } catch (err) {
      if (isCancelled) return
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error('Не удалось открыть таблицу', { description: msg })
      setLoading(false)
    }

    return () => {
      isCancelled = true
    }
  }, [file.id, file.arrayBuffer])

  const sheet = React.useMemo<SheetData | null>(() => {
    if (!workbook || !activeSheet) return null
    return readSheet(workbook, activeSheet)
  }, [workbook, activeSheet])

  const handleCopyCsv = React.useCallback(async () => {
    if (!workbook || !activeSheet) return
    try {
      const ws = workbook.Sheets[activeSheet]
      if (!ws) return
      const csv = XLSX.utils.sheet_to_csv(ws)
      await navigator.clipboard.writeText(csv)
      toast.success('Лист скопирован как CSV')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Не удалось скопировать', { description: msg })
    }
  }, [workbook, activeSheet])

  if (loading) {
    return (
      <div className="dv-scroll h-full overflow-auto">
        <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm">Чтение таблицы…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dv-scroll h-full overflow-auto">
        <div className="mx-auto max-w-[640px] px-4 py-8">
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">Не удалось открыть таблицу</p>
              <p className="mt-1 break-words">{error}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!workbook || !sheet) {
    return null
  }

  return (
    <div className="dv-scroll flex h-full flex-col overflow-auto">
      {/* Toolbar — sticky at the top of the outer scroll container */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
        {sheetNames.length > 1 ? (
          <Select value={activeSheet} onValueChange={setActiveSheet}>
            <SelectTrigger
              size="sm"
              className="min-w-[160px] max-w-[280px]"
              aria-label="Выбор листа"
            >
              <SelectValue placeholder="Лист" />
            </SelectTrigger>
            <SelectContent>
              {sheetNames.map((name) => (
                <SelectItem key={name} value={name}>
                  <Table2 className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span
            className="inline-flex max-w-[280px] items-center gap-1.5 text-sm font-medium"
            title={sheetNames[0] ?? activeSheet}
          >
            <Table2 className="size-3.5 text-muted-foreground" />
            <span className="truncate">{sheetNames[0] ?? activeSheet}</span>
          </span>
        )}

        <span className="text-xs text-muted-foreground tabular-nums">
          {sheet.totalRows} строк × {sheet.colCount} столбцов
        </span>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopyCsv}
          disabled={sheet.empty}
          className="ml-auto"
        >
          <Copy className="size-3.5" />
          <span className="hidden sm:inline">Скопировать как CSV</span>
          <span className="sm:hidden">CSV</span>
        </Button>
      </div>

      {sheet.truncated && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          Показаны первые {ROW_CAP} строк из {sheet.totalRows}
        </div>
      )}

      {/* Table scroll area */}
      <div className="dv-scroll min-h-0 flex-1 overflow-auto">
        {sheet.empty ? (
          <div className="flex h-full min-h-[200px] items-center justify-center p-8 text-sm text-muted-foreground">
            Лист пуст
          </div>
        ) : (
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                {Array.from({ length: sheet.colCount }, (_, i) => {
                  const value = sheet.rows[0]?.[i] ?? ''
                  return (
                    <th
                      key={i}
                      title={value}
                      className={cn(
                        'sticky top-0 z-10 border border-border bg-muted/60 px-2 py-1 text-left align-bottom font-medium',
                        'max-w-[300px] truncate whitespace-nowrap',
                      )}
                    >
                      {value === '' ? '\u00A0' : value}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.slice(1).map((row, ri) => (
                <tr key={ri} className="even:bg-muted/20">
                  {Array.from({ length: sheet.colCount }, (_, ci) => {
                    const value = row[ci] ?? ''
                    const numeric = NUMERIC_RE.test(value.trim())
                    return (
                      <td
                        key={ci}
                        title={value}
                        className={cn(
                          'border border-border px-2 py-1 align-top',
                          'max-w-[300px] truncate whitespace-nowrap',
                          numeric && 'text-right tabular-nums',
                        )}
                      >
                        {value === '' ? '\u00A0' : value}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
