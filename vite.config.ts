import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  plugins: [],

  tanstackStart: {
    server: { entry: "server" },
  },
});