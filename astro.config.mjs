// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  /* Server output: this app has API routes (`src/pages/api/*`) that read and
     write the intents table, verify Privy tokens and check receipts on chain.
     Every page that has no server data is still prerendered (`prerender = true`
     at the top of the file), so the app shell ships as
     static HTML exactly like the sibling apps. */
  output: 'server',
  adapter: vercel(),
  /* This deployment is the app only. The bare domain sends the reader to the
     marketing site (tweetsend-vivid), whose every CTA points at /app here
     (client, 14 Sep 2026 evening — replaces the earlier "/ lands on the
     dashboard"). */
  redirects: { '/': 'https://tweetsend-vivid.vercel.app/' },
  /* React is here for exactly one reason: Privy ships as a React SDK and the
     sign-in is a real wallet connection. It runs on the /app* and /pay/* pages. */
  integrations: [react()],
  build: {
    format: 'directory',
  },
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ['@privy-io/react-auth'],
    },
    optimizeDeps: {
      /* Everything the /app pages import from node_modules, listed on purpose
         — see the sibling app for the 504 "Outdated Optimize Dep" story. A
         new bare package used anywhere under src/app or src/scripts/app
         belongs in this list. */
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'viem',
        '@privy-io/react-auth',
        '@solana/kit',
        '@solana-program/memo',
        '@solana-program/system',
        '@solana-program/token',
      ],
    },
    css: {
      lightningcss: { targets: { chrome: 111 << 16, safari: 16 << 16, firefox: 103 << 16 } },
    },
    build: { cssTarget: ['chrome111', 'safari16', 'firefox103'] },
  },
});
