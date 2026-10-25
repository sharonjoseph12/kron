/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KRON_API_URL?: string;
  readonly VITE_DEMO_LOGIN?: string;
  readonly VITE_GOLDEN_AMOUNT_ALGO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}