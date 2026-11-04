import { createHash } from 'node:crypto';

// Boutique cosmétique — badge images (docs/COSMETIC_SHOP.md): checked on their BYTES, never on a name or a declared type.
// Accepted: PNG (not animated: no acTL chunk) or still WebP (lossy, lossless, or extended without the animation flag),
// at most 40 Ko and 128 × 128 pixels. Refused: SVG (scripts), GIF, animated images, anything else. Stored by content
// hash; served with their exact type, `nosniff` and no script allowed.

export const IMAGE_LIMITS = { maxBytes: 40 * 1024, maxSide: 128 } as const;

// Avatar frames and banners (raptoru.fr lot 3, docs/COSMETIC_SHOP.md § 9): the same checks on the bytes, each kind
// with its own shape. No conversion in V1: the file served is the file sent (Studio tells the creator the rule).
export type ImagePurpose = 'badge' | 'frame' | 'banner';
export const IMAGE_RULES: Record<
  ImagePurpose,
  { maxBytes: number; fits: (w: number, h: number) => boolean }
> = {
  badge: {
    maxBytes: IMAGE_LIMITS.maxBytes,
    fits: (w, h) => w <= IMAGE_LIMITS.maxSide && h <= IMAGE_LIMITS.maxSide,
  },
  // Square, 128 to 512 px: the avatar is the central 62.5 % circle (the creator's template).
  frame: {
    maxBytes: 96 * 1024,
    fits: (w, h) => w === h && w >= 128 && w <= 512,
  },
  // 4:1 (one pixel of rounding), 1024 to 2048 px wide.
  banner: {
    maxBytes: 256 * 1024,
    fits: (w, h) => w >= 1024 && w <= 2048 && Math.abs(w - 4 * h) <= 4,
  },
};

/** Whether a stored image (its dimensions and size) fits an item of this kind; a title has no image. */
export function fitsKind(
  kind: string,
  img: { width: number; height: number; size: number },
) {
  const rule = IMAGE_RULES[kind as ImagePurpose];
  return (
    !!rule && img.size <= rule.maxBytes && rule.fits(img.width, img.height)
  );
}

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

/** Checks an image's bytes for its purpose; returns its content id and dimensions, or throws CosmeticImageError. */
export function checkImage(
  bytes: Buffer,
  purpose: ImagePurpose = 'badge',
): CheckedImage {
  const rule = IMAGE_RULES[purpose];
  if (!bytes.length) throw new CosmeticImageError('image_empty');
  if (bytes.length > rule.maxBytes)
    throw new CosmeticImageError('image_too_large');
  const kind = png(bytes) ?? webp(bytes);
  if (!kind) throw new CosmeticImageError('image_type'); // SVG, GIF, JPEG, HTML… never
  if (kind.width < 1 || kind.height < 1 || !rule.fits(kind.width, kind.height))
    throw new CosmeticImageError('image_dimensions');
  return {
    imageId: createHash('sha256').update(bytes).digest('hex'),
    mime: kind.mime,
    width: kind.width,
    height: kind.height,
    size: bytes.length,
  };
}
