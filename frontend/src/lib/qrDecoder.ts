import jsQR from 'jsqr';

/**
 * Pulls a frame off a live video element and looks for a QR code in it.
 *
 * Kept separate from the camera lifecycle so each can be reasoned about
 * and tested on its own: this file is pure pixels in, string out, and
 * knows nothing about permissions, streams or React.
 *
 * The decoded string is raw, untrusted text. It is deliberately NOT
 * parsed or validated here -- that stays with parseQrPayload and, above
 * it, the API.
 */
export type FrameDecoder = (video: HTMLVideoElement) => string | null;

/**
 * Long edge of the buffer frames are scaled into.
 *
 * Decoding cost scales with pixel count, and QR codes survive
 * downscaling well. Full sensor resolution would burn battery on a
 * phone for no extra reliability.
 */
const MAX_SAMPLE_EDGE = 640;

export function createFrameDecoder(): FrameDecoder {
  // One canvas reused for every frame; allocating per frame would churn
  // memory during a continuous scan.
  const canvas = document.createElement('canvas');
  const context = canvas.getContext?.('2d', { willReadFrequently: true }) ?? null;

  return function decodeFrame(video: HTMLVideoElement): string | null {
    // HAVE_CURRENT_DATA. Before this there are no pixels to read.
    if (!context || video.readyState < 2) return null;

    const { videoWidth, videoHeight } = video;

    if (!videoWidth || !videoHeight) return null;

    const scale = Math.min(1, MAX_SAMPLE_EDGE / Math.max(videoWidth, videoHeight));
    const width = Math.max(1, Math.round(videoWidth * scale));
    const height = Math.max(1, Math.round(videoHeight * scale));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.drawImage(video, 0, 0, width, height);

    let frame: ImageData;

    try {
      frame = context.getImageData(0, 0, width, height);
    } catch {
      // A tainted canvas cannot be read. Nothing to recover from here;
      // the next frame is tried instead of tearing the scanner down.
      return null;
    }

    const result = jsQR(frame.data, width, height, { inversionAttempts: 'dontInvert' });

    return result?.data ?? null;
  };
}
