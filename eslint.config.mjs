import js from "@eslint/js"
import tseslint from "typescript-eslint"
import nextPlugin from "@next/eslint-plugin-next"
import reactPlugin from "eslint-plugin-react"
import reactHooks from "eslint-plugin-react-hooks"

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "src/db/migrations/**",
      "next-env.d.ts",
      "*.config.mjs",
      "*.config.ts",
      "scripts/**/*.mjs",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@next/next": nextPlugin,
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Banned everywhere; pino is the structured logger. Tests/scripts/
      // instrumentation files are unbanned by overrides below.
      "no-console": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
    settings: {
      react: { version: "detect" },
      next: { rootDir: "./" },
    },
  },
  // -------- Layered import rules --------
  // No DB access from `app/**` — routes go through queries.ts / actions.ts.
  // Documented exception in AGENTS.md hard rule #1: cron, queue, and the
  // file-download proxy are deliberate escape hatches.
  {
    files: ["app/**/*.ts", "app/**/*.tsx"],
    ignores: [
      "app/api/jobs/**",
      "app/api/files/**",
      "app/api/blob/**",
      "app/api/auth/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db", "@/db/*", "drizzle-orm", "drizzle-orm/*", "@/lib/db"],
              message:
                "Do not import the database directly from app/. Use queries.ts or actions.ts in the relevant module. (See AGENTS.md hard rule #1.)",
            },
            {
              group: ["@/modules/*/schema"],
              message:
                "Do not import schemas from app/. Use the module's queries.ts / actions.ts.",
            },
          ],
        },
      ],
    },
  },
  // Module 17b: writers.ts is the ONLY file in src/modules/ai-assistant/
  // permitted to import @/modules/<other>/actions. Every other file in
  // the module routes reads through queries.ts and never reaches into
  // another module's write surface. The Zone-1 static-grep test
  // (ai-assistant-privileged-write-bypass.test.ts) enforces this from
  // the other direction.
  {
    files: ["src/modules/ai-assistant/**/*.ts", "src/modules/ai-assistant/**/*.tsx"],
    ignores: ["src/modules/ai-assistant/writers.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*/actions"],
              message:
                "Only src/modules/ai-assistant/writers.ts may import @/modules/<x>/actions. Every other AI assistant file must go through queries.ts (reads) or the writers.ts allowlist (writes). See docs/PIVOTS_LEDGER.md (AI1).",
            },
          ],
        },
      ],
    },
  },
  // `@anthropic-ai/sdk` is allowed ONLY in src/lib/ai-model.ts — the
  // single grep-able surface for the AI provider integration. This is
  // the locked posture per docs/PIVOTS_LEDGER.md (AI layer guiding
  // principle): one named external dependency, contained at one site.
  {
    files: [
      "src/**/*.ts",
      "src/**/*.tsx",
      "app/**/*.ts",
      "app/**/*.tsx",
      "tests/**/*.ts",
      "tests/**/*.tsx",
    ],
    ignores: ["src/lib/ai-model.ts", "tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*"],
              message:
                "Import the AI model only via @/lib/ai-model. The Anthropic SDK is contained to that single file per docs/PIVOTS_LEDGER.md (AI1).",
            },
          ],
        },
      ],
    },
  },
  // No default exports in `src/modules/**` and `src/lib/**`. Named only.
  // Implements AGENTS.md hard rule #7 — enforced by lint, not just docs.
  {
    files: ["src/modules/**/*.ts", "src/modules/**/*.tsx", "src/lib/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration",
          message:
            "Use named exports in src/modules/** and src/lib/**. (See AGENTS.md hard rule #7.)",
        },
      ],
    },
  },
  // -------- Test / script overrides --------
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["scripts/**/*.ts", "scripts/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["instrumentation.ts", "instrumentation-client.ts", "sentry.*.config.ts"],
    rules: {
      "no-console": "off",
    },
  },
)
