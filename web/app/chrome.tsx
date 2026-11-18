/** The frame around every panel: brand header, mode tabs, back header. */
import type { ReactElement } from "react";
import { HOME, linkTo, type Screen } from "./routes.ts";

function Logo(): ReactElement {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="logo">
      <rect width="28" height="28" rx="8" fill="var(--route)" />
      <path d="M7 19c4-9 10-1 14-10" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="7" cy="19" r="2.4" fill="#fff" />
      <rect x="18.5" y="6.5" width="5" height="5" rx="1" fill="#fff" />
    </svg>
  );
}

const ExampleBadge = () => <span className="tag">EXAMPLE DATA</span>;

/** Logo, "Shop Arrival Check", and the "EXAMPLE DATA" badge while the server holds only seeded EXAMPLE shops. */
export function AppHeader(props: { exampleOnly: boolean }): ReactElement {
  return (
    <header className="app-header">
      <div className="brand">
        <Logo />
        <span className="brand-name">Shop Arrival Check</span>
      </div>
      {props.exampleOnly && <ExampleBadge />}
    </header>
  );
}

const SHOPS: Screen = { name: "shops", edit: null };

/** Route · Shops. */
export function ModeTabs(props: { current: Screen["name"] }): ReactElement {
  const tab = (target: Screen, label: string, icon: ReactElement) => (
    <a className="tab" {...linkTo(target)} aria-current={props.current === target.name ? "page" : undefined}>
      {icon}
      {label}
    </a>
  );
  return (
    <nav className="tabs" aria-label="Mode">
      {tab(
        HOME,
        "Route",
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M4 15V7.5a3 3 0 0 1 6 0v3a3 3 0 0 0 6 0V3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="4" cy="15" r="1.8" fill="currentColor" />
        </svg>,
      )}
      {tab(
        SHOPS,
        "Shops",
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <rect x="3" y="7" width="12" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M2 8l7-5 7 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>,
      )}
    </nav>
  );
}

/** Back arrow and title, for Shops. */
export function BackHeader(props: { title: string; exampleOnly?: boolean }): ReactElement {
  return (
    <header className="back-header">
      <a className="icon-btn" {...linkTo(HOME)} aria-label="Back to route">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M16 10H4M9 5l-5 5 5 5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
      <div className="back-title">
        <h1>{props.title}</h1>
      </div>
      {props.exampleOnly && <ExampleBadge />}
    </header>
  );
}
