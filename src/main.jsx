// Copyright (c) 2026 Dinsdag BV. All rights reserved.
// Proprietary — see LICENSE.

import React from "react";
import { createRoot } from "react-dom/client";
import App from "../odoo-inventory-flow (2).jsx";

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null, info: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { this.setState({ err, info }); console.error("App error:", err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{
        padding: 24, maxWidth: 760, margin: "40px auto", fontFamily: "system-ui, sans-serif",
        background: "#fff", color: "#1a2332", border: "1px solid #f43f5e",
        borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
      }}>
        <h2 style={{ margin: "0 0 8px", color: "#f43f5e" }}>Inventory Flow — render error</h2>
        <p style={{ marginTop: 0, color: "#546578" }}>
          The app threw while rendering. The original error is below.
          Try a hard reload (Ctrl + Shift + R). If it persists, copy this stack trace to a bug report.
        </p>
        <pre style={{
          background: "#f8fafc", padding: 12, borderRadius: 6, fontSize: 12,
          overflow: "auto", color: "#1a2332", maxHeight: 320,
        }}>{String(this.state.err?.stack || this.state.err)}{"\n\n"}
{this.state.info?.componentStack || ""}</pre>
        <button onClick={() => location.reload()}
          style={{ padding: "8px 14px", background: "#4b6ef5", color: "#fff",
                   border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 600 }}>
          Reload
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
