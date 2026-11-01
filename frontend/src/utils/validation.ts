export type IndicatorType =
  | 'ipv4'
  | 'ipv6'
  | 'domain'
  | 'url'
  | 'sha256'
  | 'sha1'
  | 'md5'
  | 'unknown';

export interface IndicatorValidationResult {
  type: IndicatorType;
  label: string;
  isValid: boolean;
  normalized: string;
  errorMessage?: string;
}

/**
 * Refangs defanged indicators like hxxp, [.], (:), etc.
 */
export function refangIndicator(raw: string): string {
  let val = raw.trim();
  val = val.replace(/\[\.\]/g, '.').replace(/\(\.\)/g, '.');
  val = val.replace(/\[\:\]/g, ':').replace(/\(\:\)/g, ':');
  val = val.replace(/^hxxps:\/\//i, 'https://');
  val = val.replace(/^hxxp:\/\//i, 'http://');
  return val;
}

/**
 * Detects indicator type and validates format for IP address, domain, URL, or file hash.
 */
export function validateIndicator(input: string): IndicatorValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      type: 'unknown',
      label: 'None',
      isValid: false,
      normalized: '',
      errorMessage: 'Please enter an indicator.',
    };
  }

  const refanged = refangIndicator(trimmed);
  const lower = refanged.toLowerCase();

  // 1. MD5 Hash (32 hexadecimal characters)
  if (/^[a-f0-9]{32}$/i.test(refanged)) {
    return {
      type: 'md5',
      label: 'MD5 Hash',
      isValid: true,
      normalized: lower,
    };
  }

  // 2. SHA-1 Hash (40 hexadecimal characters)
  if (/^[a-f0-9]{40}$/i.test(refanged)) {
    return {
      type: 'sha1',
      label: 'SHA-1 Hash',
      isValid: true,
      normalized: lower,
    };
  }

  // 3. SHA-256 Hash (64 hexadecimal characters)
  if (/^[a-f0-9]{64}$/i.test(refanged)) {
    return {
      type: 'sha256',
      label: 'SHA-256 Hash',
      isValid: true,
      normalized: lower,
    };
  }

  // 4. IPv4 Address (with or without defanging)
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (ipv4Regex.test(refanged)) {
    return {
      type: 'ipv4',
      label: 'IPv4 Address',
      isValid: true,
      normalized: lower,
    };
  }

  // 5. IPv6 Address
  const ipv6Regex =
    /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  if (ipv6Regex.test(refanged)) {
    return {
      type: 'ipv6',
      label: 'IPv6 Address',
      isValid: true,
      normalized: lower,
    };
  }

  // 6. URL
  if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(refanged)) {
    const norm = lower.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return {
      type: 'url',
      label: 'URL',
      isValid: true,
      normalized: norm,
    };
  }

  // 7. Domain Name / FQDN
  const domainRegex =
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  if (domainRegex.test(refanged)) {
    const norm = lower.replace(/\/+$/, '');
    return {
      type: 'domain',
      label: 'Domain / FQDN',
      isValid: true,
      normalized: norm,
    };
  }

  return {
    type: 'unknown',
    label: 'Unrecognized IOC',
    isValid: false,
    normalized: lower,
    errorMessage:
      'Invalid format. Must be a valid IPv4/IPv6 address, domain name (e.g. evil-c2.com), URL, or MD5/SHA-1/SHA-256 file hash.',
  };
}

