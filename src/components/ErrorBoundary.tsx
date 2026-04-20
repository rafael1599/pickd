import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-main p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
            <span className="text-3xl">⚠️</span>
          </div>
          <h1 className="text-lg font-black uppercase tracking-tight text-content mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-muted mb-6 max-w-sm">
            {this.state.error?.message?.includes('dynamically imported module')
              ? 'A new version is available. The page will reload automatically.'
              : 'An unexpected error occurred. Try refreshing the page.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-accent text-white rounded-xl font-bold uppercase tracking-wider text-sm active:scale-95 transition-all"
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
