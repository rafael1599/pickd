/**
 * Lo que se ve cuando algo revienta — y **qué dijo**.
 *
 * Durante meses esta pantalla enseñó «An unexpected error occurred» y nada más:
 * el mensaje se iba a la consola, que en el teléfono del piso no existe. Así que
 * un crash en bodega llegaba como «el sistema crashed» y no había con qué
 * arreglarlo (Rafael, 22 sep 2026). Ahora la pantalla lleva **el mensaje y el
 * build que corre**, para que una foto baste para diagnosticarlo — y un botón
 * que lo copia entero con la pila, para cuando se pueda pegar.
 *
 * Es la misma regla del resto de PickD: lo que no cuadra se dice, no se esconde.
 */
import { Component, type ReactNode } from 'react';
import { buildCommit } from '../hooks/useAppUpdate';

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

  /** Todo lo que hace falta para diagnosticarlo, en un solo pegado. */
  private report(): string {
    const { error } = this.state;
    return [
      `PickD ${buildCommit(__BUILD_ID__)}`,
      location.pathname + location.search,
      new Date().toISOString(),
      '',
      error?.message ?? 'sin mensaje',
      error?.stack ?? '',
    ].join('\n');
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
          <p className="text-sm text-muted mb-4 max-w-sm">
            {this.state.error?.message?.includes('dynamically imported module')
              ? 'A new version is available. The page will reload automatically.'
              : 'An unexpected error occurred. Try refreshing the page.'}
          </p>

          {/* El mensaje, a la vista: una foto de esta pantalla tiene que bastar
              para arreglarlo. Sin esto, un crash en el piso llega como «crashed». */}
          {this.state.error?.message && (
            <p className="mb-2 max-w-sm w-full rounded-xl border border-subtle bg-card px-3 py-2 text-left font-mono text-[11px] leading-snug text-red-400 break-words">
              {this.state.error.message}
            </p>
          )}
          <p className="mb-6 font-mono text-[10px] uppercase tracking-widest text-muted/70">
            {buildCommit(__BUILD_ID__)} · {location.pathname}
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-accent text-white rounded-xl font-bold uppercase tracking-wider text-sm active:scale-95 transition-all"
            >
              Reload App
            </button>
            <button
              onClick={() => void navigator.clipboard?.writeText(this.report())}
              className="px-4 py-3 rounded-xl border border-subtle text-muted font-bold uppercase tracking-wider text-sm active:scale-95 transition-all"
            >
              Copy error
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
