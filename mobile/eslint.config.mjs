// Aplikacja mobilna to osobny projekt — reguły Next.js z korzenia repo
// jej nie dotyczą (root eslint.config.mjs ignoruje mobile/**).
import expoConfig from "eslint-config-expo/flat.js";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  expoConfig,
  globalIgnores(["dist/**", ".expo/**", "node_modules/**"]),
]);
