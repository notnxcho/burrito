import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Local dev: proxy /api to `vercel dev` (running on :3000) so the app works end-to-end.
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
