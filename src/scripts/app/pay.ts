import { config } from '../../app/chain';
import { LIMITS } from '../../../shared/command.mjs';
import { blockedReason, bootShell, closeSheets, el, esc, onWallet, openSheet, privy, setHtml, setText, show, txLink, usd, whoami } from './shell';
import { dripSentence, paintDone, runPayment } from './payflow';

export function bootPay(): void {
  bootShell();
  const root = el<HTMLElement>('[data-pay]');
  if (!root) return;
  const d = root.dataset;
  const intent = {
    id: d.id!,
    recipient_wallet: d.wallet || null,
    recipient_handle: d.handle || null,
    amount_usd: d.amount ? Number(d.amount) : NaN,
  };
  const open = d.open === '1';
  const amountIn = el<HTMLInputElement>('[data-amount-in]');
  /* Open send: the amount is whatever the sender types, checked against the limits. */
  function typedAmount(): number | null {
    const v = Math.round(Number((amountIn?.value ?? '').replace(/,/g, '')) * 100) / 100;
    if (!Number.isFinite(v) || v < LIMITS.minUsd || v > LIMITS.maxUsd) return null;
    return v;
  }
  const status = d.status ?? 'pending';
  const senderX = d.senderX || null;
  const senderHandle = d.senderHandle || null;

  setText('[data-chain-name]', config().name);
  setText('[data-drip-line]', dripSentence());
  const txCell = el<HTMLElement>('[data-tx-link]');
  if (txCell?.textContent) txCell.innerHTML = txLink(txCell.textContent, `${txCell.textContent.slice(0, 12)}… on Blockscout`);

  const btn = el<HTMLButtonElement>('[data-pay-btn]')!;
  const line = el<HTMLElement>('[data-state-line]')!;

  function statusWord(s: string): string {
    return s === 'paid' ? 'Paid — waiting for the recipient to sign in' : s === 'claimed' ? 'Paid and claimed' : s === 'expired' ? 'Expired' : 'Waiting for your confirmation';
  }
  setText('[data-status-word]', statusWord(status));

  if (status !== 'pending') {
    btn.hidden = true;
    line.hidden = false;
    line.textContent = status === 'expired'
      ? 'This link has expired — nobody paid it within 24 hours. Reply again on X to make a new one.'
      : 'Already paid. The money is in the recipient wallet.';
    return;
  }

  onWallet(() => {
    const p = privy();
    const blocked = blockedReason(true);
    if (blocked) {
      btn.disabled = !p?.ready;
      btn.textContent = blocked;
      btn.onclick = () => p?.login();
      return;
    }
    /* A tweet intent may only be paid by the X account that wrote the reply. */
    if (senderX && p?.x?.id !== senderX) {
      btn.disabled = true;
      btn.textContent = `Sign in as @${senderHandle ?? senderX}`;
      line.hidden = false;
      line.textContent = p?.x
        ? `This send belongs to @${senderHandle ?? senderX}. You are signed in as @${p.x.handle}. Sign out and sign in as @${senderHandle ?? senderX}.`
        : `This send belongs to @${senderHandle ?? senderX}. Your sign-in has no X account linked, so it cannot pay it.`;
      return;
    }
    line.hidden = true;
    btn.disabled = false;
    const label = () => {
      if (!open) return `Send ${usd(intent.amount_usd)}`;
      const v = typedAmount();
      return v == null ? 'Type an amount' : `Send ${usd(v)}`;
    };
    btn.textContent = label();
    if (open && amountIn) amountIn.oninput = () => { btn.textContent = label(); };
    btn.onclick = () => {
      if (open) {
        const v = typedAmount();
        if (v == null) {
          line.hidden = false;
          line.textContent = `Type an amount between ${usd(LIMITS.minUsd)} and ${usd(LIMITS.maxUsd)}.`;
          amountIn?.focus();
          return;
        }
        line.hidden = true;
        intent.amount_usd = v;
      }
      const sheet = el<HTMLElement>('[data-sheet="pay"]')!;
      setHtml('[data-r-to]', `@${esc(intent.recipient_handle ?? '…')}`, sheet);
      setText('[data-r-amount]', `${usd(intent.amount_usd)} USDG`, sheet);
      setText('[data-r-wallet]', intent.recipient_wallet ?? '—', sheet);
      openSheet('pay');
    };
    void whoami();
  });

  el('[data-confirm]')?.addEventListener('click', async () => {
    const sheet = el<HTMLElement>('[data-sheet="pay"]')!;
    const o = await runPayment(intent, sheet);
    if (!o.ok) return;
    closeSheets();
    const done = el<HTMLElement>('[data-sheet="done"]')!;
    setText('[data-done-line]', `${usd(intent.amount_usd)} is in @${intent.recipient_handle}'s wallet. The bot will reply under your tweet.`, done);
    paintDone(done, o);
    openSheet('done');
    setText('[data-status-word]', statusWord('paid'));
    btn.hidden = true;
    show('[data-state-line]', true);
    line.textContent = 'Paid.';
  });
}
