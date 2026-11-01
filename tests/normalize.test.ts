import { describe, it, expect } from 'vitest';
import { normalizeIndicator } from '../src/utils/normalize.js';

describe('normalizeIndicator', () => {
  it('trims whitespace and lowercases', () => {
    expect(normalizeIndicator('  EVIL-DOMAIN.COM  ')).toBe('evil-domain.com');
  });

  it('refangs bracketed dots and colons', () => {
    expect(normalizeIndicator('192[.]168[.]1[.]1')).toBe('192.168.1.1');
    expect(normalizeIndicator('hxxps://evil[.]com(:)8080/')).toBe('evil.com:8080');
  });

  it('refangs hxxp and hxxps schemes and strips protocols', () => {
    expect(normalizeIndicator('hxxp://bad-site.org/malware')).toBe('bad-site.org/malware');
    expect(normalizeIndicator('https://C2.SERVER.NET/')).toBe('c2.server.net');
  });

  it('strips trailing slashes cleanly', () => {
    expect(normalizeIndicator('malicious.io///')).toBe('malicious.io');
  });
});

