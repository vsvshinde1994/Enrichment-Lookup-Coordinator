import { describe, it, expect } from 'vitest';
import { refangIndicator, validateIndicator } from './validation.js';

describe('Frontend IOC Validation Utilities', () => {
  describe('refangIndicator', () => {
    it('refangs obfuscated protocols and brackets', () => {
      expect(refangIndicator('hxxps://evil[.]com/login')).toBe('https://evil.com/login');
      expect(refangIndicator('hxxp://192[.]168[.]1[.]1')).toBe('http://192.168.1.1');
      expect(refangIndicator('malicious(.)org[:]8080')).toBe('malicious.org:8080');
    });

    it('trims leading and trailing whitespace', () => {
      expect(refangIndicator('   evil.com   ')).toBe('evil.com');
    });
  });

  describe('validateIndicator', () => {
    it('rejects empty or whitespace-only input', () => {
      const res = validateIndicator('   ');
      expect(res.isValid).toBe(false);
      expect(res.type).toBe('unknown');
      expect(res.errorMessage).toBeDefined();
    });

    it('identifies MD5 file hashes', () => {
      const res = validateIndicator('d41d8cd98f00b204e9800998ecf8427e');
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('md5');
      expect(res.label).toBe('MD5 Hash');
    });

    it('identifies SHA-1 file hashes', () => {
      const res = validateIndicator('da39a3ee5e6b4b0d3255bfef95601890afd80709');
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('sha1');
      expect(res.label).toBe('SHA-1 Hash');
    });

    it('identifies SHA-256 file hashes', () => {
      const res = validateIndicator('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('sha256');
      expect(res.label).toBe('SHA-256 Hash');
    });

    it('identifies valid IPv4 addresses and refangs them', () => {
      const res = validateIndicator('192[.]168[.]1[.]1');
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('ipv4');
      expect(res.normalized).toBe('192.168.1.1');
    });

    it('identifies valid IPv6 addresses', () => {
      const res = validateIndicator('2001:0db8:85a3:0000:0000:8a2e:0370:7334');
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('ipv6');
    });

    it('identifies valid URLs and strips protocol', () => {
      const res = validateIndicator('hxxps://evil-phish[.]com/auth/login/');
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('url');
      expect(res.normalized).toBe('evil-phish.com/auth/login');
    });

    it('identifies valid Domains / FQDNs', () => {
      const res = validateIndicator('subdomain.c2-command[.]net');
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('domain');
      expect(res.normalized).toBe('subdomain.c2-command.net');
    });

    it('flags invalid or unrecognized strings', () => {
      const res = validateIndicator('not-a-valid-domain-or-ip');
      expect(res.isValid).toBe(false);
      expect(res.type).toBe('unknown');
      expect(res.errorMessage).toContain('Invalid format');
    });
  });
});
