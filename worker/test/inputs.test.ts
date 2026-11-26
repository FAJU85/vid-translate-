// Unit tests for what people type or send: video links, subtitle styles, @handles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isYouTubeUrl, parseVideoUrl } from '../src/shared/urls.ts';
import { DEFAULT_STYLE, parseSubtitleStyle } from '../src/modules/jobs/style.ts';
import { checkHandle } from '../src/modules/social/handles.ts';

test('video links: public http(s) addresses only', () => {
  assert.equal(parseVideoUrl('look https://www.tiktok.com/@a/video/1 nice'), 'https://www.tiktok.com/@a/video/1');
  assert.equal(parseVideoUrl('http://example.com/v.mp4'), 'http://example.com/v.mp4');
  for (const bad of [
    'no link here',
    'ftp://example.com/v.mp4',
    'http://localhost/v.mp4',
    'http://localhost./v.mp4',
    'http://box.local/v.mp4',
    'http://box.internal./v.mp4',
    'http://127.0.0.1/v.mp4',
    'http://127.1/v.mp4',
    'http://2130706433/v.mp4',
    'http://0x7f.1/v.mp4',
    'http://[::1]/v.mp4',
    'http://169.254.169.254/latest',
    'http://user:pw@example.com/v.mp4',
    'http://intranet/v.mp4',
  ]) assert.equal(parseVideoUrl(bad), null, bad);
});

test('YouTube links are recognised (not supported)', () => {
  for (const u of ['https://www.youtube.com/watch?v=x', 'https://youtu.be/x', 'https://m.youtube.com/shorts/x', 'https://www.youtube-nocookie.com/embed/x']) assert.ok(isYouTubeUrl(u), u);
  for (const u of ['https://notyoutube.com/x', 'https://youtube.com.evil.io/x', 'not a url']) assert.ok(!isYouTubeUrl(u), u);
});

test('subtitle style: unknown values keep the default, text is cleaned', () => {
  assert.deepEqual(parseSubtitleStyle(null), DEFAULT_STYLE);
  assert.deepEqual(parseSubtitleStyle('x'), DEFAULT_STYLE);
  const s = parseSubtitleStyle({ size: 'huge', color: '#ff00aa', voice: 'robot', look: 'bars', frame: 'square', title: 'A\u0000\nsong\t  name' + 'x'.repeat(100), karaoke: false, visual: 'yes', translation_at: 'off' });
  assert.equal(s.size, 'medium');
  assert.equal(s.color, '#FF00AA');
  assert.equal(s.voice, 'female');
  assert.equal(s.look, 'bars');
  assert.equal(s.frame, 'square');
  assert.equal(s.title.length, 80);
  assert.ok(s.title.startsWith('A song name'));
  assert.equal(s.karaoke, false);
  assert.equal(s.visual, false, 'only true counts');
  assert.equal(s.translation_at, 'off');
  assert.equal(parseSubtitleStyle({ color: 'red' }).color, '#FFFFFF');
});

test('@handles: shape and reserved words', () => {
  assert.deepEqual(checkHandle(' @Sara.K_1 '), { handle: 'sara.k_1' });
  for (const bad of ['ab', 'a'.repeat(25), '.sara', 'sara.', 'sa..ra', 'sa ra', 'سارة']) assert.deepEqual(checkHandle(bad), { problem: 'invalid' }, bad);
  for (const r of ['admin', 'kavox', 'k.a.v.o.x', 'the_official', 'support_team', 'terms']) assert.deepEqual(checkHandle(r), { problem: 'reserved' }, r);
});
