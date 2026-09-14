/**
 * The shared transaction primitives. Every write in the app goes through here.
 *
 * TweetSend has no contract. A payment is two plain transfers from the
 * sender's wallet to the recipient's pre-made wallet: the USDG itself, and —
 * on mainnet, where Privy does not sponsor gas — a dust ETH drip so the
 * recipient can move the money out (decision B2 in the plan: the sender pays
 * it). The sequencing rules are the sibling apps': read the balance first
 * and refuse locally with both numbers; check the wallet's network before
 * broadcasting; wait for every receipt. A rejected signature is a decision,
 * not a fault, and reads as one.
 */
import { createWalletClient, custom, parseEther, type Address, type Hash } from 'viem';
import { chainId, config, publicClient, usdgAddress, viemChain } from './index';
import { erc20Abi } from './abi';

export type Step =
  | 'validating'
  | 'checking-balance'
  | 'switching-network'
  | 'sending-usdg'
  | 'confirming-usdg'
  | 'sending-eth'
  | 'confirming-eth'
  | 'recording'
  | 'done';

export type OnStep = (step: Step, detail?: string) => void;

/** The ETH drip that rides along with a mainnet send. ≈ $0.50 at Sep 2026 prices. */
export const DRIP_ETH = '0.0002';
export const DRIP_WEI = parseEther(DRIP_ETH);

/** True where the recipient needs the drip: mainnet. The testnet is sponsored. */
export function dripNeeded(): boolean {
  return !config().gasSponsored;
}

export function signingError(err: unknown, what: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/user rejected|denied|rejected the request/i.test(msg)) {
    return 'You rejected it in your wallet. Nothing was sent.';
  }
  if (/insufficient funds/i.test(msg)) {
    return 'Not enough ETH on this chain to pay gas for this transaction.';
  }
  return `The ${what} could not be sent — ${msg.split('\n')[0]}`;
}

export async function walletOn(address: string, provider: unknown, onStep?: OnStep) {
  const id = chainId();
  const wallet = createWalletClient({
    account: address as Address,
    chain: viemChain(id),
    transport: custom(provider as Parameters<typeof custom>[0]),
  });
  const current = await wallet.getChainId();
  if (current !== id) {
    onStep?.('switching-network');
    try {
      await wallet.switchChain({ id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const unknown = /4902|unrecognized chain|unrecognised chain|chain .* not added|addEthereumChain/i.test(msg);
      if (!unknown) throw err;
      await wallet.addChain({ chain: viemChain(id) });
      await wallet.switchChain({ id });
    }
  }
  return wallet;
}

export async function waitOk(hash: Hash, what: string): Promise<string | null> {
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  return receipt.status === 'success' ? null : `The ${what} transaction failed on chain.`;
}

export async function usdgBalance(owner: string): Promise<bigint> {
  return (await publicClient().readContract({
    address: usdgAddress(),
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner as Address],
  })) as bigint;
}

export async function gasBalance(address: string): Promise<bigint> {
  return publicClient().getBalance({ address: address as Address });
}

export interface PayArgs {
  from: string;
  to: string;
  amountRaw: bigint;
  provider: unknown;
  /** Send the ETH drip too. Forced off on the sponsored testnet. */
  drip: boolean;
  onStep?: OnStep;
}

export interface PayResult {
  usdgHash: Hash | null;
  ethHash: Hash | null;
  reason: string | null;
}

/**
 * USDG to the recipient, then the ETH drip. Two signatures on mainnet, one on
 * the testnet. Stops at the first failure and reports what did land, so the
 * page never says "nothing happened" after the USDG already moved.
 */
export async function pay(args: PayArgs): Promise<PayResult> {
  const { from, to, amountRaw, provider, onStep } = args;
  const drip = args.drip && dripNeeded();
  const out: PayResult = { usdgHash: null, ethHash: null, reason: null };
  try {
    onStep?.('checking-balance');
    const [usdg, eth] = await Promise.all([usdgBalance(from), gasBalance(from)]);
    if (usdg < amountRaw) {
      out.reason = 'Not enough USDG in this wallet for this send.';
      return out;
    }
    if (drip && eth < DRIP_WEI) {
      out.reason = `This send includes a ${DRIP_ETH} ETH drip for the recipient's gas, and this wallet has less than that.`;
      return out;
    }
    const wallet = await walletOn(from, provider, onStep);

    onStep?.('sending-usdg');
    out.usdgHash = await wallet.writeContract({
      address: usdgAddress(), abi: erc20Abi, functionName: 'transfer', args: [to as Address, amountRaw],
    });
    onStep?.('confirming-usdg');
    const bad = await waitOk(out.usdgHash, 'USDG transfer');
    if (bad) { out.reason = bad; return out; }

    if (drip) {
      onStep?.('sending-eth');
      out.ethHash = await wallet.sendTransaction({ to: to as Address, value: DRIP_WEI });
      onStep?.('confirming-eth');
      const badEth = await waitOk(out.ethHash, 'ETH drip');
      if (badEth) { out.reason = badEth; return out; }
    }
    return out;
  } catch (err) {
    out.reason = signingError(err, out.usdgHash ? 'ETH drip' : 'USDG transfer');
    return out;
  }
}

/** Testnet only: mint free USDG to the reader's own wallet. */
export async function mintTest(args: { to: string; amountRaw: bigint; provider: unknown; onStep?: OnStep }) {
  const { to, amountRaw, provider, onStep } = args;
  try {
    const wallet = await walletOn(to, provider, onStep);
    onStep?.('sending-usdg', 'minting test USDG');
    const hash = await wallet.writeContract({
      address: usdgAddress(), abi: erc20Abi, functionName: 'mint', args: [to as Address, amountRaw],
    });
    const bad = await waitOk(hash, 'mint');
    return { hash, reason: bad };
  } catch (err) {
    return { hash: null, reason: signingError(err, 'mint') };
  }
}
