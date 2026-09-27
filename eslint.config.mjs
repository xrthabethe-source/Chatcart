import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const restrictedPrismaImport = {
  paths: [
    {
      name: "@prisma/client",
      message:
        "Import the shared client from '@/server/db' inside src/server/services only. Keeps the dashboard, storefront and WhatsApp flow on one code path.",
    },
  ],
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  {
    // Service-layer boundary: outside of src/server/db.ts and
    // src/server/services/**, nothing may import @prisma/client directly.
    // That keeps the dashboard and the REST API on one code path instead
    // of two copies of the same business logic.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", restrictedPrismaImport],
    },
  },
  {
    files: ["src/server/db.ts", "src/server/services/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default eslintConfig;
