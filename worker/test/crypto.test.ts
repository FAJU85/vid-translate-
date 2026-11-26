// Unit tests for signing (links to files, uploads) and the owner filter for personal data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionKey, hmacHex, safeEqual, signedQuery, verifySigned } from '../src/shared/crypto.ts';
import { ownedBy } from '../src/shared/person.ts';

test('HMAC-SHA256 matches the RFC 4231 example', async () => {
  assert.equal(await hmacHex('Jefe', 'what do ya want for nothing?'), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

test('signatures match the video engine (backend/app/shared/security.py sign())', async () => {
  // hmac.new(b's3cret', b'file:job1:out.mp4:1900000000', hashlib.sha256).hexdigest()
  assert.equal(await hmacHex('s3cret', 'file:job1:out.mp4:1900000000'), '18b7c8d717172398a0c4c9519083d8ad40bdc468e81da85841158dd904b15d74');
});

test('safeEqual: equal only when every character is', () => {
  assert.ok(safeEqual('abc', 'abc'));
  assert.ok(safeEqual('', ''));
  for (const [a, b] of [['abc', 'abd'], ['abc', 'ab'], ['ab', 'abc'], ['', 'a'], ['a', ''], ['abc', 'ABC']]) assert.ok(!safeEqual(a, b), `${a} vs ${b}`);
});

test('signed links: right scope and time only', async () => {
  const q = new URLSearchParams(await signedQuery('s3cret', 'file:job1:out.mp4', 60));
  const [exp, sig] = [q.get('exp'), q.get('sig')];
  assert.ok(await verifySigned('s3cret', 'file:job1:out.mp4', exp, sig));
  assert.ok(!(await verifySigned('other', 'file:job1:out.mp4', exp, sig)), 'another secret');
  assert.ok(!(await verifySigned('s3cret', 'file:job2:out.mp4', exp, sig)), 'another file');
  assert.ok(!(await verifySigned('s3cret', 'file:job1:out.mp4', String(Number(exp) + 1), sig)), 'a later end');
  assert.ok(!(await verifySigned('s3cret', 'file:job1:out.mp4', exp, sig!.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')))), 'a changed signature');
  for (const [e, s] of [[null, sig], [exp, null], ['soon', sig], ['', sig]]) assert.ok(!(await verifySigned('s3cret', 'file:job1:out.mp4', e, s)));
  const old = Math.floor(Date.now() / 1000) - 5;
  assert.ok(!(await verifySigned('s3cret', 'x', String(old), await hmacHex('s3cret', `x:${old}`))), 'expired');
});

test('connection key: stable, not the address, none without one', async () => {
  const req = (ip?: string) => new Request('https://k.test/', { headers: ip ? { 'CF-Connecting-IP': ip } : {} });
  const a = await connectionKey('s', req('203.0.113.7'));
  assert.match(a ?? '', /^k:[0-9a-f]{24}$/);
  assert.equal(await connectionKey('s', req('203.0.113.7')), a);
  assert.notEqual(await connectionKey('s', req('203.0.113.8')), a);
  assert.ok(!a!.includes('203'));
  assert.equal(await connectionKey('s', req()), null);
});

test('ownedBy: the account, the owner keys, or nothing', () => {
  assert.deepEqual(ownedBy({ accountId: 'acc', owners: ['web:1', 'tg:2'], telegramId: null, email: null }), { sql: '(account_id = ? OR owner IN (?, ?))', binds: ['acc', 'web:1', 'tg:2'] });
  assert.deepEqual(ownedBy({ accountId: null, owners: ['web:1'], telegramId: null, email: null }), { sql: '(owner IN (?))', binds: ['web:1'] });
  assert.deepEqual(ownedBy({ accountId: null, owners: [], telegramId: null, email: null }), { sql: '0', binds: [] }, 'matches no row');
});
