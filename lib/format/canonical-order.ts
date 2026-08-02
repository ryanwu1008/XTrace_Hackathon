const UTF8_ENCODER = new TextEncoder();

/**
 * Locale-independent byte ordering for values that participate in persisted
 * identities. This deliberately does not use localeCompare, whose result may
 * vary with the host locale.
 */
export function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = UTF8_ENCODER.encode(left);
  const rightBytes = UTF8_ENCODER.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
