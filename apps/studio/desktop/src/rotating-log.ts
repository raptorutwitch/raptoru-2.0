import { appendFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// Studio server output kept by Electron (ASTRA-P2-023): the current session in `file`, the previous
// one in `file.1` (rotated at the first line, as before). A session that writes more than `maxBytes`
// (an error repeated in a loop) starts a fresh file, the full one becoming `file.1`: at most about
// twice `maxBytes` on disk, the latest lines always kept. Lines are rare: plain synchronous appends.
export const SERVER_LOG_MAX_BYTES = 5 * 1024 * 1024;

export function rotatingLog(file: string, maxBytes = SERVER_LOG_MAX_BYTES) {
  let size = -1;
  const rotate = () => {
    try {
      renameSync(file, `${file}.1`);
    } catch {
      /* nothing to rotate yet */
    }
    size = 0;
  };
  return (line: string) => {
    if (size < 0) {
      mkdirSync(dirname(file), { recursive: true });
      rotate(); // previous session → .1
    }
    const text = `${line}\n`;
    const bytes = Buffer.byteLength(text);
    if (size > 0 && size + bytes > maxBytes) rotate();
    appendFileSync(file, text);
    size += bytes;
  };
}
