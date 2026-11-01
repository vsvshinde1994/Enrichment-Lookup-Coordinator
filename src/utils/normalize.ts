/**
 * Normalizes an indicator (domain, IPv4/IPv6, URL, or hash) for consistent deduplication.
 * - Trims whitespace
 * - Converts to lowercase
 * - Refangs common defanged formats (e.g., hxxp -> http, [.] -> ., (:) -> :)
 * - Strips protocol scheme (http://, https://) and trailing slashes for standard host/indicator comparisons
 */
export function normalizeIndicator(rawIndicator: string): string {
  if (!rawIndicator) return '';

  let normalized = rawIndicator.trim().toLowerCase();

  // Refang common defanging techniques
  normalized = normalized.replace(/\[\.\]/g, '.');
  normalized = normalized.replace(/\(\.\)/g, '.');
  normalized = normalized.replace(/\[:\]/g, ':');
  normalized = normalized.replace(/\(:\)/g, ':');
  normalized = normalized.replace(/^hxxps?:\/\//i, (match) => 
    match.toLowerCase().startsWith('hxxps') ? 'https://' : 'http://'
  );

  // Strip scheme if present
  normalized = normalized.replace(/^https?:\/\//, '');

  // Strip trailing slashes
  normalized = normalized.replace(/\/+$/, '');

  return normalized;
}
