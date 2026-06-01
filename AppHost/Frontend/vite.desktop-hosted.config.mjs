import path from "path";
import { pathToFileURL } from "url";

const projectRoot = process.cwd();
const viteModulePath = pathToFileURL(path.resolve(projectRoot, "node_modules/vite/dist/node/index.js")).href;
const reactPluginModulePath = pathToFileURL(path.resolve(projectRoot, "node_modules/@vitejs/plugin-react/dist/index.js")).href;

const { defineConfig } = await import(viteModulePath);
const reactModule = await import(reactPluginModulePath);
const react = reactModule.default ?? reactModule;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    allowedHosts: true,
    hmr: false,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:4000",
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 5000,
  },
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "./src"),
      "@getmocha/users-service/react": path.resolve(
        projectRoot,
        "./src/react-app/mocks/getmochaUsersServiceReact.tsx"
      ),
    },
  },
});
