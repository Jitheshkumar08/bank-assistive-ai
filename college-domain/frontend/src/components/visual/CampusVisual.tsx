import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../../lib/useMediaQuery'
import { isWebGLAvailable } from '../../lib/webgl'
import CampusIllustration from './CampusIllustration'
import SceneErrorBoundary from './SceneErrorBoundary'
import './CampusVisual.css'

// Three.js and the scene load in their own chunk, after the login form is already usable.
const ThreeDScene = lazy(() => import('./ThreeDScene'))

/**
 * Chooses between the interactive 3D scene and the static illustration.
 * Falls back when WebGL is missing, the scene throws, or the GPU context is lost; pauses rendering off-screen.
 */
export default function CampusVisual() {
  const reducedMotion = usePrefersReducedMotion()
  const [webgl] = useState(isWebGLAvailable)
  const [contextLost, setContextLost] = useState(false)
  const [visible, setVisible] = useState(true)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = container.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const fallback = <CampusIllustration className="campus-visual__fallback" />
  const use3d = webgl && !contextLost

  return (
    <div ref={container} className="campus-visual" aria-hidden="true">
      {use3d ? (
        <SceneErrorBoundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <ThreeDScene active={visible} reducedMotion={reducedMotion} onContextLost={() => setContextLost(true)} />
          </Suspense>
        </SceneErrorBoundary>
      ) : fallback}
    </div>
  )
}
