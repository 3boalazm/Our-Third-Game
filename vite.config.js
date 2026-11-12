import { defineConfig } from "vite";

export default defineConfig({
  // `host` and `allowedHosts` let the sandbox preview (and phones on the same
  // network) open the dev server; they only affect `npm run dev`.
  server: {
    host: true,
    allowedHosts: true,
  },
  build: {
    target: "es2022",
  },
});
