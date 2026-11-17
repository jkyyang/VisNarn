import { useEffect, useState } from "react";
import { copyText } from "./clipboard.ts";

interface CopyButtonProps {
  label: string;
  /** Called on click, so large payloads are only built when asked for. */
  getText: () => string;
}

/** Copies text and says, in words next to the button, whether it worked. */
export function CopyButton({ label, getText }: CopyButtonProps) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 2500);
    return () => clearTimeout(timer);
  }, [result]);

  return (
    <div className="inline center">
      <button type="button" className="btn" onClick={async () => setResult((await copyText(getText())) ? "copied" : "failed")}>
        {label}
      </button>
      <span className="hint" role="status">
        {result === "copied" && "Copied to clipboard."}
        {result === "failed" && "Couldn't copy. Your browser blocked clipboard access."}
      </span>
    </div>
  );
}
