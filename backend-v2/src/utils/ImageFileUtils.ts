export type SupportedImageType = {
  extension: 'jpg' | 'png' | 'gif' | 'webp';
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND_CHUNK = Buffer.from([
  0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

const hasBytesAt = (buffer: Buffer, offset: number, expected: Buffer) =>
  offset >= 0
  && buffer.length >= offset + expected.length
  && buffer.subarray(offset, offset + expected.length).equals(expected);

const isJpeg = (buffer: Buffer) => {
  if (
    buffer.length < 16
    || buffer[0] !== 0xff
    || buffer[1] !== 0xd8
    || buffer[buffer.length - 2] !== 0xff
    || buffer[buffer.length - 1] !== 0xd9
  ) {
    return false;
  }

  let offset = 2;
  let hasFrame = false;
  let hasScan = false;

  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) return false;
    while (buffer[offset] === 0xff) offset += 1;

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length - 2) return false;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length - 2) return false;

    const isStartOfFrame = (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    );

    if (isStartOfFrame) {
      if (segmentLength < 8) return false;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (width === 0 || height === 0) return false;
      hasFrame = true;
    }

    if (marker === 0xda) {
      hasScan = true;
      break;
    }

    offset += segmentLength;
  }

  return hasFrame && hasScan;
};

const isPng = (buffer: Buffer) => {
  if (buffer.length < 45 || !hasBytesAt(buffer, 0, PNG_SIGNATURE)) return false;

  const hasValidHeader = buffer.readUInt32BE(8) === 13
    && buffer.toString('ascii', 12, 16) === 'IHDR'
    && buffer.readUInt32BE(16) > 0
    && buffer.readUInt32BE(20) > 0;

  return hasValidHeader && hasBytesAt(buffer, buffer.length - PNG_IEND_CHUNK.length, PNG_IEND_CHUNK);
};

const isGif = (buffer: Buffer) => {
  if (buffer.length < 14) return false;
  const signature = buffer.toString('ascii', 0, 6);
  return (signature === 'GIF87a' || signature === 'GIF89a')
    && buffer.readUInt16LE(6) > 0
    && buffer.readUInt16LE(8) > 0
    && buffer[buffer.length - 1] === 0x3b;
};

const isWebp = (buffer: Buffer) => {
  if (
    buffer.length < 20
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
    || buffer.readUInt32LE(4) !== buffer.length - 8
  ) {
    return false;
  }

  const chunkType = buffer.toString('ascii', 12, 16);
  const chunkSize = buffer.readUInt32LE(16);
  const paddedChunkEnd = 20 + chunkSize + (chunkSize % 2);

  return ['VP8 ', 'VP8L', 'VP8X'].includes(chunkType) && paddedChunkEnd <= buffer.length;
};

/**
 * Detect a supported image from its bytes. Client-provided names and MIME types
 * are intentionally ignored because they are trivially spoofed.
 */
export const detectSupportedImageType = (buffer: Buffer): SupportedImageType | null => {
  if (isJpeg(buffer)) return { extension: 'jpg', mimeType: 'image/jpeg' };
  if (isPng(buffer)) return { extension: 'png', mimeType: 'image/png' };
  if (isGif(buffer)) return { extension: 'gif', mimeType: 'image/gif' };
  if (isWebp(buffer)) return { extension: 'webp', mimeType: 'image/webp' };
  return null;
};
