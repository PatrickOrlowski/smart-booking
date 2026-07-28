import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Równoległe dist diry agentów (NEXT_DIST_DIR) i wygenerowany klient Prismy:
    ".next-*/**",
    "src/generated/**",
    // mobile/ to osobny projekt Expo z własnym lintem (`npm run lint` w mobile/) —
    // reguły Next.js nie mają tam zastosowania.
    "mobile/**",
  ]),
]);

export default eslintConfig;
