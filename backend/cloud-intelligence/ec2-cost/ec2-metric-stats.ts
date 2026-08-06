export function finiteValues(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v));
}

export function average(values: number[]): number | undefined {
  const nums = finiteValues(values);
  if (nums.length === 0) {
    return undefined;
  }
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function maximum(values: number[]): number | undefined {
  const nums = finiteValues(values);
  if (nums.length === 0) {
    return undefined;
  }
  return Math.max(...nums);
}

export function minimum(values: number[]): number | undefined {
  const nums = finiteValues(values);
  if (nums.length === 0) {
    return undefined;
  }
  return Math.min(...nums);
}

export function p95(values: number[]): number | undefined {
  const nums = finiteValues(values).sort((a, b) => a - b);
  if (nums.length === 0) {
    return undefined;
  }
  const idx = Math.ceil(nums.length * 0.95) - 1;
  return nums[Math.max(0, idx)];
}

export function sum(values: number[]): number | undefined {
  const nums = finiteValues(values);
  if (nums.length === 0) {
    return undefined;
  }
  return nums.reduce((a, b) => a + b, 0);
}
