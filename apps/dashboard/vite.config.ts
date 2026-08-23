import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiUrl = process.env.VITE_KRON_API_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiUrl,
      "/mcp": apiUrl,
    },
  },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router")) return "react";
          if (id.includes("node_modules/@tanstack")) return "query";
          if (id.includes("node_modules/recharts")) return "charts";
          if (id.includes("node_modules/@perawallet") || id.includes("node_modules/qr-code") || id.includes("node_modules/beacon")) return "wallet";
          if (id.includes("node_modules/msgpack") || id.includes("node_modules/algosdk")) return "algo";
        },
      },
    },
  },
});