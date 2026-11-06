import { ContactShadows, Float } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import { MathUtils, Shape, type Group, type Mesh } from 'three'

/**
 * Decorative campus scene built from simple geometry (no model downloads):
 * a classical university facade, a floating graduation cap, orbit rings and a few floating shapes.
 * Kept deliberately light: ~40 meshes, three lights, one static contact-shadow pass, capped pixel ratio.
 */
export type ThreeDSceneProps = {
  /** Render continuously only while visible; 'never' pauses the render loop entirely. */
  active: boolean
  reducedMotion: boolean
  onContextLost: () => void
}

const stone = '#eef3fb'
const stoneShade = '#d5def0'
const accent = '#3b74ef'
const columnXs = [-1.1, -0.66, -0.22, 0.22, 0.66, 1.1]

function Pediment() {
  const shape = useMemo(() => {
    const triangle = new Shape()
    triangle.moveTo(-1.55, 0)
    triangle.lineTo(1.55, 0)
    triangle.lineTo(0, 0.62)
    triangle.closePath()
    return triangle
  }, [])
  return (
    <mesh position={[0, 1.73, -0.72]} castShadow>
      <extrudeGeometry args={[shape, { depth: 1.44, bevelEnabled: false }]} />
      <meshStandardMaterial color={stone} roughness={0.45} metalness={0.05} />
    </mesh>
  )
}

function ArchedWindow({ x }: { x: number }) {
  return (
    <group position={[x, 0.82, -0.31]}>
      <mesh>
        <planeGeometry args={[0.26, 0.5]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <circleGeometry args={[0.13, 20, 0, Math.PI]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.9} roughness={0.3} />
      </mesh>
    </group>
  )
}

function UniversityBuilding() {
  return (
    <group>
      {/* Steps */}
      {[0, 1, 2].map((step) => (
        <mesh key={step} position={[0, 0.06 + step * 0.12, 0.12 - step * 0.08]} receiveShadow castShadow>
          <boxGeometry args={[3.5 - step * 0.22, 0.12, 1.9 - step * 0.16]} />
          <meshStandardMaterial color={step === 0 ? stoneShade : stone} roughness={0.6} />
        </mesh>
      ))}
      {/* Back wall with glowing arched windows */}
      <mesh position={[0, 0.98, -0.38]} castShadow>
        <boxGeometry args={[2.7, 1.28, 0.12]} />
        <meshStandardMaterial color={stoneShade} roughness={0.55} />
      </mesh>
      {[-0.66, 0, 0.66].map((x) => <ArchedWindow key={x} x={x} />)}
      {/* Colonnade */}
      {columnXs.map((x) => (
        <group key={x} position={[x, 0, 0.42]}>
          <mesh position={[0, 0.98, 0]} castShadow>
            <cylinderGeometry args={[0.085, 0.1, 1.28, 18]} />
            <meshStandardMaterial color={stone} roughness={0.4} />
          </mesh>
          <mesh position={[0, 1.66, 0]}>
            <boxGeometry args={[0.26, 0.08, 0.26]} />
            <meshStandardMaterial color={stone} roughness={0.4} />
          </mesh>
        </group>
      ))}
      {/* Entablature with a thin accent band */}
      <mesh position={[0, 1.66, 0]} castShadow>
        <boxGeometry args={[3.1, 0.16, 1.46]} />
        <meshStandardMaterial color={stone} roughness={0.45} />
      </mesh>
      <mesh position={[0, 1.6, 0.735]}>
        <boxGeometry args={[3.1, 0.035, 0.01]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.6} />
      </mesh>
      <Pediment />
    </group>
  )
}

function GraduationCap() {
  return (
    <group rotation={[0.18, Math.PI / 4, 0.08]}>
      <mesh castShadow>
        <boxGeometry args={[0.78, 0.045, 0.78]} />
        <meshStandardMaterial color="#2c4f94" emissive="#1a3463" emissiveIntensity={0.35} roughness={0.45} metalness={0.2} />
      </mesh>
      <mesh position={[0, -0.12, 0]}>
        <cylinderGeometry args={[0.24, 0.27, 0.2, 24]} />
        <meshStandardMaterial color="#24447f" emissive="#1a3463" emissiveIntensity={0.3} roughness={0.45} />
      </mesh>
      <mesh position={[0.3, -0.1, 0.3]}>
        <cylinderGeometry args={[0.012, 0.012, 0.22, 8]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0.3, -0.23, 0.3]}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.8} />
      </mesh>
    </group>
  )
}

