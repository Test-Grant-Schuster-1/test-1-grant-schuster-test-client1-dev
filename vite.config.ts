import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Thin client shell: build src/main.tsx (which mounts the @simply-now-enabler runtime package) to dist/.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
});
