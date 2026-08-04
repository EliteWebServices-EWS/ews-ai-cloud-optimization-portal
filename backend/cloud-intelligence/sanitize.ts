/**
 * Sanitize tag maps before persistence (drop secret-like keys).
 */
const SENSITIVE_TAG_KEY = /password|secret|token|private.?key|credential/i;

export function sanitizeCloudResourceTags(
  tags: Array<{ key?: string; value?: string }> | undefined,
): Array<{ key: string; value: string }> {
  if (!tags?.length) {
    return [];
  }
  const out: Array<{ key: string; value: string }> = [];
  for (const tag of tags) {
    const key = tag.key?.trim();
    if (!key || SENSITIVE_TAG_KEY.test(key)) {
      continue;
    }
    const value = tag.value ?? '';
    if (SENSITIVE_TAG_KEY.test(value)) {
      continue;
    }
    out.push({ key, value: value.slice(0, 256) });
  }
  return out;
}

export function extractNameTag(
  tags: Array<{ key: string; value: string }>,
): string | undefined {
  const name = tags.find((t) => t.key === 'Name')?.value?.trim();
  return name || undefined;
}
