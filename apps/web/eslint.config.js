import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { window: "readonly", document: "readonly", navigator: "readonly", console: "readonly", crypto: "readonly", URL: "readonly", Blob: "readonly", fetch: "readonly", setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", BroadcastChannel: "readonly", FormData: "readonly", File: "readonly", Response: "readonly", Request: "readonly", HTMLElement: "readonly" } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react/no-danger": "off",
      "no-restricted-syntax": [
        "error",
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "dangerouslySetInnerHTML is banned (CSP, XSS)." },
      ],
      "no-restricted-globals": ["error", { name: "fetch", message: "Use @ari/api-client." }],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "localStorage", message: "Use shared ui-prefs." },
        { object: "window", property: "sessionStorage", message: "Client storage is not allowed for app data." },
        { object: "window", property: "indexedDB", message: "Client storage is not allowed for app data." },
        { property: "localStorage", message: "Use lib/ui-prefs.ts" },
        { property: "sessionStorage", message: "Client storage is not allowed for app data." },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/lib/ui-prefs.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    rules: { "no-restricted-globals": "off", "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["e2e/**/*.ts", "mock-server/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly", setTimeout: "readonly", crypto: "readonly" } },
    rules: { "no-empty-pattern": "off", "@typescript-eslint/no-unused-vars": "off" },
  },
);
