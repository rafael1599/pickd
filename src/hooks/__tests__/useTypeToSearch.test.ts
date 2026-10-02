import { describe, it, expect } from 'vitest';
import { shouldCaptureKey } from '../useTypeToSearch';

const key = (k: string, over: Partial<Parameters<typeof shouldCaptureKey>[0]> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  defaultPrevented: false,
  ...over,
});

describe('shouldCaptureKey', () => {
  it('takes a letter or a digit typed with nothing focused', () => {
    expect(shouldCaptureKey(key('0'), document.body)).toBe(true);
    expect(shouldCaptureKey(key('T'), null)).toBe(true);
    expect(shouldCaptureKey(key('-'), document.body)).toBe(true);
  });

  it('leaves alone a key typed into another field', () => {
    expect(shouldCaptureKey(key('3'), document.createElement('input'))).toBe(false);
    expect(shouldCaptureKey(key('3'), document.createElement('textarea'))).toBe(false);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    expect(shouldCaptureKey(key('3'), div)).toBe(false);
    div.remove();
  });

  it('leaves shortcuts, Space and non-printing keys to the browser', () => {
    expect(shouldCaptureKey(key('c', { metaKey: true }), document.body)).toBe(false);
    expect(shouldCaptureKey(key('r', { ctrlKey: true }), document.body)).toBe(false);
    expect(shouldCaptureKey(key(' '), document.body)).toBe(false);
    expect(shouldCaptureKey(key('Enter'), document.body)).toBe(false);
    expect(shouldCaptureKey(key('ArrowDown'), document.body)).toBe(false);
    expect(shouldCaptureKey(key('Tab'), document.body)).toBe(false);
  });

  it('skips a key another handler already took, or one mid-IME', () => {
    expect(shouldCaptureKey(key('a', { defaultPrevented: true }), document.body)).toBe(false);
    expect(shouldCaptureKey(key('a', { isComposing: true }), document.body)).toBe(false);
  });
});
