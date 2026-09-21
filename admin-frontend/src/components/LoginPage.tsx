import { useEffect, useRef, useState } from 'react';

export default function LoginPage({ setAuth }: { setAuth: (auth: boolean) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [requireTotp, setRequireTotp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const totpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (requireTotp) {
      totpInputRef.current?.focus();
    }
  }, [requireTotp]);

  const closeTotpModal = () => {
    if (loading) return;
    setRequireTotp(false);
    setTotpCode('');
    setError('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, totpCode: totpCode || undefined })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        localStorage.setItem('admin_token', data.token);
        setAuth(true);
      } else if (res.status === 401 && data.requireTotp) {
        setRequireTotp(true);
      } else {
        setError(data.message || '登录失败');
      }
    } catch (err) {
      setError('网络请求失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-xianxia-bg flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-song relative overflow-hidden">
      {/* 仙侠风格背景装饰 */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] right-[-5%] w-96 h-96 rounded-full border border-xianxia-border/30" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[30rem] h-[30rem] rounded-full border border-xianxia-border/20" />
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <h2 className="mt-6 text-center text-3xl font-kai tracking-[0.2em] text-xianxia-text">
          系统管理后台
        </h2>
        <p className="mt-2 text-center text-xs tracking-widest text-xianxia-text/60">
          ZhuiYi Admin Control Plane
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-xianxia-bg border border-xianxia-border/50 py-8 px-4 shadow-2xl sm:px-10">
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label className="block text-xs font-bold tracking-widest text-xianxia-text">
                管理员账号 (Username)
              </label>
              <div className="mt-1">
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-xianxia-border/60 bg-xianxia-bg/50 text-xianxia-text placeholder-xianxia-text/30 focus:outline-none focus:ring-1 focus:ring-xianxia-jade focus:border-xianxia-jade text-sm transition-colors disabled:opacity-50"
                  placeholder="输入管理员账号"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold tracking-widest text-xianxia-text">
                登录密码 (Password)
              </label>
              <div className="mt-1">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full px-3 py-2 border border-xianxia-border/60 bg-xianxia-bg/50 text-xianxia-text placeholder-xianxia-text/30 focus:outline-none focus:ring-1 focus:ring-xianxia-jade focus:border-xianxia-jade text-sm transition-colors disabled:opacity-50"
                  placeholder="输入管理员密码"
                />
              </div>
            </div>

            {!requireTotp && error && (
              <div className="text-[11px] text-xianxia-red border border-xianxia-red/30 bg-xianxia-red/5 p-2 tracking-widest text-center">
                {error}
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-bold tracking-[0.2em] text-xianxia-bg bg-xianxia-text hover:bg-xianxia-jade focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-xianxia-jade transition-colors disabled:opacity-70"
              >
                {loading ? '验证中...' : '登录系统'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {requireTotp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-xianxia-text/35 px-4 py-8 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="totp-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeTotpModal();
          }}
        >
          <div className="w-full max-w-sm border border-xianxia-border bg-xianxia-bg p-6 shadow-2xl sm:p-8">
            <div className="border-l-2 border-xianxia-jade pl-3">
              <p className="text-[10px] tracking-[0.22em] text-xianxia-jade">SECURITY / TWO-FACTOR</p>
              <h3 id="totp-modal-title" className="mt-1 font-kai text-2xl tracking-[0.14em] text-xianxia-text">验证动态口令</h3>
            </div>

            <p className="mt-5 text-xs leading-6 tracking-wider text-xianxia-text/65">
              账号密码已验证。请输入身份验证器中显示的 6 位动态码以进入控制面。
            </p>

            <form className="mt-6" onSubmit={handleLogin}>
              <label htmlFor="totp-code" className="block text-xs font-bold tracking-widest text-xianxia-text">
                动态码 (TOTP Code)
              </label>
              <input
                ref={totpInputRef}
                id="totp-code"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="mt-2 block w-full border border-xianxia-jade/60 bg-xianxia-bg/50 px-3 py-3 text-center font-mono text-xl tracking-[0.5em] text-xianxia-text placeholder-xianxia-jade/30 transition-colors focus:border-xianxia-jade focus:outline-none focus:ring-1 focus:ring-xianxia-jade"
                placeholder="000000"
                maxLength={6}
                aria-describedby="totp-help"
              />
              <p id="totp-help" className="mt-2 text-[10px] tracking-widest text-xianxia-jade/75">动态码仅用于本次登录验证</p>

              {error && (
                <div className="mt-4 border border-xianxia-red/30 bg-xianxia-red/5 p-2 text-center text-[11px] tracking-widest text-xianxia-red">
                  {error}
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={closeTotpModal}
                  disabled={loading}
                  className="flex-1 border border-xianxia-border/70 px-4 py-2.5 text-sm font-bold tracking-[0.16em] text-xianxia-text transition-colors hover:border-xianxia-text disabled:opacity-60"
                >
                  返回
                </button>
                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6}
                  className="flex-1 bg-xianxia-text px-4 py-2.5 text-sm font-bold tracking-[0.16em] text-xianxia-bg transition-colors hover:bg-xianxia-jade disabled:opacity-60"
                >
                  {loading ? '验证中...' : '验证并进入'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
