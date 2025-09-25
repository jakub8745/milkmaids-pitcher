import { defineConfig } from "vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("three-bvh-csg")) {
            return "vendor-csg";
          }

          if (id.includes("three/examples") || id.includes("three")) {
            return "vendor-three";
          }
        }
      }
    }
  }
});
