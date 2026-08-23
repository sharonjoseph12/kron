import React from "react";

interface State { hasError: boolean; message: string }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: "" };
  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }
  componentDidCatch(err: unknown) {
    console.error("[kron] UI error boundary:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-xl rounded-xl border border-[#e5b0a6] bg-[var(--color-danger-soft)] p-6 text-center">
          <h2 className="text-sm font-semibold text-[var(--color-danger)]">Something went wrong</h2>
          <p className="mt-1 text-xs text-[var(--color-ink-2)] break-all">{this.state.message}</p>
          <button onClick={() => this.setState({ hasError: false, message: "" })} className="mt-3 rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs font-semibold">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
