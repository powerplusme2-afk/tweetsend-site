/** JSON in, JSON out. Every route uses these two, so every error has the same shape. */
import { AuthError } from './auth';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

/** Wraps a handler so a thrown AuthError is a 401 and anything else a plain 500 with the message. */
export function guard(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => {
    if (err instanceof AuthError) return fail(err.message, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === 'privy-secret-missing') return fail('PRIVY_APP_SECRET is not set on the server, so this cannot be done yet.', 503, { code });
    if (code === 'x-keys-missing') return fail('The X API keys are not set on the server, so this cannot be done yet.', 503, { code });
    console.error(err);
    return fail(msg, 500);
  });
}

export async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Strips server-only columns before an intent leaves the API. */
export function publicIntent(i: Record<string, unknown>) {
  const { sender_privy_id: _a, ...rest } = i;
  return { ...rest, amount_usd: Number(rest.amount_usd) };
}
