// Unit tests for the banner list's checks (node --test; no packages needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BLOCKS, checkBlocks, storedBlocks, visibleBlocks } from '../src/modules/settings/blocks.ts';

const one = (b: Record<string, unknown>) => checkBlocks([{ text_en: 'Hi', ...b }]);
const err = (r: ReturnType<typeof checkBlocks>) => ('error' in r ? r.error : null);

test('refuses dates that are not real days, keeps real ones', () => {
  for (const d of ['2026-02-30', '2026-13-01', '2026-00-10', '2027-02-29', '26-01-01']) assert.match(err(one({ start: d })) ?? '', /real days/, d);
  for (const d of ['2028-02-29', '2026-12-31', '']) assert.equal(err(one({ start: d })), null, d);
});

test('refuses a last day before the first', () => {
  assert.match(err(one({ start: '2026-12-05', end: '2026-12-01' })) ?? '', /before the first/);
});

test('links must be https:// or a page of the site', () => {
  for (const u of ['javascript:alert(1)', 'http://x.com', '//evil.com', 'data:text/html,x']) assert.ok(err(one({ place: 'footer', url: u })), u);
  for (const u of ['https://www.producthunt.com/posts/kavox', '/terms', '']) assert.equal(err(one({ place: 'footer', url: u })), null, u);
  assert.ok(err(one({ buttons: [{ label_en: 'Go', url: 'javascript:x' }] })));
});

test('cleans what it keeps', () => {
  const r = checkBlocks([{ id: 'a', place: 'nowhere', tone: 'pink', icon: 'skull', sources: 'ProductHunt, ig', enabled: 'yes', text_en: '  Hi  ' }, { id: 'a', text_en: 'x' }]);
  assert.ok('blocks' in r);
  const [a, b] = r.blocks;
  assert.deepEqual([a.place, a.tone, a.icon, a.enabled, a.text_en], ['top', 'brand', 'none', false, 'Hi']);
  assert.deepEqual(a.sources, ['producthunt', 'ig']);
  assert.notEqual(b.id, 'a', 'a repeated id gets a new one');
  assert.ok(err(checkBlocks(Array.from({ length: 31 }, () => ({ text_en: 'x' })))));
  assert.ok(err(checkBlocks({})));
});

test('footer links drop their buttons; at most 3 buttons', () => {
  const r = checkBlocks([{ place: 'footer', url: '/x', text_en: 'x', buttons: [{ label_en: 'a', tab: 'lyrics' }] }, { buttons: Array(5).fill({ label_en: 'b', tab: 'feed' }) }]);
  assert.ok('blocks' in r);
  assert.equal(r.blocks[0].buttons.length, 0);
  assert.equal(r.blocks[1].buttons.length, 3);
});

test('visitors get only what is on, in its dates, with something to show', () => {
  const r = checkBlocks([
    { id: 'on', enabled: true, text_en: 'a' },
    { id: 'off', enabled: false, text_en: 'a' },
    { id: 'future', enabled: true, text_en: 'a', start: '2026-12-02' },
    { id: 'past', enabled: true, text_en: 'a', end: '2026-11-30' },
    { id: 'empty', enabled: true },
    { id: 'nolink', enabled: true, place: 'footer', text_en: 'a' },
    { id: 'today', enabled: true, text_en: 'a', start: '2026-12-01', end: '2026-12-01' },
  ]);
  assert.ok('blocks' in r);
  assert.deepEqual(visibleBlocks(r.blocks, '2026-12-01').map((b) => b.id), ['on', 'today']);
});

test('the saved list, or the defaults when never saved or unreadable', () => {
  assert.equal(storedBlocks(''), DEFAULT_BLOCKS);
  assert.equal(storedBlocks('{oops'), DEFAULT_BLOCKS);
  assert.deepEqual(storedBlocks('[]'), []);
  assert.deepEqual(visibleBlocks(DEFAULT_BLOCKS).map((b) => b.id), ['phwelcome']);
});
