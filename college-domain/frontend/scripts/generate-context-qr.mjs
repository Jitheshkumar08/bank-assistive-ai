// Generates printable CampusGuide college-context QR codes into docs/qr/.
// The payload identifies only the college and desk area: never a student, result or instruction.
//
// Development utility only (offline samples). Real codes are generated in the app: Super Admin → QR Management.
// Usage: npm run qr:generate            (NMAMIT admissions desk + one invalid sample for testing)
import { mkdirSync, writeFileSync } from 'node:fs'
import QRCode from 'qrcode'

const outDir = new URL('../docs/qr/', import.meta.url)
mkdirSync(outDir, { recursive: true })

const codes = [
  { file: 'nmamit-admissions-desk', payload: 'campusguide:college/nmamit?area=admissions-desk' },
  // For testing rejection: not an approved CampusGuide format.
  { file: 'invalid-sample', payload: 'https://example.com/not-a-campusguide-code' },
]

for (const { file, payload } of codes) {
  const options = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0c1f4f', light: '#ffffff' } }
  writeFileSync(new URL(`${file}.svg`, outDir), await QRCode.toString(payload, { ...options, type: 'svg' }))
  writeFileSync(new URL(`${file}.png`, outDir), await QRCode.toBuffer(payload, { ...options, width: 600 }))
  console.log(`docs/qr/${file}.{svg,png}  ←  ${payload}`)
}
