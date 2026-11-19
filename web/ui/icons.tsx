/** Icons used across the page: 24-unit strokes in currentColor, decorative, so each button names itself. */
import type { ReactElement, ReactNode } from "react";

function Icon({ size = 18, children }: { size?: number; children: ReactNode }): ReactElement {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Pick on the map. */
export const Crosshair = (): ReactElement => (
  <Icon size={16}>
    <circle cx="12" cy="12" r="6" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </Icon>
);

/** Clear, close or remove. */
export const Cross = (): ReactElement => (
  <Icon size={16}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const Search = ({ size = 18 }: { size?: number }): ReactElement => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Icon>
);

export const Undo = (): ReactElement => (
  <Icon>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 010 12h-3" />
  </Icon>
);

export const Redo = (): ReactElement => (
  <Icon>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 000 12h3" />
  </Icon>
);

export const Plus = ({ size = 18 }: { size?: number }): ReactElement => (
  <Icon size={size}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const More = (): ReactElement => (
  <Icon>
    <circle className="dot" cx="5" cy="12" r="2.6" />
    <circle className="dot" cx="12" cy="12" r="2.6" />
    <circle className="dot" cx="19" cy="12" r="2.6" />
  </Icon>
);

/** Done. */
export const Check = (): ReactElement => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

/** A chevron pointing left; turned by CSS where it points elsewhere. */
export const Chevron = ({ size = 18 }: { size?: number }): ReactElement => (
  <Icon size={size}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);

/** The panel, shown or folded away. */
export const PanelIcon = (): ReactElement => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16" />
  </Icon>
);

/** A drag handle. */
export const Grip = (): ReactElement => (
  <Icon size={16}>
    <path d="M5 9h14M5 15h14" />
  </Icon>
);

/** Turn the route round. */
export const Swap = (): ReactElement => (
  <Icon>
    <path d="M7 4v16M3 8l4-4 4 4" />
    <path d="M17 20V4M13 16l4 4 4-4" />
  </Icon>
);

/** Start over. */
export const Restart = (): ReactElement => (
  <Icon>
    <path d="M4 4v6h6" />
    <path d="M4.5 15a8 8 0 1 0 1.9-8.3L4 10" />
  </Icon>
);

/** Save, kept in the saved list. */
export const Bookmark = (): ReactElement => (
  <Icon>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </Icon>
);

/** The map's layers. */
export const Layers = (): ReactElement => (
  <Icon>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Icon>
);

export const Minus = (): ReactElement => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);

/** Back to the whole network. */
export const Home = (): ReactElement => (
  <Icon>
    <path d="M4 11l8-7 8 7" />
    <path d="M6 10v9h12v-9" />
  </Icon>
);

export const Fullscreen = (): ReactElement => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);

/** The map's credits. */
export const Info = (): ReactElement => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);
