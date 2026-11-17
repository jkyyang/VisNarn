/** CSV text as a record source. */
import { AppError } from "../../shared/app.ts";
import type { RawRecord, RecordSource } from "./intake.ts";

/**
 * RFC 4180: commas, double quotes, "" inside quotes, and line breaks inside quoted cells (the old
 * parser split lines first and broke those). A leading UTF-8 BOM and blank lines are skipped.
 */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let line = 1;
  let rowLine = 1;
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;

  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) rows.push({ line: rowLine, cells });
    cells = [];
    cell = "";
  };

  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (ch === "\n" || (ch === "\r" && s[i + 1] !== "\n")) line++;
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      i++;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      endRow();
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
      line++;
      rowLine = line;
    } else {
      // Text after a closing quote, or a quote inside an unquoted cell, is kept as written (what spreadsheets do).
      cell += ch;
      i++;
    }
  }
  if (quoted) throw new AppError("invalid", `Line ${rowLine} opens a quoted cell that is never closed.`);
  if (cell !== "" || cells.length) endRow();
  return rows;
}

/** The first row is the header. Throws AppError("invalid") for an empty file or a header with no data rows. */
export function csvSource(fileName: string, text: string): RecordSource {
  const rows = parseCsv(text);
  if (!rows.length) throw new AppError("invalid", `${fileName} is empty.`, "source");
  const [header, ...data] = rows;
  if (!data.length) throw new AppError("invalid", `${fileName} has a header row but no data rows.`, "source");
  const names = header.cells.map((name) => name.trim().toLowerCase());
  const seen = new Set<string>();
  for (const name of names) {
    if (name !== "" && seen.has(name)) throw new AppError("invalid", `${fileName} has the column "${name}" twice.`, "source");
    seen.add(name);
  }
  return {
    info: { kind: "csv", label: fileName },
    async *records(): AsyncIterable<RawRecord> {
      for (const row of data) {
        const cells = Object.fromEntries(names.flatMap((name, i) => (name === "" ? [] : [[name, (row.cells[i] ?? "").trim()]])));
        yield { line: row.line, cells };
      }
    },
  };
}
