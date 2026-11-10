import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 10888,
    strictPort: true,
    watch: { ignored: ["**/runs/**"] },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          vendor: ["react", "react-dom"],
        },
      },
    },
  },
});
