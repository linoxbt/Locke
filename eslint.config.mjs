import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "contracts/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // CIP-30 wallet objects and Strike payloads are loosely typed at the edges.
      "@typescript-eslint/no-explicit-any": "off",
      // Wallet icons are data: URIs supplied by the extension; next/image adds nothing.
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
