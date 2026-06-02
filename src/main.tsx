import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Skribe UI crashed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-crash-screen">
        <section>
          <strong>Skribe hit a UI error.</strong>
          <p>Your saved document is still local on disk. Reload the app to restore the editor.</p>
          <pre>{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Skribe
          </button>
        </section>
      </main>
    );
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
