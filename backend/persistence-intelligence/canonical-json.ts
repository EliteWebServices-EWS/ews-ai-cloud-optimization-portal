function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonicalize JSON-like structures with stable key ordering for fingerprinting. */
export function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const sortedKeys = Object.keys(value).sort();
  const canonical: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    canonical[key] = canonicalizeJsonValue(value[key]);
  }
  return canonical;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}
