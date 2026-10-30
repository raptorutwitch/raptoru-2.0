import { createHash } from 'node:crypto';

// Boutique cosmétique — badge images (docs/COSMETIC_SHOP.md): checked on their BYTES, never on a name or a declared type.
// Accepted: PNG (not animated: no acTL chunk) or still WebP (lossy, lossless, or extended without the animation flag),
// at most 40 Ko and 128 × 128 pixels. Refused: SVG (scripts), GIF, animated images, anything else. Stored by content
// hash; served with their exact type, `nosniff` and no script allowed.

export const IMAGE_LIMITS = { maxBytes: 40 * 1024, maxSide: 128 } as const;

export class CosmeticImageError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface CheckedImage {
  imageId: string;
  mime: 'image/png' | 'image/webp';
  width: number;
  height: number;
  size: number;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function png(b: Buffer) {
  if (b.length < 33 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (b.toString('latin1', 12, 16) !== 'IHDR')
    throw new CosmeticImageError('image_invalid');
  // Every chunk: an animated PNG (acTL) is refused.
  for (let i = 8; i + 8 <= b.length;) {
    const len = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    if (type === 'acTL') throw new CosmeticImageError('image_animated');
    if (type === 'IEND') break;
    i += 12 + len;
  }
  return {
    mime: 'image/png' as const,
    width: b.readUInt32BE(16),
    height: b.readUInt32BE(20),
  };
}

function webp(b: Buffer) {
  if (
    b.length < 30 ||
    b.toString('latin1', 0, 4) !== 'RIFF' ||
    b.toString('latin1', 8, 12) !== 'WEBP'
  )
    return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ')
    return {
      mime: 'image/webp' as const,
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
    };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return {
      mime: 'image/webp' as const,
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X') {
    if (b[20]! & 0x02) throw new CosmeticImageError('image_animated');
    return {
      mime: 'image/webp' as const,
      width: (b.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (b.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  }
  throw new CosmeticImageError('image_invalid');
}

/** Checks a badge image's bytes; returns its content id and dimensions, or throws CosmeticImageError. */
export function checkImage(bytes: Buffer): CheckedImage {
  if (!bytes.length) throw new CosmeticImageError('image_empty');
  if (bytes.length > IMAGE_LIMITS.maxBytes)
    throw new CosmeticImageError('image_too_large');
  const kind = png(bytes) ?? webp(bytes);
  if (!kind) throw new CosmeticImageError('image_type'); // SVG, GIF, JPEG, HTML… never
  if (
    kind.width < 1 ||
    kind.height < 1 ||
    kind.width > IMAGE_LIMITS.maxSide ||
    kind.height > IMAGE_LIMITS.maxSide
  )
    throw new CosmeticImageError('image_dimensions');
  return {
    imageId: createHash('sha256').update(bytes).digest('hex'),
    mime: kind.mime,
    width: kind.width,
    height: kind.height,
    size: bytes.length,
  };
}
