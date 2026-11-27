import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://www.yundev.space; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

test('index.html has clean same-origin favicon links and theme-color metas in <head>', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  assert.ok(headMatch, 'Expected <head> block in index.html');
  const head = headMatch[1];

  const countOccurrences = (needle) => head.split(needle).length - 1;

  assert.equal(countOccurrences('rel="icon" href="/favicon.ico"'), 1, 'Expected exactly one /favicon.ico link');
  assert.equal(
    countOccurrences('rel="icon" href="/favicon.svg" type="image/svg+xml"'),
    1,
    'Expected exactly one /favicon.svg link'
  );
  assert.equal(
    countOccurrences('rel="apple-touch-icon" href="/apple-touch-icon.png"'),
    1,
    'Expected exactly one /apple-touch-icon.png link'
  );
  assert.equal(
    countOccurrences('<meta name="theme-color" content="#FAF7F2" media="(prefers-color-scheme: light)" />'),
    1,
    'Expected light theme-color meta'
  );
  assert.equal(
    countOccurrences('<meta name="theme-color" content="#15121D" media="(prefers-color-scheme: dark)" />'),
    1,
    'Expected dark theme-color meta'
  );

  const iconLinks = head.match(/<link\b[^>]*\brel=["'](?:shortcut\s+)?icon["'][^>]*>/gi) ?? [];
  assert.equal(iconLinks.length, 2, 'Expected no extra rel="icon" or shortcut icon links');

  const scriptTags = head.match(/<script\b[^>]*>/gi) ?? [];
  const inlineScripts = scriptTags.filter((tag) => !/\bsrc\s*=/i.test(tag));
  assert.equal(inlineScripts.length, 0, 'Expected 0 inline <script> tags without src in <head>');
});

test('public/favicon.svg is static and free of unsafe constructs', () => {
  const svg = fs.readFileSync(path.join(root, 'public', 'favicon.svg'), 'utf8');
  assert.ok(svg.includes('<svg'), 'Expected <svg element');
  assert.ok(svg.includes('viewBox="0 0 64 64"'), 'Expected viewBox="0 0 64 64"');

  const forbiddenPatterns = [
    /<script/i,
    /\son[a-z]+\s*=/i,
    /<foreignObject/i,
    /<!DOCTYPE/i,
    /<!ENTITY/i,
    /data:/i,
    /<style/i,
    /@import/i,
    / style=/i,
    /href=/i,
    /<image/i,
    /url\((?!#)/i,
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(svg), false, `Forbidden pattern matched in favicon.svg: ${pattern}`);
  }

  const withoutSvgXmlns = svg.replaceAll('xmlns="http://www.w3.org/2000/svg"', '');
  assert.equal(/https?:/i.test(withoutSvgXmlns), false, 'Unexpected http:/https: URL in favicon.svg');
});

test('public/favicon.ico contains 16, 32, 48 PNG frames with no trailing bytes', () => {
  const buf = fs.readFileSync(path.join(root, 'public', 'favicon.ico'));
  assert.ok(buf.length >= 6, 'ICO file too short');
  assert.deepEqual(buf.subarray(0, 4), Buffer.from([0x00, 0x00, 0x01, 0x00]), 'Expected ICO header 00 00 01 00');

  const count = buf.readUInt16LE(4);
  assert.equal(count, 3, 'Expected 3 frames in favicon.ico');
  assert.ok(buf.length >= 6 + count * 16, 'ICO directory truncated');

  const sizes = [];
  let maxEnd = 0;

  for (let i = 0; i < count; i += 1) {
    const entryOffset = 6 + i * 16;
    const width = buf.readUInt8(entryOffset);
    const height = buf.readUInt8(entryOffset + 1);
    const size = buf.readUInt32LE(entryOffset + 8);
    const imageOffset = buf.readUInt32LE(entryOffset + 12);

    assert.equal(width, height, `Expected square icon frame at index ${i}`);
    sizes.push(width);

    assert.ok(size >= 8, `Frame ${i} too small for PNG signature`);
    assert.ok(imageOffset + size <= buf.length, `Frame ${i} exceeds file length`);
    assert.deepEqual(
      buf.subarray(imageOffset, imageOffset + 8),
      PNG_SIGNATURE,
      `Expected PNG signature for frame ${i}`
    );

    if (imageOffset + size > maxEnd) {
      maxEnd = imageOffset + size;
    }
  }

  sizes.sort((a, b) => a - b);
  assert.deepEqual(sizes, [16, 32, 48], 'Expected 16, 32, 48 frame dimensions');
  assert.equal(buf.length, maxEnd, 'Expected no trailing bytes in favicon.ico');
});

test('public/apple-touch-icon.png is 180x180 PNG without metadata chunks or trailing bytes', () => {
  const buf = fs.readFileSync(path.join(root, 'public', 'apple-touch-icon.png'));
  assert.ok(buf.length >= 33, 'PNG file too short');
  assert.deepEqual(buf.subarray(0, 8), PNG_SIGNATURE, 'Expected PNG signature');

  const forbiddenChunks = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  let pos = 8;
  let sawIhdr = false;
  let lastChunkType = '';

  while (pos < buf.length) {
    assert.ok(pos + 12 <= buf.length, 'Truncated PNG chunk header');
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const chunkEnd = pos + 12 + length;
    assert.ok(chunkEnd <= buf.length, `PNG chunk ${type} exceeds file length`);

    if (!sawIhdr) {
      assert.equal(type, 'IHDR', 'Expected first chunk to be IHDR');
      assert.equal(length, 13, 'Expected IHDR length to be 13');
      const width = buf.readUInt32BE(pos + 8);
      const height = buf.readUInt32BE(pos + 12);
      assert.equal(width, 180, 'Expected width 180');
      assert.equal(height, 180, 'Expected height 180');
      sawIhdr = true;
    }

    assert.equal(forbiddenChunks.has(type), false, `Forbidden PNG metadata chunk: ${type}`);
    lastChunkType = type;
    pos = chunkEnd;
  }

  assert.ok(sawIhdr, 'Missing IHDR chunk');
  assert.equal(lastChunkType, 'IEND', 'Expected last chunk to be IEND');
  assert.equal(pos, buf.length, 'Expected IEND to end exactly at EOF');
});

test('vercel.json Content-Security-Policy is unchanged and allows same-origin img-src', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const rootHeaderBlock = vercelConfig.headers?.find((entry) => entry.source === '/(.*)');
  assert.ok(rootHeaderBlock, 'Expected /(.*) header block in vercel.json');

  const cspHeader = rootHeaderBlock.headers?.find((h) => h.key === 'Content-Security-Policy');
  assert.ok(cspHeader, 'Expected Content-Security-Policy header in vercel.json');
  assert.equal(cspHeader.value, EXPECTED_CSP, 'Content-Security-Policy must remain unchanged');
  assert.ok(cspHeader.value.includes("img-src 'self' data:"), "Expected img-src 'self' data: in CSP");
});
