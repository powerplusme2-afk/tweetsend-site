/**
 * End-to-end over the API with the dev fake auth: alice sends bob $5 from the
 * site, pays with a real USDG transfer on the testnet from the faucet keystore,
 * the server verifies the receipt, bob signs in and the intent becomes claimed.
 * Run with the dev server up and DEV_FAKE_AUTH=1:  node .verify/e2e.mjs http://localhost:4340
 */
import { execFileSync } from 'node:child_process';
const BASE = process.argv[2] || 'http://localhost:4340';
const KEYSTORE = process.env.KEYSTORE || '../sendly-site/contracts/.keys/a6c6bfd3-9c06-4217-91f4-82f5752b50a4';
const PASSWORD = process.env.KEYSTORE_PASSWORD || 'sendly-testnet';
const RPC = 'https://rpc.testnet.chain.robinhood.com';
const USDG = '0x3292e7a61cCdc571C520dCc9287f98455fF32778';
const FAUCET = '0x9e74bC723dE57d1E3e1613c0840dAAdA82417bA0';
const BOB_WALLET = process.env.BOB_WALLET || '0x000000000000000000000000000000000000b0b0';

const alice = { privyId: 'did:privy:alice', xId: '111', xHandle: 'alice', xName: 'Alice', wallet: FAUCET };
const bob = { privyId: 'did:privy:bob', xId: '222', xHandle: 'bob', xName: 'Bob', wallet: BOB_WALLET };

async function call(user, path, init = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', 'x-dev-user': JSON.stringify(user), ...(init.headers ?? {}) } });
  const j = await r.json();
  return { status: r.status, ...j };
}
function cast(...args) {
  return execFileSync(`${process.env.HOME}/.foundry/bin/cast`, args, { encoding: 'utf8' }).trim();
}
const steps = [];
function ok(name, cond, detail) { steps.push({ name, ok: Boolean(cond), detail }); console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) throw new Error(name); }

const cfg = await (await fetch(BASE + '/api/config')).json();
ok('config readable', cfg.chainId === 46630, `chain ${cfg.chainId}, db ${cfg.database}, devFakeAuth ${cfg.devFakeAuth}`);
ok('dev fake auth on', cfg.devFakeAuth);

let m = await call(bob, '/api/me', { method: 'POST', body: JSON.stringify({ wallet: BOB_WALLET }) });
ok('bob registered', m.status === 200 && m.user.xHandle === 'bob', `wallet ${m.user.wallet}`);
m = await call(alice, '/api/me', { method: 'POST', body: JSON.stringify({}) });
ok('alice registered', m.status === 200 && m.user.wallet === FAUCET);

const look = await call(alice, '/api/intents?handle=@Bob');
ok('handle lookup', look.status === 200 && look.recipient.wallet === BOB_WALLET, `via ${look.recipient.via}`);

const bad = await call(alice, '/api/intents', { method: 'POST', body: JSON.stringify({ handle: 'bob', amount: 0.5 }) });
ok('limits enforced', bad.status === 422 && bad.code === 'limits', bad.error);
const self = await call(alice, '/api/intents', { method: 'POST', body: JSON.stringify({ handle: 'alice', amount: 5 }) });
ok('self-send refused', self.status === 422 && self.code === 'self', self.error);
const unknown = await call(alice, '/api/intents', { method: 'POST', body: JSON.stringify({ handle: 'nobody_here_x', amount: 5 }) });
ok('unknown handle names the missing variable', unknown.status === 422 && unknown.code === 'privy-secret-missing', unknown.error);

const made = await call(alice, '/api/intents', { method: 'POST', body: JSON.stringify({ handle: 'bob', amount: 5 }) });
ok('intent created', made.status === 200 && made.intent.status === 'pending', `id ${made.intent.id}`);
const id = made.intent.id;

const pub = await (await fetch(`${BASE}/api/intents/${id}`)).json();
ok('intent readable without auth, no privy id', pub.intent.id === id && !('sender_privy_id' in pub.intent));
const page = await (await fetch(`${BASE}/pay/${id}`)).text();
ok('pay page renders recipient', page.includes('@bob') && page.includes('$5.00'));

const fake = await call(alice, `/api/intents/${id}/paid`, { method: 'POST', body: JSON.stringify({ usdgHash: '0x' + 'ab'.repeat(32) }) });
ok('unknown hash refused', fake.status === 422, fake.error);

const bal = BigInt(cast('call', USDG, 'balanceOf(address)(uint256)', FAUCET, '--rpc-url', RPC).split(' ')[0]);
if (bal < 5_000_000n) {
  cast('send', USDG, 'mint(address,uint256)', FAUCET, '100000000', '--rpc-url', RPC, '--keystore', KEYSTORE, '--password', PASSWORD);
}
const out = cast('send', USDG, 'transfer(address,uint256)(bool)', BOB_WALLET, '5000000', '--rpc-url', RPC, '--keystore', KEYSTORE, '--password', PASSWORD, '--json');
const hash = JSON.parse(out).transactionHash;
ok('real USDG transfer on testnet', /^0x[0-9a-f]{64}$/.test(hash), hash);

const small = await call(alice, `/api/intents/${id}/paid`, { method: 'POST', body: JSON.stringify({ usdgHash: hash }) });
ok('receipt verified → paid', small.status === 200 && small.intent.status === 'paid', `from ${small.verified.from}`);
const again = await call(alice, `/api/intents/${id}/paid`, { method: 'POST', body: JSON.stringify({ usdgHash: hash }) });
ok('second post is idempotent', again.status === 200 && again.already === true);

const act = await call(alice, '/api/activity');
ok('alice sees it as sent', act.intents.some((i) => i.id === id && i.status === 'paid'));

const claimed = await call(bob, '/api/me', { method: 'POST', body: JSON.stringify({}) });
ok('bob signs in → claimed', claimed.claimedNow >= 1, `claimedNow ${claimed.claimedNow}`);
const claims = await call(bob, '/api/activity?claims=1');
ok('bob sees it in claims', claims.intents.some((i) => i.id === id && i.status === 'claimed'));

const wrong = await call(alice, '/api/intents', { method: 'POST', body: JSON.stringify({ handle: 'bob', amount: 5 }) });
const wrongPay = await call(bob, `/api/intents/${wrong.intent.id}/paid`, { method: 'POST', body: JSON.stringify({ usdgHash: hash }) });
ok('same hash cannot pay a second send', wrongPay.status === 422 && wrongPay.code === 'hash-used', wrongPay.error);

console.log(`\n${steps.filter((s) => s.ok).length}/${steps.length} passed`);
