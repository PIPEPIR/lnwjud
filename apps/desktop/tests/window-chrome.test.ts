import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { windowChromeOptions } from '../src/main/window-chrome.js';

describe('native window chrome', () => {
  it('keeps macOS traffic lights while avoiding Windows overlay options', (): void => {
    expect(windowChromeOptions('darwin')).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } });
  });

  it('uses the Windows overlay only on Windows', (): void => {
    expect(windowChromeOptions('win32')).toMatchObject({ titleBarStyle: 'hidden', titleBarOverlay: { height: 38 } });
    expect(windowChromeOptions('linux')).toEqual({});
  });

  it('reserves a left safe area for macOS traffic lights and keeps the Windows controls on the right', (): void => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain("[data-host-platform='darwin'] .custom-titlebar");
    expect(styles).toContain('padding-left: 82px;');
    expect(styles).toContain("[data-host-platform='win32'] .custom-titlebar");
    expect(styles).toContain('padding-right: 146px;');
  });
});
