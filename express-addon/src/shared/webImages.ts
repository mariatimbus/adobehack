export interface WebImageInput {
  name: string;
  blob: Blob;
  width: number;
  height: number;
  backgroundRemoved?: boolean;
}

export interface WebImageInsertResult {
  insertedCount: number;
  pageCount: number;
}

/** The Adobe document sandbox has no window.atob or Node Buffer. */
export function decodeBase64(input: string): Uint8Array {
  const data = input.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const raw = data.replace(/=+$/, "");
  const padding = data.length - raw.length;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || raw.length % 4 === 1 ||
      (padding > 0 && (data.length % 4 !== 0 || padding !== (4 - raw.length % 4) % 4))) {
    throw new Error("Invalid image Base64 data.");
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new Uint8Array(Math.floor(raw.length * 6 / 8));
  let buffer = 0, bits = 0, index = 0;
  for (const char of raw) {
    buffer = (buffer << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >>> bits) & 255;
      buffer &= (1 << bits) - 1;
    }
  }
  return bytes;
}
