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
