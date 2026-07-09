import { describe, it, expect } from 'vitest';
import { formatCurrency, formatPercent, escapeHtml } from '../utils/format';

describe('format utilities', () => {
  it('formats currency values', () => {
    expect(formatCurrency(26.6)).toContain('26.60');
  });

  it('formats percentages', () => {
    expect(formatPercent(31.2)).toBe('31.2%');
  });

  it('escapes HTML characters', () => {
    expect(escapeHtml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  });
});
