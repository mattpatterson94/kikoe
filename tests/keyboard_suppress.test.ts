// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const SELECTOR = '#answer';

async function load() {
  vi.resetModules();
  return import('../src/keyboard_suppress');
}

function mount(attrs = ''): HTMLInputElement {
  document.body.innerHTML = `<input id="answer" ${attrs}>`;
  return document.getElementById('answer') as HTMLInputElement;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('suppressAutofocusKeyboard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does nothing on a non-touch device', async () => {
    const { suppressAutofocusKeyboard } = await load();
    const el = mount();
    suppressAutofocusKeyboard(SELECTOR, false);
    el.focus();
    expect(el.hasAttribute('inputmode')).toBe(false);
  });

  it('marks an existing input inputmode=none', async () => {
    const { suppressAutofocusKeyboard } = await load();
    const el = mount();
    suppressAutofocusKeyboard(SELECTOR, true);
    expect(el.getAttribute('inputmode')).toBe('none');
  });

  it('marks an input added later, even one focused as it is inserted', async () => {
    const { suppressAutofocusKeyboard } = await load();
    suppressAutofocusKeyboard(SELECTOR, true);
    const el = mount();
    el.focus();
    expect(el.getAttribute('inputmode')).toBe('none');
    await tick();
    expect(el.getAttribute('inputmode')).toBe('none');
  });

  it('restores the keyboard when the user taps the input', async () => {
    const { suppressAutofocusKeyboard } = await load();
    const el = mount();
    suppressAutofocusKeyboard(SELECTOR, true);
    el.focus();
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(el.hasAttribute('inputmode')).toBe(false);
    expect(document.activeElement).not.toBe(el);
    el.focus();
    await tick();
    expect(el.hasAttribute('inputmode')).toBe(false);
  });

  it("restores the site's own inputmode rather than removing it", async () => {
    const { suppressAutofocusKeyboard } = await load();
    const el = mount('inputmode="text"');
    suppressAutofocusKeyboard(SELECTOR, true);
    expect(el.getAttribute('inputmode')).toBe('none');
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(el.getAttribute('inputmode')).toBe('text');
  });

  it('suppresses again once the tapped input loses focus', async () => {
    const { suppressAutofocusKeyboard } = await load();
    const el = mount();
    suppressAutofocusKeyboard(SELECTOR, true);
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el.focus();
    el.blur();
    expect(el.getAttribute('inputmode')).toBe('none');
  });

  it('ignores other elements', async () => {
    const { suppressAutofocusKeyboard } = await load();
    document.body.innerHTML = '<input id="other">';
    suppressAutofocusKeyboard(SELECTOR, true);
    const other = document.getElementById('other') as HTMLInputElement;
    other.focus();
    expect(other.hasAttribute('inputmode')).toBe(false);
  });
});
