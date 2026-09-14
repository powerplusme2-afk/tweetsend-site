/**
 * The chain is the truth about whether an intent was paid.
 *
 * A pay page posts two hashes. Before an intent turns `paid` this module
 * fetches the receipts itself and checks: the USDG transaction succeeded, it
 * emitted a `Transfer` from the USDG contract on this chain with `to` equal to
 * the recipient's wallet and `value` at least the intent amount; and, when an
 * ETH hash is given, that transaction succeeded and sent value to the same
 * wallet. A hash for the wrong token, the wrong recipient or a smaller amount
 * is refused with the reason. Nothing the browser claims is trusted.
 */
import { decodeEventLog, getAddress, parseUnits, type Hash } from 'viem';
import { chainId, publicClient, usdgAddress, usdgDecimals } from '../app/chain';
import { erc20Abi } from '../app/chain/abi';

export interface Verified {
  ok: true;
  from: string;
  usdgRaw: bigint;
  ethWei: bigint | null;
}

export interface Refused {
  ok: false;
  reason: string;
}

export async function verifyPayment(args: {
  usdgHash: string;
  ethHash?: string | null;
  recipient: string;
  amountUsd: number;
}): Promise<Verified | Refused> {
  const { usdgHash, ethHash, recipient, amountUsd } = args;
  if (!/^0x[0-9a-fA-F]{64}$/.test(usdgHash)) return { ok: false, reason: 'That is not a transaction hash.' };
  const client = publicClient();
  const want = getAddress(recipient);
  const needRaw = parseUnits(amountUsd.toFixed(2), usdgDecimals());
  const token = getAddress(usdgAddress());

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: usdgHash as Hash });
  } catch {
    return { ok: false, reason: `Transaction ${usdgHash} was not found on chain ${chainId()} yet.` };
  }
  if (receipt.status !== 'success') return { ok: false, reason: 'The USDG transaction reverted.' };

  let from = '';
  let paid = 0n;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== token) continue;
    try {
      const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      if (ev.eventName !== 'Transfer') continue;
      const a = ev.args as { from: string; to: string; value: bigint };
      if (getAddress(a.to) !== want) continue;
      paid += a.value;
      from = a.from;
    } catch {
      /* not a Transfer */
    }
  }
  if (paid === 0n) return { ok: false, reason: 'That transaction did not move USDG to the recipient wallet.' };
  if (paid < needRaw) {
    return { ok: false, reason: `That transaction moved less than the intent amount (${paid} < ${needRaw} raw).` };
  }

  let ethWei: bigint | null = null;
  if (ethHash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(ethHash)) return { ok: false, reason: 'The ETH hash is not a transaction hash.' };
    try {
      const [r, tx] = await Promise.all([
        client.getTransactionReceipt({ hash: ethHash as Hash }),
        client.getTransaction({ hash: ethHash as Hash }),
      ]);
      if (r.status !== 'success') return { ok: false, reason: 'The ETH drip transaction reverted.' };
      if (!tx.to || getAddress(tx.to) !== want) return { ok: false, reason: 'The ETH drip went to a different address.' };
      ethWei = tx.value;
    } catch {
      return { ok: false, reason: `ETH transaction ${ethHash} was not found on chain ${chainId()} yet.` };
    }
  }

  return { ok: true, from, usdgRaw: paid, ethWei };
}
