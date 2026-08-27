import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Turns a render crash into something you can read.
 *
 * React unmounts the whole tree when a render throws and nothing catches it,
 * which shows up as a blank white page -- the one failure mode that tells the
 * person looking at it nothing at all, and tells whoever has to fix it even
 * less. This keeps the message and the stack on screen instead.
 *
 * It also gives a way out that does not involve the browser's reload button:
 * most of this app's state is in localStorage, so a crash caused by a stored
 * listing would come straight back on reload.
 */
type Props = { children: ReactNode };
type State = { error: Error | null; info: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack is the part that says *where*, which the error alone
    // does not. Console first, so it survives whatever the user does next.
    console.error("Reality Check crashed:", error, info.componentStack);
    this.setState({ info: info.componentStack ?? "" });

    /**
     * In dev, clear the crash when the code changes.
     *
     * This state latches by design -- a crashed tree must not re-render itself
     * in a loop. But that also means a hot update fixing the very bug on
     * screen leaves the crash screen sitting there, so the fix looks like it
     * did not work and the only way out is a manual reload. Vite tells us when
     * new code has landed; that is the moment to try again.
     */
    if (import.meta.hot) {
      const retry = () => {
        import.meta.hot?.off("vite:afterUpdate", retry);
        this.setState({ error: null, info: "" });
      };
      import.meta.hot.on("vite:afterUpdate", retry);
    }
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <h1>Something broke</h1>
        <p className="crash-msg">{error.message || String(error)}</p>
        <details>
          <summary>Where it happened</summary>
          <pre>{(error.stack ?? "") + (info ? "\n\nComponent stack:" + info : "")}</pre>
        </details>
        <div className="crash-actions">
          <button className="btn" style={{ width: 220 }} onClick={() => this.setState({ error: null, info: "" })}>
            Try again
          </button>
          {/* Saved listings and the onboarding answers both live in
              localStorage, so a crash caused by stored data would survive a
              reload. This is the way out of that. */}
          <button
            className="btn ghost"
            style={{ width: 220 }}
            onClick={() => {
              try {
                localStorage.removeItem("reality-check.saved");
              } catch {
                // Storage blocked -- reloading is still worth a try.
              }
              location.reload();
            }}
          >
            Clear saved listings and reload
          </button>
        </div>
      </div>
    );
  }
}
