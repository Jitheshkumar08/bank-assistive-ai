import QRCode from 'qrcode'

export type QrImageFormat = 'png' | 'svg'

// Same appearance as the original printed codes (frontend/scripts/generate-context-qr.mjs), larger PNG for print.
const options = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0c1f4f', light: '#ffffff' } } as const

/** Renders a QR image in memory; nothing is written to disk. The text always comes from a validated placement. */
export async function renderQr(text: string, format: QrImageFormat): Promise<Buffer> {
  if (format === 'svg') return Buffer.from(await QRCode.toString(text, { ...options, type: 'svg' }), 'utf8')
  return QRCode.toBuffer(text, { ...options, type: 'png', width: 1024 })
}

export const contentTypes: Record<QrImageFormat, string> = { png: 'image/png', svg: 'image/svg+xml' }
