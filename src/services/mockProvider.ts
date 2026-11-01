import { ThreatVerdict, VerdictResult } from '../types/index.js';

export class MockProvider {
  /**
   * Evaluates the appropriate threat category based on IOC telemetry patterns,
   * keyword signatures, and deterministic hashing for consistency.
   */
  public evaluateVerdict(indicator: string): { verdict: ThreatVerdict; confidence: number; details: string } {
    const lower = indicator.toLowerCase();

    // 1. Definite Malicious Signatures
    if (
      lower.includes('c2') ||
      lower.includes('malware') ||
      lower.includes('evil') ||
      lower.includes('ransom') ||
      lower.includes('botnet') ||
      lower.includes('trojan') ||
      lower.includes('exploit') ||
      lower.includes('payload') ||
      lower.includes('darknet') ||
      lower.includes('e3b0c442')
    ) {
      return {
        verdict: 'malicious',
        confidence: 0.94,
        details: `Indicator ${indicator} flagged by threat feeds as active Command & Control (C2) / malware distribution infrastructure.`,
      };
    }

    // 2. Suspicious Indicators (Phishing, Low-Reputation ASN, Impersonation)
    if (
      lower.includes('phish') ||
      lower.includes('suspicious') ||
      lower.includes('login') ||
      lower.includes('auth') ||
      lower.includes('verify') ||
      lower.includes('bad') ||
      lower.includes('gateway') ||
      lower.includes('account') ||
      lower.includes('update') ||
      lower.includes('198.51.100') ||
      lower.includes('192.0.2') ||
      lower.includes('free-')
    ) {
      return {
        verdict: 'suspicious',
        confidence: 0.76,
        details: `Indicator ${indicator} exhibits anomalous DNS registration or low-reputation credential harvesting telemetry.`,
      };
    }

    // 3. Verified Clean Enterprise Signatures
    if (
      lower.includes('clean') ||
      lower.includes('corp') ||
      lower.includes('portal') ||
      lower.includes('safe') ||
      lower.includes('legit') ||
      lower.includes('enterprise') ||
      lower.includes('google') ||
      lower.includes('microsoft') ||
      lower.includes('apple') ||
      lower.includes('internal')
    ) {
      return {
        verdict: 'clean',
        confidence: 0.98,
        details: `Indicator ${indicator} exhibited no malicious telemetry or anomalous behavior across authoritative feeds.`,
      };
    }

    // 4. Deterministic Consistent Evaluation for Arbitrary IOCs
    let hash = 0;
    for (let i = 0; i < lower.length; i++) {
      hash = (hash << 5) - hash + lower.charCodeAt(i);
      hash |= 0;
    }

    const bucket = Math.abs(hash) % 3;
    if (bucket === 0) {
      return {
        verdict: 'clean',
        confidence: 0.92,
        details: `Indicator ${indicator} exhibited no malicious telemetry across feeds.`,
      };
    }
    if (bucket === 1) {
      return {
        verdict: 'suspicious',
        confidence: 0.71,
        details: `Indicator ${indicator} detected in recent low-reputation ASN scans.`,
      };
    }
    return {
      verdict: 'malicious',
      confidence: 0.89,
      details: `Indicator ${indicator} detected communicating with suspicious external endpoints.`,
    };
  }

  /**
   * Simulates calling an external threat intelligence provider.
   * Delays for 100ms - 250ms without holding any database transaction.
   */
  async lookup(indicator: string): Promise<VerdictResult> {
    const latencyMs = Math.floor(Math.random() * 150) + 100;
    await new Promise((resolve) => setTimeout(resolve, latencyMs));

    const evaluated = this.evaluateVerdict(indicator);

    return {
      verdict: evaluated.verdict,
      confidence: evaluated.confidence,
      details: evaluated.details,
      analyzedAt: new Date().toISOString(),
      provider: 'CyberGuard-MockProvider-v1',
    };
  }
}

export const mockProvider = new MockProvider();

