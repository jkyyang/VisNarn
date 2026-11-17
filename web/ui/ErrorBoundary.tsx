import { Component, type ReactNode } from "react";

interface Props {
  /** Shown instead of the children after one of them throws while rendering. */
  fallback: ReactNode;
  children: ReactNode;
}

/** Keeps a crash in one part of the page (the map: WebGL, a failed chunk download) from blanking the rest. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
