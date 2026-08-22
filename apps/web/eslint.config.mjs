import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Vendored at install time by scripts/vendor-hand-model.mjs — MediaPipe's
      // own WASM glue, minified and generated. Linting somebody else's build
      // output produces noise that buries this project's own findings, which is
      // how a lint step stops being read.
      "public/mediapipe/**",
    ],
  },
];

export default eslintConfig;
