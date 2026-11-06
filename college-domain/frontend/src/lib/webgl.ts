let cached: boolean | undefined

/** True when the browser can create a WebGL context. Checked once and cached; the probe context is released. */
export function isWebGLAvailable(): boolean {
  if (cached !== undefined) return cached
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    cached = context !== null
    context?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    cached = false
  }
  return cached
}
