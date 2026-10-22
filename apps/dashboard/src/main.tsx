import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import AuthGuard from "./components/AuthGuard.js";
import Layout from "./components/Layout.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import Login from "./pages/Login.js";

// Route-level code splitting: each page becomes its own chunk so the
// initial dashboard load stays <250 kB gzipped even on a slow hackathon WiFi.
const Dashboard = lazy(() => import("./pages/Dashboard.js"));
const Agents = lazy(() => import("./pages/Agents.js"));
const Mcp = lazy(() => import("./pages/Mcp.js"));
const Payments = lazy(() => import("./pages/Payments.js"));
const Simulation = lazy(() => import("./pages/Simulation.js"));
const Verify = lazy(() => import("./pages/Verify.js"));
const Playground = lazy(() => import("./pages/Playground.js"));
const Audit = lazy(() => import("./pages/Audit.js"));
const Control = lazy(() => import("./pages/Control.js"));

function PageFallback() {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-[var(--color-ink-3)]">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-accent)]" />
      Loading…
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

function initCursorInteraction() {
  const installRipple = (e: MouseEvent) => {
    const target = (e.target as HTMLElement)?.closest?.("a, button, [data-ripple]");
    if (!target) return;
    const ring = document.createElement("span");
    ring.className = "ripple-ring";
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    ring.style.width = ring.style.height = `${size}px`;
    ring.style.left = `${e.clientX - rect.left - size / 2}px`;
    ring.style.top = `${e.clientY - rect.top - size / 2}px`;
    target.appendChild(ring);
    setTimeout(() => ring.remove(), 650);
  };

  const trackSpotlight = (e: MouseEvent) => {
    (document.querySelectorAll<HTMLElement>(".spotlight")).forEach((el) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
      el.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
    });
  };

  document.addEventListener("pointerdown", installRipple);
  document.addEventListener("pointermove", trackSpotlight);
}

if (typeof window !== "undefined") initCursorInteraction();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<AuthGuard />}>
                <Route element={<Layout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/control" element={<Control />} />
                  <Route path="/agents" element={<Agents />} />
                  <Route path="/simulation" element={<Simulation />} />
                  <Route path="/verify" element={<Verify />} />
                  <Route path="/playground" element={<Playground />} />
                  <Route path="/mcp" element={<Mcp />} />
                  <Route path="/payments" element={<Payments />} />
                  <Route path="/audit" element={<Audit />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);