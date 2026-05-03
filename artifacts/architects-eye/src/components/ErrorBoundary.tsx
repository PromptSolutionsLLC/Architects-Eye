import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * P16 — Top-level error boundary.
 *
 * Catches any runtime error in the React tree (including Cesium init
 * failures inside <Viewer>) and shows a recoverable fallback instead
 * of a white screen. Wraps everything (BootScreen included) so even
 * the boot animation can't bring down the page.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

const AMBER = "#fbbf24";

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Surface to console with a tag so it's easy to grep in logs.
    console.error("[ERROR BOUNDARY CAUGHT]", error, errorInfo);
    this.setState({ errorInfo });
  }

  private reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  private copyError = async () => {
    const { error, errorInfo } = this.state;
    if (!error) return;
    const text = [
      `Architect's Eye — Terminal Fault`,
      ``,
      `Message: ${error.message}`,
      ``,
      `Stack:`,
      error.stack ?? "(no stack)",
      ``,
      `Component stack:`,
      errorInfo?.componentStack ?? "(no component stack)",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API blocked (insecure context, denied permission, etc.) —
      // fall back to a textarea selection so the user can manually copy.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more we can do */
      }
      document.body.removeChild(ta);
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          position: "fixed",
          inset: 0,
          background: "#000",
          zIndex: 100000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          color: AMBER,
          fontFamily:
            '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        <div style={{ maxWidth: 720, width: "100%" }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>
            ARCHITECT'S EYE
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 16,
              opacity: 0.9,
            }}
          >
            TERMINAL FAULT
          </div>
          <pre
            style={{
              color: "#fff",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(251,191,36,0.3)",
              padding: 12,
              maxHeight: 240,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 12,
              margin: 0,
            }}
          >
            {error.message || String(error)}
          </pre>
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button
              type="button"
              onClick={this.reload}
              style={buttonStyle}
            >
              [ RELOAD ]
            </button>
            <button
              type="button"
              onClick={this.copyError}
              style={buttonStyle}
            >
              [ COPY ERROR ]
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const buttonStyle: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${AMBER}`,
  color: AMBER,
  fontFamily:
    '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 1,
  padding: "6px 14px",
  cursor: "pointer",
  borderRadius: 2,
};
