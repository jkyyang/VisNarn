import type { CSSProperties } from "react";

/** Where a segmented control's thumb sits (styles.css `.segmented`): under segment `at` of `count`; none when nothing is chosen. */
export function thumbAt(count: number, at: number): CSSProperties {
  const vars: Record<string, number> = at < 0 ? { "--count": count } : { "--count": count, "--at": at };
  return vars;
}
