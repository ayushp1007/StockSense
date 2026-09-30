import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./refresh.css";

class WorkspaceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("StockSense could not render the workspace.", error, info.componentStack);
  }
  render() {
    if (this.state.failed) return <main className="recovery-screen"><img src="/stocksense-mark.svg" width="48" height="48" alt="StockSense"/><h1>Let’s reopen your workspace</h1><p>An unexpected display error interrupted this page. Reload to retrieve your current records from the server.</p><button className="button button-primary" onClick={() => window.location.reload()}>Reload StockSense</button></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><WorkspaceErrorBoundary><App /></WorkspaceErrorBoundary></React.StrictMode>);
