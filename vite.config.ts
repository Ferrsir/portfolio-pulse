import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// PAGES_BASE is set by the GitHub Pages workflow (the site lives under /portfolio-pulse/).
export default defineConfig({
  base: process.env.PAGES_BASE || "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: app updates do not re-download the chart library.
        codeSplitting: {
          groups: [
            { name: "charts", test: /node_modules[\/](recharts|d3-|victory-vendor|decimal\.js|es-toolkit|immer|@reduxjs|redux|reselect|react-redux)/ },
            { name: "react", test: /node_modules[\/](react|react-dom|scheduler)[\/]/ },
            { name: "vendor", test: /node_modules/ },
          ],
        },
      },
    },
  },
});
