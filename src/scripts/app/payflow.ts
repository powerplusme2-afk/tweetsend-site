/**
 * The one payment sequence, used by Send (site intents) and by /pay/:id (tweet
 * intents): USDG transfer, ETH drip on mainnet, then tell the server the
 * hashes so it can check the receipts and mark the intent paid.
 */
import { parseUnits } from 'viem';
import { config, usdgDecimals } from '../../app/chain';
import { pay, DRIP_ETH, dripNeeded, type Step } from '../../app/chain/tx';
import { api, privy, STEP_WORDS, sheetBusy, sheetErr, sheetNote, txLink, setHtml, show } from './shell';

export interface PayableIntent {
  id: string;
  recipient_wallet: string | null;
  recipient_handle: string | null;
  amount_usd: number;
}

export interface PaidOutcome {
  ok: boolean;
  usdgHash: string | null;
  ethHash: string | null;
  reason: string | null;
  intent?: Record<string, unknown>;
}

export const DRIP_ETH_LABEL = `${DRIP_ETH} ETH to their wallet`;

export function dripSentence(): string {
  return dripNeeded()
    ? `Plus ${DRIP_ETH} ETH from your wallet to theirs, so they can move the money out. Two signatures.`
    : `On ${config().name} gas is sponsored, so there is no ETH drip. One signature.`;
}

export async function runPayment(intent: PayableIntent, sheet: ParentNode): Promise<PaidOutcome> {
  const p = privy();
  const out: PaidOutcome = { ok: false, usdgHash: null, ethHash: null, reason: null };
  if (!p?.signer || !p.provider) {
    out.reason = 'No wallet to sign with.';
    return out;
  }
  if (!intent.recipient_wallet) {
    out.reason = 'This send has no recipient wallet yet.';
    return out;
  }
  sheetErr(sheet, null);
  sheetBusy(sheet, true);
  const onStep = (s: Step, d?: string) => sheetNote(sheet, d ? `${STEP_WORDS[s]} (${d})` : STEP_WORDS[s] ?? s);
  try {
    const provider = await p.provider();
    const r = await pay({
      from: p.signer,
      to: intent.recipient_wallet,
      amountRaw: parseUnits(Number(intent.amount_usd).toFixed(2), usdgDecimals()),
      provider,
      drip: true,
      onStep,
    });
    out.usdgHash = r.usdgHash;
    out.ethHash = r.ethHash;
    if (r.reason) {
      out.reason = r.reason;
      sheetErr(sheet, r.reason + (r.usdgHash ? ` The USDG did go through: ${r.usdgHash}` : ''));
      if (!r.usdgHash) return out;
    }
    onStep('recording');
    const rec = await api<{ intent: Record<string, unknown> }>(`/api/intents/${intent.id}/paid`, {
      method: 'POST',
      body: JSON.stringify({ usdgHash: r.usdgHash, ethHash: r.ethHash, amountUsd: Number(intent.amount_usd) }),
    });
    out.intent = rec.intent;
    out.ok = true;
    onStep('done');
    return out;
  } catch (err) {
    out.reason = err instanceof Error ? err.message : String(err);
    sheetErr(sheet, out.reason);
    return out;
  } finally {
    sheetBusy(sheet, false);
    sheetNote(sheet, null);
  }
}

/** Fills the "done" sheet's hash rows. */
export function paintDone(root: ParentNode, o: PaidOutcome): void {
  setHtml('[data-done-hash]', o.usdgHash ? txLink(o.usdgHash, `${o.usdgHash.slice(0, 10)}… on Blockscout`) : '—', root);
  show('[data-done-eth-row]', Boolean(o.ethHash), root);
  if (o.ethHash) setHtml('[data-done-eth]', txLink(o.ethHash, `${o.ethHash.slice(0, 10)}… on Blockscout`), root);
}
