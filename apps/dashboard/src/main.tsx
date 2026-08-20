import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import AuthGuard from "./components/AuthGuard.js";
import Layout from "./components/Layout.js";
import Login from "./pages/Login.js";
import Dashboard from "./pages/Dashboard.js";
import Agents from "./pages/Agents.js";
import Mcp from "./pages/Mcp.js";
import Payments from "./pages/Payments.js";
import Simulation from "./pages/Simulation.js";
import Verify from "./pages/Verify.js";
import Playground from "./pages/Playground.js";
import Audit from "./pages/Audit.js";

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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AuthGuard />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
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
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);