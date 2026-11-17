/** Company location codes: user-imported sets that map a code to a place on the network. */
import { AppError } from "../../shared/app.ts";
import { locationOf, type CodeSet, type CodeType, type ImportReport, type ImportRequest, type NodeCode, type RowIssue } from "../../shared/places.ts";
import { instant } from "../../shared/time.ts";
import { openSource, readCodes } from "../intake/intake.ts";
import type { Store } from "../store/store.ts";
import type { Directory } from "./directory.ts";

export interface Codes {
  sets(): CodeSet[];
  /**
   * Columns: code, name (optional), then fra_id — or lon, lat. Each row's location is checked
   * against the network; rows off the network are issues. Commit replaces the whole code set.
   */
  import(request: ImportRequest & { codeType: CodeType; label: string }): Promise<ImportReport<NodeCode>>;
  remove(codeType: CodeType): void;
}

export function createCodes(store: Store, directory: Directory): Codes {
  return {
    sets: () => store.codes.sets(),

    async import({ source, commit, codeType, label }) {
      const type = codeType.trim();
      const parsed = await readCodes(openSource(source), type);
      const issues: RowIssue[] = [...parsed.issues];
      const bad = new Set(parsed.issues.map((i) => i.row));
      const seen = new Map<string, number>();
      const ready: NodeCode[] = [];

      parsed.items.forEach((draft, row) => {
        if (bad.has(row)) return;
        const line = parsed.lines[row];
        const issue = (message: string) => issues.push({ row, line, message });
        const key = draft.code.toLowerCase();
        const earlier = seen.get(key);
        if (earlier !== undefined) return issue(`The code ${draft.code} is already on line ${earlier}.`);
        seen.set(key, line);
        const place = directory.resolve(draft.location, "position");
        if (!place.ok) return issue(place.problem.message);
        ready.push({ codeType: type, code: draft.code, name: draft.name, location: locationOf(place.place) });
      });

      if (commit) {
        // Committing nothing would empty a code set that may be in use.
        if (!ready.length) throw new AppError("invalid", "None of the rows can be used, so the code set was not changed. Fix the rows listed and import again.", "source");
        store.codes.replaceSet({ codeType: type, label: label.trim() || type.toUpperCase() }, ready, instant(new Date()));
      }
      issues.sort((x, y) => x.row - y.row);
      return { committed: commit, ready, issues };
    },

    remove(codeType) {
      if (!store.codes.removeSet(codeType)) throw new AppError("not-found", `There is no code set "${codeType}".`);
    },
  };
}
