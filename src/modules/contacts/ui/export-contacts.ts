import type { SheetData, Cell } from "write-excel-file/browser"

import type { ContactRow } from "./columns"

export interface ExportColumn {
  label: string
  value: (row: ContactRow) => string
}

/**
 * Spreadsheet formula-injection guard (OWASP CSV injection).
 *
 * Excel, Google Sheets, and LibreOffice interpret any cell whose FIRST
 * character is `=`, `+`, `@`, TAB (`\t`), or CR (`\r`) as a FORMULA.
 * Exported contact fields (name, company, custom fields, tags) originate
 * from user / imported / external input, so a value like
 * `=HYPERLINK("http://evil","click")` or `=cmd|'/c calc'!A1` would execute
 * the moment the studio owner opens the export. Prefixing an at-risk value
 * with a single apostrophe forces the spreadsheet to treat the cell as
 * literal text — the standard mitigation.
 *
 * Leading `-` is CONDITIONAL: a legitimate negative number (`-5`, `-12.50`)
 * must stay numeric, so we only neutralize a leading `-` when the value is
 * NOT a finite number (e.g. `-cmd|...` or `-=1+1`).
 *
 * Exported so it can be unit-tested directly and reused by the XLSX path.
 */
export function neutralizeFormula(value: string): string {
  if (value === "") return value
  const first = value[0]
  if (first === "=" || first === "+" || first === "@" || first === "\t" || first === "\r") {
    return "'" + value
  }
  // Leading "-": prefix only when it is not a plain negative number.
  if (first === "-" && !Number.isFinite(Number(value))) {
    return "'" + value
  }
  return value
}

/**
 * RFC-4180: neutralize spreadsheet formula triggers, then wrap the field in
 * double-quotes and double internal quotes if it contains a comma,
 * double-quote, newline, or a leading/trailing space.
 *
 * Exported for unit tests that pin the combined neutralize + quote result.
 */
export function csvField(raw: string): string {
  const safe = neutralizeFormula(raw)
  if (/[,"\n\r]/.test(safe) || safe !== safe.trim()) {
    return '"' + safe.replace(/"/g, '""') + '"'
  }
  return safe
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

  // XLSX is currently safe (cells are written type:String, not as formulas),
  // but apply the same neutralize guard as defense-in-depth so the mitigation
  // doesn't silently break if cell typing ever changes.
  const headerRow: Cell[] = columns.map(
    (c): Cell => ({ value: neutralizeFormula(c.label), fontWeight: "bold" }),
  )

  const dataRows: Cell[][] = rows.map((row) =>
    columns.map((c): Cell => ({ value: neutralizeFormula(c.value(row)), type: String })),
  )

  const sheetData: SheetData = [headerRow, ...dataRows]

  await writeXlsxFile(sheetData).toFile(name)
}
