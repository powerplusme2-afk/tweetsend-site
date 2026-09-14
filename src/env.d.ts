/// <reference types="astro/client" />
interface ImportMetaEnv {
  readonly PUBLIC_PRIVY_APP_ID?: string;
  readonly PUBLIC_CHAIN_ID?: string;
  readonly PUBLIC_SITE_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }
