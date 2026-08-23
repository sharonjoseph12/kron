import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { PeraWalletConnect } from "@perawallet/connect";
import { api } from "../api/client.js";
import { btnGhost, btnPrimary, ErrorBox, inputClass, labelClass } from "../components/ui.js";

// Pera Wallet Connect is lazy-loaded on first click (keeps the login page
// bundle small). chainId 416002 = TestNet (matches the KRON deployment).
// No WalletConnect project ID is required — Pera runs the relay.
let peraWalletPromise: Promise<PeraWalletConnect> | null = null;
function getPeraWallet(): Promise<PeraWalletConnect> {
  if (!peraWalletPromise) {
    peraWalletPromise = import("@perawallet/connect").then(({ PeraWalletConnect }) =>
      new PeraWalletConnect({ chainId: 416002, shouldShowSignTxnToast: false }),
    );
  }
  return peraWalletPromise;
}

interface PeraChallenge {
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  origin: string;
}

/** Must mirror apps/api/src/lib/siwa.ts buildSiwaMessage exactly. */
function buildSiwaMessage(origin: string, address: string, challenge: { nonce: string }): string {
  return [
    "KRON Operator Login",
    "",
    `Origin: ${origin}`,
    `Address: ${address}`,
    `Nonce: ${challenge.nonce}`,
  ].join("\n");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default function Login() {
  const [email, setEmail] = useState("admin@kron.dev");
  const [password, setPassword] = useState("admin1234");
  const [peraError, setPeraError] = useState<string | null>(null);
  const [peraPending, setPeraPending] = useState(false);
  const navigate = useNavigate();

  const login = useMutation({
    mutationFn: () => api.login(email.trim(), password),
    onSuccess: () => navigate("/", { replace: true }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  const onPeraLogin = async () => {
    setPeraError(null);
    setPeraPending(true);
    try {
      const peraWallet = await getPeraWallet();
      try {
        if (peraWallet.isConnected) {
          await peraWallet.disconnect();
        }
      } catch {}
      const accounts = await peraWallet.connect();
      const address = accounts[0];
      if (!address) throw new Error("No account returned from Pera Wallet");

      const challenge = await api.peraChallenge();
      const message = buildSiwaMessage(challenge.origin, address, challenge);

      const signatures = await peraWallet.signData(
        [{ data: new TextEncoder().encode(message), message: "Sign in to the KRON operator dashboard" }],
        address,
      );
      const signature = signatures[0];
      if (!signature) throw new Error("No signature returned from Pera Wallet");

      await api.peraVerify({ address, signature: bytesToBase64(signature), nonce: challenge.nonce });
      navigate("/", { replace: true });
    } catch (err) {
      const e = err as { data?: { type?: string } };
      if (e?.data?.type === "CONNECT_MODAL_CLOSED") return; // user closed the QR modal
      setPeraError(err instanceof Error ? err.message : String(err));
    } finally {
      setPeraPending(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--color-canvas)] px-4">
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/3 border-l border-[var(--color-line)] dotted-grid lg:block" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-[var(--color-accent)]/5 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 anim-fade-up">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-ink)] font-mono text-xl font-bold text-[#fffcf6] shadow-sm">
            K
          </div>
          <div className="text-center">
            <h1 className="display-serif text-3xl font-bold tracking-tight text-[var(--color-ink)]">KRON</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-3)]">Policy-Controlled Economic Runtime</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="anim-blur-fade-in stagger-children rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface-3)] p-6 shadow-sm">
          <h2 className="mb-5 display-serif text-base font-semibold tracking-tight text-[var(--color-ink)]">Operator sign in</h2>

          <div className="mb-4">
            <label className={labelClass} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="mb-5">
            <label className={labelClass} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {login.isError ? (
            <div className="mb-4">
              <ErrorBox message={login.error instanceof Error ? login.error.message : "Login failed"} />
            </div>
          ) : null}

          <button type="submit" disabled={login.isPending} className={`${btnPrimary} w-full`}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--color-line)]" />
            <span className="text-[11px] uppercase tracking-widest text-[var(--color-ink-3)]">or</span>
            <div className="h-px flex-1 bg-[var(--color-line)]" />
          </div>

          {peraError ? (
            <div className="mb-4">
              <ErrorBox message={peraError} />
            </div>
          ) : null}

          <button type="button" onClick={onPeraLogin} disabled={peraPending} className={`${btnGhost} w-full`}>
            {peraPending ? "Waiting for Pera Wallet…" : "Sign in with Pera Wallet (QR)"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-[var(--color-ink-3)]">
          Demo console · admin@kron.dev / admin1234
        </p>
      </div>
    </div>
  );
}