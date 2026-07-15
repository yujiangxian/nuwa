// SPDX-License-Identifier: MIT
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NUWA_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