function OrbitRing({ radius, tilt, speed, reducedMotion }: { radius: number; tilt: [number, number, number]; speed: number; reducedMotion: boolean }) {
  const ref = useRef<Mesh>(null)
  useFrame((_, delta) => {
    if (!reducedMotion && ref.current) ref.current.rotation.z += delta * speed
  })
  return (
    <mesh ref={ref} rotation={tilt}>
      <torusGeometry args={[radius, 0.011, 8, 160]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.2} transparent opacity={0.7} />
    </mesh>
  )
}

const floatingShapes = [
  { position: [-2.35, 2.2, -0.6], kind: 'octahedron', size: 0.2, speed: 1.4 },
  { position: [2.45, 1.4, -0.4], kind: 'icosahedron', size: 0.17, speed: 1.1 },
  { position: [-1.9, 0.45, 1.1], kind: 'icosahedron', size: 0.12, speed: 1.7 },
  { position: [2.0, 2.75, 0.4], kind: 'octahedron', size: 0.13, speed: 1.25 },
] as const

/** Entrance motion and pointer-following tilt; inert when the user prefers reduced motion. */
function SceneRig({ reducedMotion, children }: { reducedMotion: boolean; children: ReactNode }) {
  const group = useRef<Group>(null)
  const entrance = useRef(0)
  useFrame((state, delta) => {
    const node = group.current
    if (!node || reducedMotion) return
    entrance.current = Math.min(1, entrance.current + delta / 1.4)
    const eased = 1 - (1 - entrance.current) ** 3
    node.position.y = (1 - eased) * -0.5
    node.scale.setScalar(0.9 + 0.1 * eased)
    const idle = Math.sin(state.clock.elapsedTime * 0.25) * 0.06
    node.rotation.y = MathUtils.damp(node.rotation.y, state.pointer.x * 0.32 + idle - 0.25, 3, delta)
    node.rotation.x = MathUtils.damp(node.rotation.x, -state.pointer.y * 0.06, 3, delta)
  })
  return <group ref={group} rotation={[0, -0.25, 0]}>{children}</group>
}

export default function ThreeDScene({ active, reducedMotion, onContextLost }: ThreeDSceneProps) {
  const floatSpeed = reducedMotion ? 0 : 1
  return (
    <Canvas
      className="campus-canvas"
      frameloop={!active ? 'never' : reducedMotion ? 'demand' : 'always'}
      dpr={[1, 1.75]}
      shadows="percentage"
      camera={{ position: [0, 1.7, 8.2], fov: 32 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', onContextLost, { once: true })}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 7, 5]} intensity={1.6} color="#f4f7ff" castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-3.5, 2.5, 2]} intensity={14} color="#5d8dff" distance={12} />

      <SceneRig reducedMotion={reducedMotion}>
        <group position={[0, -0.95, 0]}>
          <UniversityBuilding />
          <Float speed={1.2 * floatSpeed} floatIntensity={reducedMotion ? 0 : 0.6} rotationIntensity={reducedMotion ? 0 : 0.4}>
            <group position={[0, 3.05, 0.1]}>
              <GraduationCap />
            </group>
          </Float>
          {floatingShapes.map((shape) => (
            <Float key={shape.position.join()} speed={shape.speed * floatSpeed} floatIntensity={reducedMotion ? 0 : 0.8} rotationIntensity={reducedMotion ? 0 : 1.2}>
              <mesh position={[...shape.position]}>
                {shape.kind === 'octahedron' ? <octahedronGeometry args={[shape.size]} /> : <icosahedronGeometry args={[shape.size]} />}
                <meshStandardMaterial color="#9fbcff" emissive={accent} emissiveIntensity={0.35} roughness={0.25} metalness={0.3} flatShading />
              </mesh>
            </Float>
          ))}
          <ContactShadows position={[0, 0, 0]} scale={7} blur={2.6} far={3.5} opacity={0.45} color="#020817" resolution={256} frames={1} />
        </group>
        <group position={[0, 0.25, 0]}>
          <OrbitRing radius={2.9} tilt={[Math.PI / 2.25, 0, 0.2]} speed={0.08} reducedMotion={reducedMotion} />
          <OrbitRing radius={3.35} tilt={[Math.PI / 1.85, 0.25, 0]} speed={-0.05} reducedMotion={reducedMotion} />
        </group>
      </SceneRig>
    </Canvas>
  )
}
