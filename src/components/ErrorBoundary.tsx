import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'
import { clearWorkspace } from '../persistence'
import { Button } from './ui'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last-resort boundary: a render-time error anywhere in the workspace
 * (malformed dataset, an operation producing an unexpected shape) shows this
 * card instead of a blank page. The recovered session can be discarded so a
 * bad restore cannot crash the app in a loop.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[DataCanvas] render error:', error, info.componentStack)
  }

  private reload = () => window.location.reload()

  private resetWorkspace = async () => {
    await clearWorkspace()
    window.location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <div className="crash-icon"><AlertTriangle size={28} /></div>
          <h1>页面遇到问题 / Something went wrong</h1>
          <p>
            应用在渲染时发生错误，你的原始文件不会受到影响。
            <br />
            The workspace hit a rendering error. Your original files are untouched.
          </p>
          <pre className="crash-detail"><code>{error.message}</code></pre>
          <div className="crash-actions">
            <Button variant="primary" icon={<RotateCcw size={15} />} onClick={this.reload}>
              重新加载 / Reload
            </Button>
            <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => { void this.resetWorkspace() }}>
              清空已保存会话并重启 / Reset saved session
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
