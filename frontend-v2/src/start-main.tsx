import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { StartPage } from './pages/StartPage';
import '@hanzi.pro/webfonts-lxgw-wenkai/swap/400.css';
import './index.css';

// Standalone entry: no blog App, CMS, authentication, API interceptors or i18n sync.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HelmetProvider>
      <StartPage blogHref="https://cn.hizhuiyi.cn/" />
    </HelmetProvider>
  </React.StrictMode>,
);
