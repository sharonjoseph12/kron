import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { NetworkBadge, Modal, btnDanger, btnGhost } from "./ui.js";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-[18px] w-[18px]">
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", icon: "M3 12l9-8 9 8M5 10v10h14V10M9 20v-6h6v6" },
  { to: "/agents", label: "Agents", icon: "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM21 21v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75" },
  { to: "/simulation", label: "Simulation", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { to: "/verify", label: "Verify", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" },
  { to: "/playground", label: "Playground", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" },
  { to: "/mcp", label: "MCP Servers", icon: "M4 7h16M4 12h16M4 17h16" },
  { to: "/payments", label: "Payments", icon: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18" },
  { to: "/audit", label: "Audit Log", icon: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" },
];

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: api.listAgents });

  const [showKillModal, setShowKillModal] = useState(false);
  const [killSuccess, setKillSuccess] = useState(false);

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  const emergencyStopAll = useMutation({
    mutationFn: async () => {
      const agents = agentsQuery.data?.agents ?? [];
      for (const a of agents) {
        await api.updatePolicy(a.id, { emergencyStop: true });
      }
    },
    onSuccess: () => {
      setKillSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      setTimeout(() => {
        setKillSuccess(false);
        setShowKillModal(false);
      }, 1500);
    },
  });

  return (
    <div className="flex min-h-screen bg-[var(--color-canvas)]">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-[var(--color-line)] bg-white/85 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-ink)] font-mono text-sm font-bold text-white">
            K
          </div>
          <div>
            <div className="font-mono text-sm font-semibold tracking-[0.18em] text-[var(--color-ink)]">KRON</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--color-ink-3)]">Operator Console</div>
          </div>
        </div>
        <div className="px-5 pb-3">
          <NetworkBadge network={import.meta.env.VITE_ALGORAND_NETWORK ?? "testnet"} />
        </div>

        <nav className="mt-2 flex flex-col gap-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-[var(--color-accent)] text-white shadow-sm"
                    : "text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                }`
              }
            >
              <Icon d={item.icon} />
              {item.label}
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-30" />
            </NavLink>
          ))}
        </nav>

        <div className="px-3 mt-5">
          <button
            onClick={() => setShowKillModal(true)}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 active:scale-[0.98]"
          >
            <span className="h-2 w-2 rounded-full bg-red-500 anim-soft-pulse" />
            EMERGENCY STOP
          </button>
        </div>

        <div className="mt-auto border-t border-[var(--color-line)] p-3">
          <div className="mb-3 px-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
            Powered by Algorand
          </div>
          <div className="flex items-center gap-2.5 px-1 py-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-xs font-semibold text-[var(--color-ink-2)]">
              {data?.user?.email?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-[var(--color-ink)]">{data?.user?.email}</div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-3)]">{data?.user?.role}</div>
            </div>
          </div>
          <button
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-ink-3)] transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
          >
            <LogoutIcon />
            {logout.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      <main className="ml-60 flex-1 px-8 py-7">
        <Outlet />
      </main>

      <Modal
        title="Global Emergency Stop"
        isOpen={showKillModal}
        onClose={() => setShowKillModal(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-ink-2)]">
            This will trigger the <strong className="text-[var(--color-ink)]">emergency stop</strong> across all registered AI
            agents in the fleet. All autonomous wallet signing and settlement on Algorand will be frozen until lifted by an
            operator.
          </p>

          {killSuccess && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              All autonomous agent spending has been halted.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowKillModal(false)}
              className={btnGhost}
              disabled={emergencyStopAll.isPending}
            >
              Cancel
            </button>
            <button
              onClick={() => emergencyStopAll.mutate()}
              disabled={emergencyStopAll.isPending}
              className={btnDanger}
            >
              {emergencyStopAll.isPending ? "Freezing Fleet…" : "Confirm Emergency Stop"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}