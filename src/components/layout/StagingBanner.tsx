const PRODUCTION_HOSTS = ['roman-app.vercel.app', 'www.roman-app.vercel.app'];

export const StagingBanner = () => {
  const host = window.location.hostname;
  const isProduction = PRODUCTION_HOSTS.includes(host);
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';

  if (isProduction || isLocalhost) return null;

  return (
    <div className="relative z-[999] w-full bg-amber-500/90 text-black text-center text-xs font-bold py-1 tracking-wide">
      STAGING — Preview Environment
    </div>
  );
};
