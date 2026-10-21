import { describe, expect, it } from 'vitest';
import { normaliseLandingContent, sanitizeRichText } from './landing-content.js';

const buy = { id: 'buy', type: 'buy', sourceKey: null, props: {} };
const text = (html: string) => ({ id: 'text', type: 'richText', sourceKey: null, props: { html } });
const doc = (blocks: unknown[] = [buy]) => ({ schemaVersion: 1, blocks });

describe('landing content boundary', () => {
  it('removes script, event handlers, unsafe links and embedded styles', () => {
    const output = sanitizeRichText('<p onclick="bad()" style="color:red">Hi</p><script>bad()</script><a href="javascript:bad()">Bad</a><a href="https://example.test">Good</a>');
    expect(output).toBe('<p>Hi</p><a>Bad</a><a href="https://example.test">Good</a>');
  });

  it('does not allow relative links outside the approved absolute protocols', () => {
    expect(sanitizeRichText('<a href="/admin">Relative</a><a href="#jump">Fragment</a><a href="//evil.test">Host</a><a href="mailto:help@example.test">Email</a>'))
      .toBe('<a>Relative</a><a>Fragment</a><a>Host</a><a href="mailto:help@example.test">Email</a>');
  });

  it('stores only the sanitized version of each text block', () => {
    expect(normaliseLandingContent(doc([buy, text('<p>Safe<img src=x onerror=bad()></p>')])).blocks[1]).toMatchObject({ props: { html: '<p>Safe</p>' } });
  });

  it.each([
    '/uploads/catalog/2026/media.jpg',
    'https://cdn.example.test/media.mp4',
  ])('accepts supported media references: %s', (url) => {
    expect(normaliseLandingContent(doc([buy, { id: 'gallery', type: 'gallery', sourceKey: null, props: { media: [{ url, type: 'IMAGE', altText: null, optionValueId: null, variantId: null }] } }])).blocks).toHaveLength(2);
  });

  it.each(['//evil.test/a.jpg', 'javascript:bad()', 'data:text/html,bad', '/\\evil.test/a.jpg', '/uploads/a\nb.jpg'])('rejects unsafe media reference: %s', (url) => {
    expect(() => normaliseLandingContent(doc([buy, { id: 'gallery', type: 'gallery', sourceKey: null, props: { media: [{ url, type: 'IMAGE' }] } }]))).toThrow();
  });

  it('requires exactly one unmodifiable live purchase block', () => {
    expect(() => normaliseLandingContent(doc([]))).toThrow();
    expect(() => normaliseLandingContent(doc([buy, { ...buy, id: 'buy2' }]))).toThrow();
    expect(() => normaliseLandingContent(doc([{ ...buy, props: { price: 1, stock: 99, skuId: 'other' } }]))).toThrow();
  });

  it('rejects arbitrary components and executable document properties', () => {
    expect(() => normaliseLandingContent(doc([buy, { id: 'evil', type: 'iframe', sourceKey: null, props: { src: 'https://evil.test' } }]))).toThrow();
    expect(() => normaliseLandingContent({ ...doc(), script: 'bad()' })).toThrow();
  });

  it('rejects duplicated IDs and duplicated source references', () => {
    expect(() => normaliseLandingContent(doc([buy, { ...text('A'), id: 'buy' }]))).toThrow();
    expect(() => normaliseLandingContent(doc([buy, { ...text('A'), sourceKey: 'description:p1' }, { ...text('B'), id: 'other', sourceKey: 'description:p1' }]))).toThrow();
  });

  it('caps top-level blocks, raw rich text bytes and total raw document bytes', () => {
    expect(() => normaliseLandingContent(doc([buy, ...Array.from({ length: 60 }, (_, i) => ({ ...text('A'), id: `text-${i}` }))]))).toThrow();
    expect(() => normaliseLandingContent(doc([buy, text('<script>' + 'x'.repeat(20 * 1024) + '</script>')]))).toThrow();
    const oversized = doc([buy, ...Array.from({ length: 59 }, (_, i) => ({ ...text('x'.repeat(10000)), id: `text-${i}` }))]);
    expect(() => normaliseLandingContent(oversized)).toThrow();
  });

  it('validates independent draft publishing windows', () => {
    const content = normaliseLandingContent({ ...doc(), startAt: '2026-10-15T09:00:00+08:00', endAt: '2026-10-16T09:00:00+08:00' });
    expect(content).toMatchObject({ startAt: '2026-10-15T09:00:00+08:00', endAt: '2026-10-16T09:00:00+08:00' });
    expect(() => normaliseLandingContent({ ...doc(), startAt: '2026-10-15T09:00:00+08:00', endAt: '2026-10-15T09:00:00+08:00' })).toThrow();
    expect(() => normaliseLandingContent({ ...doc(), startAt: 'not-a-date' })).toThrow();
  });

  it('keeps facts, FAQ and reviews as live content references', () => {
    const result = normaliseLandingContent(doc([buy, { id: 'faq', type: 'faq', sourceKey: null, props: {} }]));
    expect(result.blocks[1]).toEqual({ id: 'faq', type: 'faq', sourceKey: null, props: {} });
    expect(() => normaliseLandingContent(doc([buy, { id: 'faq', type: 'faq', sourceKey: null, props: { items: [{ title: 'Fake' }] } }]))).toThrow();
  });
});
