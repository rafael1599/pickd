import { useState, FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import KeyRound from 'lucide-react/dist/esm/icons/key-round';
import Mail from 'lucide-react/dist/esm/icons/mail';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';

export const LoginScreen = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: sbError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (sbError) throw sbError;
      // AuthContext will handle state update via onAuthStateChange
    } catch (err: unknown) {
      console.error('Login error:', err);
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message === 'Invalid login credentials' ? 'Incorrect credentials. Try again.' : message
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-main flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <div className="mx-auto mb-8 flex flex-col items-center">
            <div className="w-24 h-24 mb-6 relative group transform transition-all duration-700 hover:scale-110 active:scale-95">
              <div className="absolute inset-0 bg-accent/20 blur-2xl rounded-full scale-150 animate-pulse opacity-50" />
              <img
                src="/PickD.png"
                alt="PickD Logo"
                className="w-full h-full relative z-10 drop-shadow-2xl animate-pickd-check"
              />
            </div>
            <h1
              className="text-4xl font-black text-content tracking-tighter"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              <span className="text-accent underline decoration-4 decoration-accent/30 underline-offset-4">
                P
              </span>
              ICK<span className="text-accent">D</span>
            </h1>
          </div>
          <p className="text-muted font-medium">Sign in to access</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-4">
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Mail
                  className="text-muted group-focus-within:text-accent transition-colors"
                  size={20}
                />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-card border border-subtle text-content pl-11 pr-4 py-4 rounded-xl focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all placeholder:text-muted/50 font-medium"
                placeholder="Email"
                autoComplete="email"
                required
              />
            </div>

            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <KeyRound
                  className="text-muted group-focus-within:text-accent transition-colors"
                  size={20}
                />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-card border border-subtle text-content pl-11 pr-4 py-4 rounded-xl focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all placeholder:text-muted/50 font-medium"
                placeholder="Password"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-400 text-sm text-center font-medium">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-content hover:opacity-90 text-main font-bold py-4 rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="animate-spin" size={20} />
            ) : (
              <>
                Sign In <ArrowRight size={20} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
