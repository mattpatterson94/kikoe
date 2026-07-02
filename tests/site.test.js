import { detectSite } from '../src/site.js';

describe('detectSite', () => {
  test('www.wanikani.com → wanikani', () => {
    expect(detectSite('www.wanikani.com')).toBe('wanikani');
  });

  test('bare wanikani.com → wanikani', () => {
    expect(detectSite('wanikani.com')).toBe('wanikani');
  });

  test('bunpro.jp → bunpro', () => {
    expect(detectSite('bunpro.jp')).toBe('bunpro');
  });

  test('www.bunpro.jp → bunpro', () => {
    expect(detectSite('www.bunpro.jp')).toBe('bunpro');
  });

  test('unrelated host → null', () => {
    expect(detectSite('example.com')).toBeNull();
  });

  test('lookalike host is not matched', () => {
    expect(detectSite('evilwanikani.com')).toBeNull();
    expect(detectSite('notbunpro.jp')).toBeNull();
  });

  test('empty/missing hostname → null', () => {
    expect(detectSite('')).toBeNull();
    expect(detectSite(undefined)).toBeNull();
  });
});
