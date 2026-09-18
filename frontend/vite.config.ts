import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep the heaviest third-party graphs out of the entry chunk so
        // first paint parses app code first. Names are stable across builds
        // for long-term caching; recharts/monaco already split via lazy().
        // Function form: Rollup ids are posix-style even on Windows, and the
        // anchored regexes avoid matching react-hot-toast etc.
        manualChunks(id: string): string | undefined {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)(\/|$)/.test(id)) return "vendor-react";
          if (/node_modules\/(@xyflow|zustand)(\/|$)/.test(id)) return "vendor-flow";
          if (/node_modules\/@tanstack(\/|$)/.test(id)) return "vendor-table";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
