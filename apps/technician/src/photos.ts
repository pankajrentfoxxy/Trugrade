import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { DraftPhoto, PhotoAngle } from './domain/model';

/**
 * Compress a captured photograph and hash the bytes that will actually be sent.
 *
 * Two numbers set the shape of this. A modern phone camera produces 4–8 MB per
 * shot; six shots per unit and forty units is well over a gigabyte, uploaded
 * over whatever the warehouse has. And `UPLOAD_MAX_BYTES` is 5 MiB, so the raw
 * capture can exceed the server's own limit on its own.
 *
 * 1600 px on the long edge at quality 0.7 lands around 250–400 KB and still
 * shows what these photographs exist to show — a scratch on a lid, the seal code
 * on a sticker, backlight bleed on a panel. Going lower saves bandwidth by
 * destroying the evidence, which is the wrong trade for a document whose whole
 * job is to be looked at in a dispute.
 *
 * **The hash is taken after compression, never before.** It becomes
 * `qc_photo.hash` and it keys the pre-signed upload, so it has to describe the
 * bytes the server receives. Hashing the original would produce a digest that
 * matches nothing anyone can verify later.
 *
 * EXIF is stripped **server-side**, deliberately. The GPS tag in a photograph
 * taken at a vendor's warehouse is corroborating evidence for `arrival_geo_lat`
 * and it should reach the server before it is discarded — a client that strips
 * it first destroys the anti-fraud signal to save nothing.
 */
export const PHOTO_MAX_EDGE_PX = 1600;
export const PHOTO_QUALITY = 0.7;

export async function preparePhoto(
  sourceUri: string,
  angle: PhotoAngle | 'SEAL' | 'RECEIPT',
  capturedAt: number,
): Promise<DraftPhoto> {
  const compressed = await manipulateAsync(
    sourceUri,
    [{ resize: { width: PHOTO_MAX_EDGE_PX } }],
    { compress: PHOTO_QUALITY, format: SaveFormat.JPEG },
  );

  const file = new File(compressed.uri);
  const bytes = await file.arrayBuffer();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);

  return {
    angle,
    uri: compressed.uri,
    sha256: toHex(digest),
    bytes: bytes.byteLength,
    capturedAt,
  };
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
