/**
 * Every number the app prints.
 *
 * Rules inherited from the sibling apps: the minus sign is U+2212, a value
 * that could not be read renders as an em dash and never as 0, and a token
 * amount is converted through a string rather than by dividing a Number — 0.1
 * USDG times 1e6 is 100000.00000000001 in float, and that is money.
 */
import { formatUnits } from 'viem';

const MINUS = '−';

/** Raw units to a JS number. Safe for display; never used to rebuild raw. */
export function fromUnits(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

/**
 * A decimal string to raw units, entirely through strings.
 *
 * Anything that is not a plain decimal returns 0n, so a pasted "5 USDG" or an
 * empty box cannot become a transaction for some other amount.
 */
export function toUnits(amount: string, decimals: number): bigint {
  const clean = String(amount).replace(/,/g, '').trim();
  if (!clean || !/^\d*\.?\d*$/.test(clean)) return 0n;
  const [whole, frac = ''] = clean.split('.');
  const padded = frac.slice(0, decimals).padEnd(decimals, '0');
  return BigInt((whole || '0') + (padded || ''));
}

/** Raw 6-dp USDG to `1,234.56 USDG`. Zero is a real answer. */
export function usdgRaw(raw: bigint | null, decimals = 6): string {
  if (raw === null) return '—';
  return usdg(fromUnits(raw, decimals));
}

/** `1,234.56 USDG`. Null is "could not read", not zero. */
export function usdg(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return (
    (n < 0 ? MINUS : '') +
    Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    ' USDG'
  );
}

/** The bare figure, for places that print the unit separately. */
export function num(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return (
    (n < 0 ? MINUS : '') +
    Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  );
}

export function eth(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  if (n === 0) return '0 ETH';
  return `${n >= 0.01 ? n.toFixed(4) : n.toFixed(6)} ETH`;
}

export function ethRaw(raw: bigint | null): string {
  return raw === null ? '—' : eth(fromUnits(raw, 18));
}

export function short(addr: string | null | undefined): string {
  if (!addr || addr.length < 12) return addr || '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Two initials for a recipient chip: a contact's name, or the address stem. */
export function initials(name: string, addr: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  if (words.length === 1 && words[0]!.length >= 2) return words[0]!.slice(0, 2).toUpperCase();
  return addr.slice(2, 4).toUpperCase();
}

/** "2m ago" / "5h ago" / "3d ago". `atS` is unix SECONDS. */
export function ago(atS: number): string {
  if (!atS) return '—';
  const s = Math.max(1, Math.round(Date.now() / 1000 - atS));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return stamp(atS);
}

/** "in 6 h" / "in 23 min" / "now". `untilS` is unix SECONDS. */
export function until(untilS: number): string {
  const left = untilS - Math.floor(Date.now() / 1000);
  if (left <= 0) return 'now';
  if (left < 60) return `in ${left} s`;
  const m = Math.round(left / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} d`;
}

/** "13 Sep 2026, 14:02" in the reader's own timezone. */
export function stamp(unixS: number): string {
  if (!unixS) return '—';
  return new Date(unixS * 1000).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Seconds to "24 h" / "7 days" — the words the rules list uses. */
export function duration(seconds: number): string {
  if (!seconds) return 'none';
  if (seconds % 86_400 === 0) {
    const d = seconds / 86_400;
    return d === 1 ? '24 h' : `${d} days`;
  }
  if (seconds % 3_600 === 0) return `${seconds / 3_600} h`;
  return `${Math.round(seconds / 60)} min`;
}
