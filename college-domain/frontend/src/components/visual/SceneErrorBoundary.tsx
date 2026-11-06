import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { fallback: ReactNode; children: ReactNode }
type State = { failed: boolean }

/** Keeps a 3D failure (driver, shader, chunk load) from affecting the rest of the page. */
export default class SceneErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.warn('CampusGuide 3D scene disabled:', error, info.componentStack)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
