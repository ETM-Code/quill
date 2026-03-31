import { describe, expect, test } from 'bun:test'
import { getPlatformClassName, resolveAppPlatform } from './platform'

describe('resolveAppPlatform', () => {
  test('prefers explicit platform query param when present', () => {
    expect(
      resolveAppPlatform({
        href: 'http://localhost:1420/?platform=windows&open=C%3A%5C%5Ctmp%5C%5Cnote.md',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)',
        navigatorPlatform: 'MacIntel',
      }),
    ).toBe('windows')
  })

  test('detects macos from user agent', () => {
    expect(
      resolveAppPlatform({
        href: 'http://localhost:1420/',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)',
        navigatorPlatform: 'MacIntel',
      }),
    ).toBe('macos')
  })

  test('detects windows from user agent', () => {
    expect(
      resolveAppPlatform({
        href: 'http://localhost:1420/',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        navigatorPlatform: 'Win32',
      }),
    ).toBe('windows')
  })

  test('detects linux from user agent', () => {
    expect(
      resolveAppPlatform({
        href: 'http://localhost:1420/',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        navigatorPlatform: 'Linux x86_64',
      }),
    ).toBe('linux')
  })

  test('falls back to unknown for unrecognized environments', () => {
    expect(
      resolveAppPlatform({
        href: 'http://localhost:1420/',
        userAgent: 'Mozilla/5.0 (PlayStation 5 4.51)',
        navigatorPlatform: 'PlayStation',
      }),
    ).toBe('unknown')
  })
})

describe('getPlatformClassName', () => {
  test('returns css class for each known platform', () => {
    expect(getPlatformClassName('macos')).toBe('platform-macos')
    expect(getPlatformClassName('windows')).toBe('platform-windows')
    expect(getPlatformClassName('linux')).toBe('platform-linux')
    expect(getPlatformClassName('unknown')).toBe('platform-unknown')
  })
})
