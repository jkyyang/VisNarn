/** Icons used in more than one place. Drawn in currentColor; decorative, so each button names itself. */
import type { ReactElement } from "react";

/** Pick on the map. */
export const Crosshair = (): ReactElement => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/** Clear, close or remove. */
export const Cross = (): ReactElement => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const Search = ({ size = 16 }: { size?: number }): ReactElement => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);
