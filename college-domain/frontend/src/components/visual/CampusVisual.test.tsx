import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const webgl = vi.hoisted(() => ({ available: false }))
vi.mock('../../lib/webgl', () => ({ isWebGLAvailable: () => webgl.available }))
vi.mock('./ThreeDScene', () => ({
  default: () => { throw new Error('GPU process crashed') },
}))

const { default: CampusVisual } = await import('./CampusVisual')

describe('CampusVisual', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the static illustration when WebGL is unavailable', () => {
    webgl.available = false
    const { container } = render(<CampusVisual />)
    expect(container.querySelector('svg.campus-visual__fallback')).toBeInTheDocument()
    expect(container.querySelector('canvas')).not.toBeInTheDocument()
  })

  it('falls back to the illustration if the 3D scene fails, without breaking the page', async () => {
    webgl.available = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = render(<><CampusVisual /><p>Login form still here</p></>)
    expect(await screen.findByText('Login form still here')).toBeInTheDocument()
    await vi.waitFor(() => expect(container.querySelector('svg.campus-visual__fallback')).toBeInTheDocument())
  })

  it('is hidden from assistive technology because it is decorative', () => {
    webgl.available = false
    const { container } = render(<CampusVisual />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})
