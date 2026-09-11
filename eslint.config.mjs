import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      '.next/**',
      '.next-*/**',
      'node_modules/**',
      'public/**',
      'screenshots/**',
      'stitch_bakenye_mobile_sacco_navigator/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Node scripts run outside the Next.js bundle.
    files: ['scripts/**/*.mjs'],
    rules: { '@next/next/no-assign-module-variable': 'off' },
  },
];

export default config;
