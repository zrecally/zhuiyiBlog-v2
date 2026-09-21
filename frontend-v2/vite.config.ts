import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const cardRedeemEnabled = (process.env.VITE_CARD_REDEEM_ENABLED ?? fileEnv.VITE_CARD_REDEEM_ENABLED) === 'true'
  const staticComplianceEnabled = (process.env.VITE_SITE_MODE ?? fileEnv.VITE_SITE_MODE) === 'static'

  return {
    plugins: [react()],
    define: {
      __CARD_REDEEM_BUILD__: JSON.stringify(cardRedeemEnabled),
      __STATIC_COMPLIANCE_BUILD__: JSON.stringify(staticComplianceEnabled),
    },
    resolve: {
      // 默认构建不解析发卡模块，避免尚未上线的闭环代码进入线上静态资产。
      alias: cardRedeemEnabled
        ? []
        : [{ find: './pages/CardRedeemPage', replacement: fileURLToPath(new URL('./src/pages/CardRedeemDisabled.tsx', import.meta.url)) }],
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true
        }
      }
    }
  }
})
