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
  { to: "/control", label: "Control Plane", icon: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4zM9 12l2 2 4-5" },
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
  const [showResetModal, setShowResetModal] = useState(false);
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

  const resetDemo = useMutation({
    mutationFn: api.resetDemo,
    onSuccess: () => {
      queryClient.invalidateQueries();
      setShowResetModal(false);
    },
  });

  const resumeAll = useMutation({
    mutationFn: async () => {
      const agents = agentsQuery.data?.agents ?? [];
      for (const a of agents) {
        await api.updatePolicy(a.id, { emergencyStop: false });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const anyEmergencyStop = (agentsQuery.data?.agents ?? []).some((a: any) => a.emergencyStop);

  return (
    <div className={`flex min-h-screen bg-[var(--color-canvas)] ${anyEmergencyStop ? "emergency-active" : ""}`}>
      <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-[var(--color-line)] bg-[var(--color-canvas)]">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#262521] font-mono text-[13px] font-bold text-[#fffcf6]">
            K
          </div>
          <div>
            <div className="display-serif text-[15px] font-semibold tracking-[0.18em] text-[var(--color-ink)]">
              KRON
            </div>
            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
              Agent control plane
            </div>
          </div>
        </div>
        <div className="px-5 pb-4">
          <NetworkBadge network={import.meta.env.VITE_ALGORAND_NETWORK ?? "testnet"} />
        </div>

        <nav className="mt-1 flex flex-col gap-0.5 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-md px-3 py-2 text-[12px] font-medium transition-colors duration-150 ${
                  isActive
                    ? "bg-[var(--color-surface-2)] text-[var(--color-ink)]"
                    : "text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-ink)]"
                }`
              }
            >
              <Icon d={item.icon} />
              {item.label}
              {item.to === "/payments" ? (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="mt-6 flex flex-col gap-2 px-3">
          <button
            onClick={() => setShowKillModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-[#e5b0a6] bg-transparent px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-danger)]" />
            Emergency stop
          </button>
          <button
            onClick={() => setShowResetModal(true)}
            className="w-full rounded-md px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-3)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            title="Clear payments & timeline for next demo run (keeps agents/wallets)"
          >
            Reset demo
          </button>
        </div>

        <div className="mt-auto border-t border-[var(--color-line)] p-3">
          <div className="mb-3 px-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
            Algorand testnet
          </div>
          <div className="flex items-center gap-2.5 px-1 py-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[11px] font-semibold text-[var(--color-ink-2)]">
              {data?.user?.email?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-[var(--color-ink)]">{data?.user?.email}</div>
              <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">{data?.user?.role}</div>
            </div>
          </div>
          <button
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="mt-2 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[11px] font-medium text-[var(--color-ink-3)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] disabled:opacity-50"
          >
            <LogoutIcon />
            {logout.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      <main className="ml-60 flex-1 px-8 py-8 lg:px-10">
        {anyEmergencyStop && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-[#c0392b] bg-[var(--color-danger-soft)] px-5 py-3 anim-fade-up">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#c0392b] text-white">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </span>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-danger)]">Fleet Frozen — Emergency Stop Active</div>
                <div className="text-[11px] text-[var(--color-ink-2)]">All autonomous agent spending is halted. No payments will be signed or settled.</div>
              </div>
            </div>
            <button
              onClick={() => resumeAll.mutate()}
              disabled={resumeAll.isPending}
              className="btn-indus whitespace-nowrap px-4 py-2 text-xs !bg-[var(--color-success)] !border-[#2f7d5e] hover:!bg-[#267050]"
            >
              {resumeAll.isPending ? "Resuming…" : "Resume Fleet"}
            </button>
          </div>
        )}
        <div className="stagger-children">
          <Outlet />
        </div>
      </main>

      <Modal title="Global Emergency Stop" isOpen={showKillModal} onClose={() => setShowKillModal(false)}>
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-ink-2)]">
            This will trigger the <strong className="text-[var(--color-ink)]">emergency stop</strong> across all registered AI
            agents in the fleet. All autonomous wallet signing and settlement on Algorand will be frozen until lifted by an
            operator.
          </p>

          {killSuccess && (
            <div className="rounded-lg border border-[#a8cfb8] bg-[var(--color-success-soft)] px-3 py-2 text-xs font-semibold text-[var(--color-success)]">
              All autonomous agent spending has been halted.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowKillModal(false)} className={btnGhost} disabled={emergencyStopAll.isPending}>
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

      <Modal title="Reset Demo" isOpen={showResetModal} onClose={() => setShowResetModal(false)}>
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-ink-2)]">
            Clears all <strong className="text-[var(--color-ink)]">payments, settlements and timeline</strong> but keeps agents,
            wallets and policies. Use between judge runs so the next demo starts clean.
          </p>
          {resetDemo.isError && (
            <div className="rounded-lg border border-[#e5b0a6] bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
              {(resetDemo.error as Error)?.message ?? "Reset failed"}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowResetModal(false)} className={btnGhost} disabled={resetDemo.isPending}>
              Cancel
            </button>
            <button onClick={() => resetDemo.mutate()} disabled={resetDemo.isPending} className={btnDanger}>
              {resetDemo.isPending ? "Resetting…" : "Confirm Reset"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}