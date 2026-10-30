import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { MovedBanner } from './layout/MovedBanner';
import { MOVED_EXPORTED, MOVED_MESSAGE, NEW_URL, OLD_HOSTNAME, isOldAddress } from './oldAddress';

describe('isOldAddress', () => {
  it('matches only the old address', () => {
    expect(isOldAddress('flickwise.ajshaham.workers.dev')).toBe(true);
    expect(isOldAddress('FLICKWISE.ajshaham.workers.dev')).toBe(true);
    expect(isOldAddress(OLD_HOSTNAME)).toBe(true);
    expect(isOldAddress('heartbeat.ajshaham.workers.dev')).toBe(false);
    expect(isOldAddress('localhost')).toBe(false);
    expect(isOldAddress('')).toBe(false);
    expect(isOldAddress('flickwise.ajshaham.workers.dev.example.com')).toBe(false);
    expect(isOldAddress('www.flickwise.ajshaham.workers.dev')).toBe(false);
  });

  it('points at the new address', () => {
    expect(NEW_URL).toBe('https://heartbeat.ajshaham.workers.dev');
    expect(MOVED_MESSAGE).toContain('heartbeat.ajshaham.workers.dev');
  });
});

describe('MovedBanner', () => {
  const render = (hostname: string) => renderToString(createElement(MemoryRouter, null, createElement(MovedBanner, { hostname })));

  it('shows the notice, the export button and the link on the old address', () => {
    const html = render(OLD_HOSTNAME);
    expect(html).toContain('Flickwise is now Heartbeat, at heartbeat.ajshaham.workers.dev.');
    expect(html).toContain('Export your data');
    expect(html).toContain('Open Heartbeat');
    expect(html).toContain('href="https://heartbeat.ajshaham.workers.dev"');
  });

  it('shows nothing on other addresses', () => {
    expect(render('heartbeat.ajshaham.workers.dev')).toBe('');
    expect(render('localhost')).toBe('');
  });

  it('words the result of an export', () => {
    expect(MOVED_EXPORTED(1)).toBe('Exported 1 play. Open Heartbeat and import the file in Settings, under Data.');
    expect(MOVED_EXPORTED(12)).toContain('12 plays');
  });
});
