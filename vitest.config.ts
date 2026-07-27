import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    // Testy integracyjne uderzają w bazę dev — .env musi być załadowany.
    setupFiles: ["dotenv/config"],
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Testy integracyjne piszą do wspólnej bazy; równoległe pliki potrafią
    // wejść sobie w drogę.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
