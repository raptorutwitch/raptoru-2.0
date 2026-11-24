import { createHash } from 'node:crypto';
import { SOUND_FILE_RULES, type SoundFile } from '@raptoru/schemas';

// A sound published from Studio (docs/SOUNDBOARD.md): Studio cuts the extract and encodes it as a PCM 16-bit WAV. The
// Core trusts nothing of it: the file must be a complete WAV (the RIFF size is the whole upload, every chunk inside it,
// whole sample frames), PCM 16-bit, mono or stereo, 8 to 48 kHz, within the Soundboard's size and duration bounds.
// Its id is the SHA-256 of its bytes, computed here.

export class SoundFileError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function checkWav(bytes: Buffer): SoundFile {
  if (bytes.length > SOUND_FILE_RULES.maxBytes)
    throw new SoundFileError('file_too_large');
  if (
    bytes.length < 44 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new SoundFileError('not_wav');
  if (bytes.readUInt32LE(4) + 8 !== bytes.length)
    throw new SoundFileError('incomplete_file');
  let fmt: { format: number; channels: number; rate: number; bits: number } = {
    format: 0,
    channels: 0,
    rate: 0,
    bits: 0,
  };
  let data = -1;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = at + 8;
    if (body + size > bytes.length) throw new SoundFileError('incomplete_file');
    if (id === 'fmt ' && size >= 16)
      fmt = {
        format: bytes.readUInt16LE(body),
        channels: bytes.readUInt16LE(body + 2),
        rate: bytes.readUInt32LE(body + 4),
        bits: bytes.readUInt16LE(body + 14),
      };
    if (id === 'data') data = size;
    at = body + size + (size % 2);
  }
  if (!fmt.format || data < 0) throw new SoundFileError('not_wav');
  if (
    fmt.format !== 1 ||
    fmt.bits !== 16 ||
    fmt.channels < 1 ||
    fmt.channels > 2 ||
    fmt.rate < 8000 ||
    fmt.rate > 48000
  )
    throw new SoundFileError('unsupported_wav');
  const frame = fmt.channels * 2;
  if (data === 0 || data % frame) throw new SoundFileError('incomplete_file');
  const duration_ms = Math.round((data / frame / fmt.rate) * 1000);
  if (
    duration_ms < SOUND_FILE_RULES.minDurationMs ||
    duration_ms > SOUND_FILE_RULES.maxDurationMs
  )
    throw new SoundFileError('duration_out_of_bounds');
  return {
    file_id: createHash('sha256').update(bytes).digest('hex'),
    mime: 'audio/wav',
    duration_ms,
    size: bytes.length,
  };
}

/** Where a published file is reached: the extension (resolved against its EBS) and Studio's player both read it. */
export const soundFileUrl = (fileId: string) => `sound-files/${fileId}.wav`;
