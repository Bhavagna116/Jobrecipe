import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

export const AdminLoginPage = () => {
  const { loginAdmin, navigateTo, role } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  React.useEffect(() => {
    if (role === 'admin') {
      navigateTo('admin-candidates');
    }
  }, [role, navigateTo]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter admin email and password.');
      return;
    }
    setError('');
    setIsLoading(true);
    const res = await loginAdmin(email, password);
    setIsLoading(false);
    if (!res.success) {
      setError(res.error || 'Admin login failed. Please check credentials.');
    } else {
      navigateTo('admin-candidates');
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 text-ink">
      <div className="sm:mx-auto sm:w-full sm:max-w-sm">

        {/* Brand */}
        <div
          onClick={() => navigateTo('hero')}
          className="flex items-center justify-center gap-2 cursor-pointer group mb-8"
        >
          <div>
            <span className="text-[20px] font-black text-ink tracking-tight">
              ReadySet<span className="text-ink/80">Job</span>
            </span>
            <span className="block text-[10px] font-bold text-ink/40 uppercase tracking-[0.2em]">
              Admin Portal
            </span>
          </div>
        </div>

        <h2 className="text-center text-[26px] font-extrabold text-ink tracking-tight mb-2">
          Administrator Sign In
        </h2>
        <p className="text-center text-[13px] text-ink/50 mb-8 leading-relaxed">
          Manage assessments, evaluate candidate benchmarks, and generate placement reports.
        </p>

        {/* Card */}
        <div className="bg-white border border-line rounded-[16px] p-8 shadow-card">
          {error && (
            <div className="p-4 bg-ink/5 border border-line/50 rounded-[10px] text-[12px] font-medium text-ink/70 mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-[12px] font-bold text-ink/70 mb-2 tracking-[0.05em] uppercase">
                Admin Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 bg-input text-[14px] text-ink rounded-[10px] border border-line focus:border-ink focus:ring-1 focus:ring-ink outline-none transition-colors duration-200 font-sans"
                placeholder=" "
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[12px] font-bold text-ink/70 tracking-[0.05em] uppercase">
                  Password
                </label>
                <a
                  href="#forgot"
                  onClick={(e) => {
                    e.preventDefault();
                    alert('Reset instructions sent to admin recovery email.');
                  }}
                  className="text-[12px] font-bold text-ink/60 hover:text-ink underline-offset-2 hover:underline"
                >
                  Forgot?
                </a>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full pr-10 px-4 py-3 bg-input text-[14px] text-ink rounded-[10px] border border-line focus:border-ink focus:ring-1 focus:ring-ink outline-none transition-colors duration-200 font-sans"
                  placeholder=" "
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-ink/40 hover:text-ink focus:outline-none rounded-[6px] transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-[16px] h-[16px] rounded-sm border border-line bg-white text-ink focus:ring-2 focus:ring-ink cursor-pointer"
                />
                <span className="text-[13px] text-ink/70 font-medium">Remember Me</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 bg-ink text-white rounded-[10px] text-[14px] font-bold tracking-tight hover:bg-ink/90 active:bg-ink/80 disabled:bg-ink/30 disabled:cursor-not-allowed transition-colors duration-200 font-sans"
            >
              {isLoading ? 'Signing in…' : 'Sign In as Admin'}
            </button>
          </form>

          {/* Footer link */}
          <div className="mt-8 pt-4 border-t border-line text-center text-[12px] text-ink/50">
            Student or Candidate?{' '}
            <button
              type="button"
              onClick={() => navigateTo('login')}
              className="font-bold text-ink hover:underline"
            >
              Candidate Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
