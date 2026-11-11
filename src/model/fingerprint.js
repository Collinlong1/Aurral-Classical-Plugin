import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";

// Fingerprints identify the same audio across rescans. Tag edits (by this
// plugin, Aurral's own download tagging, Picard, ...) must not change them,
// so the hash covers only the audio payload where the container is simple
// enough to locate it. Other formats keep the whole-file hash, which is
// marked as tag-sensitive so a mismatch is not treated as different audio.
export const AUDIO_PREFIX = "audio-sha256-v2:";
export const CONTAINER_PREFIX = "file-sha256-v1:";

// A whole-file (container) hash changes with any tag edit, so two different
// container hashes say nothing about whether the audio changed.
export const tagSensitive = (fingerprint) =>
  typeof fingerprint === "string" && fingerprint.startsWith(CONTAINER_PREFIX);

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

const synchsafe = (b, offset) =>
  ((b[offset] & 0x7f) << 21) |
  ((b[offset + 1] & 0x7f) << 14) |
  ((b[offset + 2] & 0x7f) << 7) |
  (b[offset + 3] & 0x7f);

// Leading ID3v2 tags (MP3, and occasionally FLAC files written by some taggers).
async function skipId3v2(handle, start, size) {
  let position = start;
  while (position + 10 <= size) {
    const header = await readAt(handle, position, 10);
    if (header.length < 10 || header.toString("latin1", 0, 3) !== "ID3") break;
    const footer = header[5] & 0x10 ? 10 : 0;
    position += 10 + synchsafe(header, 6) + footer;
  }
  return position;
}

// Trailing ID3v1 and APEv2 tags (MP3 and other raw streams).
async function trailingTagStart(handle, start, size) {
  let end = size;
  for (let changed = true; changed && end > start; ) {
    changed = false;
    if (end - start >= 128) {
      const tail = await readAt(handle, end - 128, 3);
      if (tail.toString("latin1") === "TAG") {
        end -= 128;
        changed = true;
        continue;
      }
    }
    if (end - start >= 32) {
      const footer = await readAt(handle, end - 32, 32);
      if (footer.toString("latin1", 0, 8) === "APETAGEX") {
        const tagSize = footer.readUInt32LE(12);
        const hasHeader = (footer.readUInt32LE(20) & 0x80000000) !== 0;
        const total = tagSize + (hasHeader ? 32 : 0);
        if (total > 0 && total <= end - start) {
          end -= total;
          changed = true;
        }
      }
    }
  }
  return end;
}

async function flacAudioStart(handle, start, size) {
  let position = start + 4;
  for (;;) {
    const header = await readAt(handle, position, 4);
    if (header.length < 4) return null;
    const last = (header[0] & 0x80) !== 0;
    const length = header.readUIntBE(1, 3);
    position += 4 + length;
    if (position > size) return null;
    if (last) return position;
  }
}

// RIFF/WAVE: hash the fmt and data chunks only; LIST/id3/bext chunks hold tags.
async function wavRanges(handle, size) {
  const ranges = [];
  let position = 12;
  while (position + 8 <= size) {
    const header = await readAt(handle, position, 8);
    if (header.length < 8) break;
    const id = header.toString("latin1", 0, 4);
    const length = header.readUInt32LE(4);
    const body = position + 8;
    if (id === "fmt " || id === "data")
      ranges.push([body, Math.min(size, body + length)]);
    position = body + length + (length % 2);
  }
  return ranges.some(([s, e]) => e > s) ? ranges : null;
}

async function audioRanges(file) {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const magic = await readAt(handle, 0, 12);
    if (
      magic.toString("latin1", 0, 4) === "RIFF" &&
      magic.toString("latin1", 8, 12) === "WAVE"
    )
      // Await before the finally block closes the handle.
      return await wavRanges(handle, size);
    const start = await skipId3v2(handle, 0, size);
    const head = await readAt(handle, start, 4);
    if (head.toString("latin1") === "fLaC") {
      const audio = await flacAudioStart(handle, start, size);
      return audio == null ? null : [[audio, size]];
    }
    // MPEG audio frame sync after optional ID3v2.
    if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
      const end = await trailingTagStart(handle, start, size);
      return end > start ? [[start, end]] : null;
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function hashRanges(file, ranges) {
  const hash = createHash("sha256");
  for (const [start, end] of ranges) {
    if (end <= start) continue;
    for await (const bytes of createReadStream(file, { start, end: end - 1 }))
      hash.update(bytes);
  }
  return hash.digest("hex");
}

export async function fingerprint(file) {
  let ranges = null;
  try {
    ranges = await audioRanges(file);
  } catch {
    ranges = null;
  }
  if (ranges) return `${AUDIO_PREFIX}${await hashRanges(file, ranges)}`;
  const { size } = await fs.stat(file);
  return `${CONTAINER_PREFIX}${await hashRanges(file, [[0, size]])}`;
}
