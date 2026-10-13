import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Keeps the inspector, answers and ask bar usable when drawing one view fails. */
export class CanvasErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return <div className="app-message error">この画面を描けませんでした: {this.state.error.message}（戻る・パンくずで別の階層へ移動できます）</div>
    }
    return this.props.children
  }
}
