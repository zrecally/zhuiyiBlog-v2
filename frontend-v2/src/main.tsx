import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import '@hanzi.pro/webfonts-lxgw-wenkai/swap/400.css'
import './index.css'
import './i18n'
import { isApiUrl, isStaticSite } from './lib/siteMode'

// 全局拦截 fetch 请求，统一处理登录过期和封禁提示。
// 不在浏览器中保存任何共享密钥；浏览器包中的“秘密”对访客始终可见。
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let url = '';
  if (typeof args[0] === 'string') {
    url = args[0];
  } else if (args[0] instanceof Request) {
    url = args[0].url;
  } else if (args[0] instanceof URL) {
    url = args[0].toString();
  }

  // 北京静态站永不把遗漏的 /api 交互请求发往任何后端。这是路由和组件级
  // 静态模式判断之外的最后一道保护，避免以后新增组件时意外回源。
  if (isStaticSite && isApiUrl(url)) {
    return new Response(JSON.stringify({
      success: false,
      message: '该功能在静态站不可用',
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const response = await originalFetch(...args);

  // 如果是我们的 API 返回了 401，且本地还有 token，则触发过期退出逻辑
  // 修复 H7: 排除 admin/login 登录接口，因为 TOTP 第二步验证也会返回 401，不能把它当成会话过期直接踢下线
  if (response.status === 401 && url.includes('/api/') && !url.includes('/admin/login')) {
    const hasToken = localStorage.getItem('user_token');
    if (hasToken) {
      localStorage.removeItem('user_token');
      window.dispatchEvent(new Event('logout'));
      window.dispatchEvent(new CustomEvent('token-expired'));
    }
  }

  // 拦截全局 IP 封禁 (403)
  if (response.status === 403 && url.includes('/api/')) {
    try {
      // 检查是否已经在 banned 页面，如果是，则不重复抛出封禁事件，避免死循环请求
      if (window.location.pathname.startsWith('/banned')) {
        return response;
      }
      // 克隆 response 读取 body 以免消费原有的 stream
      const clonedRes = response.clone();
      const data = await clonedRes.json();
      if (data && data.error_code === 'IP_BANNED') {
        window.dispatchEvent(new CustomEvent('ip-banned', { detail: data.message }));
      }
    } catch (e) {
      // 忽略非 JSON 响应
    }
  }

  return response;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </HelmetProvider>
  </React.StrictMode>,
)
