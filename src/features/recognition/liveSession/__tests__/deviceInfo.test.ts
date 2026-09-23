import { describe, it, expect } from 'vitest';
import { parseDeviceInfo } from '../deviceInfo';

describe('parseDeviceInfo', () => {
  it('reads a Samsung Galaxy S25 Ultra on Chrome Android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/128.0.0.0 Mobile Safari/537.36';
    const info = parseDeviceInfo(ua);
    expect(info.label).toBe('SM-S938B');
    expect(info.os).toBe('Android 15');
    expect(info.isMobile).toBe(true);
  });

  it('reads an iPhone on Safari', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    const info = parseDeviceInfo(ua);
    expect(info.label).toBe('iPhone');
    expect(info.os).toBe('iOS 18.1');
    expect(info.isMobile).toBe(true);
  });

  it('reads an iPad on Safari', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const info = parseDeviceInfo(ua);
    expect(info.label).toBe('iPad');
    expect(info.os).toBe('iOS 17.5');
    expect(info.isMobile).toBe(true);
  });

  it('reads a desktop Chrome on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/128.0.0.0 Safari/537.36';
    const info = parseDeviceInfo(ua);
    expect(info.label).toBe('Escritorio · Chrome');
    expect(info.os).toBe('Windows');
    expect(info.isMobile).toBe(false);
  });

  it('reads a desktop Firefox on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0';
    const info = parseDeviceInfo(ua);
    expect(info.label).toBe('Escritorio · Firefox');
    expect(info.os).toBe('macOS');
    expect(info.isMobile).toBe(false);
  });

  it('reads a desktop Edge on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
    const info = parseDeviceInfo(ua);
    expect(info.label).toBe('Escritorio · Edge');
  });

  it('filters out the WebView marker and Build suffix on Android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; SM-G991B Build/UP1A.231005.007; wv) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36';
    const info = parseDeviceInfo(ua);
    expect(info.label).toBe('SM-G991B');
  });

  it('returns nulls for empty or unrecognized input, never throws', () => {
    expect(parseDeviceInfo('')).toEqual({
      userAgent: '',
      label: null,
      os: null,
      isMobile: false,
    });
    expect(parseDeviceInfo(null)).toEqual({
      userAgent: '',
      label: null,
      os: null,
      isMobile: false,
    });
    const weird = parseDeviceInfo('SomeCustomBot/1.0');
    expect(weird.label).toBeNull();
    expect(weird.os).toBeNull();
  });
});
