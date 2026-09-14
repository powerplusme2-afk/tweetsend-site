/**
 * The chain this app reads, and the client it reads with.
 *
 * Shared by the browser and the API routes: both must agree on which chain an
 * intent lives on and which token address counts as USDG. The network is fixed
 * at build time by `PUBLIC_CHAIN_ID` (46630 while the flow is being proven,
 * 4663 at launch) — there is no per-request switch, because a pay link that
 * could quietly point at a different chain than the intent it belongs to is a
 * way to lose money.
 *
 * The primary Robinhood RPC is rate-limited, so the transport is a viem
 * `fallback` over the endpoints in the book with open CORS. No endpoint takes
 * an API key — this app holds no keys of any kind in the browser.
 */
import { createPublicClient, fallback, http, type Address, type Chain } from 'viem';
import book from './book.json';

export interface ChainConfig {
  name: string;
  rpc: string[];
  rpcLogs?: string[];
  explorer: string;
  multicall3: string;
  usdg: string;
  usdgDecimals: number;
  usdgMintable: boolean;
  /** Privy sponsors embedded-wallet gas here (testnet only). */
  gasSponsored: boolean;
}

const BOOK = book as unknown as Record<string, ChainConfig>;

export const MAINNET_ID = 4663;
export const TESTNET_ID = 46630;

function envChain(): number {
  const raw = (import.meta.env.PUBLIC_CHAIN_ID as string | undefined) ?? '';
  const n = Number(raw);
  if (n === MAINNET_ID || n === TESTNET_ID) return n;
  return TESTNET_ID;
}

/** Which network the app is pointed at. Fixed per build. */
export function chainId(): number {
  return envChain();
}

export function isTestnet(): boolean {
  return chainId() === TESTNET_ID;
}

export function config(id: number = chainId()): ChainConfig {
  return BOOK[String(id)] ?? BOOK[String(TESTNET_ID)]!;
}

export function usdgAddress(id: number = chainId()): Address {
  return config(id).usdg as Address;
}

export function usdgDecimals(id: number = chainId()): number {
  return config(id).usdgDecimals ?? 6;
}

export function viemChain(id: number = chainId()): Chain {
  const c = config(id);
  return {
    id,
    name: c.name,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: c.rpc } },
    contracts: { multicall3: { address: c.multicall3 as Address } },
    blockExplorers: { default: { name: 'Blockscout', url: c.explorer } },
  };
}

const clients = new Map<number, ReturnType<typeof createPublicClient>>();

export function publicClient(id: number = chainId()) {
  const cached = clients.get(id);
  if (cached) return cached;
  const c = config(id);
  const client = createPublicClient({
    chain: viemChain(id),
    transport: fallback(
      c.rpc.map((url) => http(url, { batch: { wait: 16 }, retryCount: 3, retryDelay: 500 })),
      { rank: false, retryCount: 1 },
    ),
    batch: { multicall: { wait: 16 } },
  });
  clients.set(id, client);
  return client;
}

export function txUrl(hash: string, id: number = chainId()): string {
  return `${config(id).explorer}/tx/${hash}`;
}

export function addressUrl(address: string, id: number = chainId()): string {
  return `${config(id).explorer}/address/${address}`;
}

/** The wallet's reported chain, as a number, or null if it is not saying. */
export function chainIdOf(caip: string | number | undefined | null): number | null {
  if (caip === undefined || caip === null) return null;
  if (typeof caip === 'number') return caip;
  const m = /^eip155:(\d+)$/.exec(caip);
  if (m) return Number(m[1]);
  const n = Number(caip);
  return Number.isFinite(n) ? n : null;
}
