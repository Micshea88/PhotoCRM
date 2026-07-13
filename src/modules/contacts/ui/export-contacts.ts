import type { SheetData, Cell } from "write-excel-file/browser"

import type { ContactRow } from "./columns"

export interface ExportColumn {
  label: string
  value: (row: ContactRow) => string
}

/**
 * RFC-4180: wrap a field in double-quotes and double internal quotes
 * if the field contains a comma, double-quote, newline, or a
 * leading/trailing space.
 */
function csvField(raw: string): string {
  if (/[,"\n\r]/.test(raw) || raw !== raw.trim()) {
    return '"' + raw.replace(/"/g, '""') + '"'
  }
  return raw
}

/**
 * Download the given rows as a CSV file in the browser.
 *
 * @param rows     - ContactRow array to export
 * @param columns  - Ordered columns; each supplies a label and a value accessor
 * @param filename - Override the default `contacts-<count>.csv` filename
 */
export function exportContactsCsv(
  rows: ContactRow[],
  columns: ExportColumn[],
  filename?: string,
): void {
  if (typeof window === "undefined") return

  const name = filename ?? `contacts-${String(rows.length)}.csv`

  const header = columns.map((c) => csvField(c.label)).join(",")
  const dataRows = rows.map((row) => columns.map((c) => csvField(c.value(row))).join(","))
  const csv = [header, ...dataRows].join("\r\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Download the given rows as an XLSX file in the browser.
 * Uses `write-excel-file/browser` loaded via dynamic import so the
 * package is never evaluated on the server.
 *
 * @param rows     - ContactRow array to export
 * @param columns  - Ordered columns; each supplies a label and a value accessor
 * @param filename - Override the default `contacts-<count>.xlsx` filename
 */
export async function exportContactsXlsx(
  rows: ContactRow[],
  columns: ExportColumn[],
  filename?: string,
): Promise<void> {
  if (typeof window === "undefined") return

  const name = filename ?? `contacts-${String(rows.length)}.xlsx`

  const { default: writeXlsxFile } = await import("write-excel-file/browser")

  const headerRow: Cell[] = columns.map((c): Cell => ({ value: c.label, fontWeight: "bold" }))

  const dataRows: Cell[][] = rows.map((row) =>
    columns.map((c): Cell => ({ value: c.value(row), type: String })),
  )

  const sheetData: SheetData = [headerRow, ...dataRows]

  await writeXlsxFile(sheetData).toFile(name)
}
