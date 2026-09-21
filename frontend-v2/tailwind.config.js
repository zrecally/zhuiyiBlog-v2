/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        xianxia: {
          bg: '#F9F6F0', // 素纸
          text: '#2A2A2A', // 墨色
          red: '#C83C23', // 朱砂
          redHover: '#A8321D', // 暗朱砂
          jade: '#A3C6B1', // 玉色
          jadeDark: '#7CA38D', // 暗玉色
          border: '#E2DDCF', // 纸色边框
          card: '#F2EFE8', // 略深的纸色卡片
        }
      },
      fontFamily: {
        sans: ['var(--zhuiyi-site-font, "LXGW WenKai")', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        // 定义标准的宋体序列 (STSong, SimSun 等)
        song: ['var(--zhuiyi-site-font, "LXGW WenKai")', '"Noto Serif SC"', '"Source Han Serif SC"', 'STSong', '"SimSun"', 'serif'],
        // 定义标准的楷体序列 (Kaiti SC, STKaiti 等)
        kai: ['var(--zhuiyi-site-font, "LXGW WenKai")', '"Kaiti SC"', '"STKaiti"', '"KaiTi"', '"楷体"', 'serif'],
        xingkai: ['var(--zhuiyi-site-font, "LXGW WenKai")', '"STXingkai"', '"Xingkai SC"', '"HuaWenXingKai"', '"FZXingKai-Z04S"', 'serif'],
        serif: ['var(--zhuiyi-site-font, "LXGW WenKai")', '"Noto Serif SC"', '"Source Han Serif SC"', 'STSong', '"SimSun"', 'serif'],
      },
      keyframes: {
        'ink-bloom': {
          '0%': { transform: 'scale(0.1) translateZ(0)', opacity: '0.85' },
          '100%': { transform: 'scale(1.2) translateZ(0)', opacity: '0' },
        },
        'cloud-1': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(5%, 10%) scale(1.1)' },
          '66%': { transform: 'translate(-5%, 5%) scale(0.9)' },
        },
        'cloud-2': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(-10%, 8%) scale(1.15)' },
          '66%': { transform: 'translate(8%, -5%) scale(0.85)' },
        },
        'cloud-3': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(5%, 5%) scale(1.05)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'spin-slow-reverse': {
          '0%': { transform: 'rotate(360deg)' },
          '100%': { transform: 'rotate(0deg)' },
        }
      },
      animation: {
        'ink-bloom': 'ink-bloom 1.2s cubic-bezier(0.1, 0.8, 0.3, 1) forwards',
        'cloud-1': 'cloud-1 25s ease-in-out infinite',
        'cloud-2': 'cloud-2 30s ease-in-out infinite',
        'cloud-3': 'cloud-3 35s ease-in-out infinite',
        'spin-slow': 'spin-slow 120s linear infinite',
        'spin-slow-reverse': 'spin-slow-reverse 180s linear infinite',
      },
      typography: {
        DEFAULT: {
          css: {
            a: {
              textDecoration: 'none',
              '&:hover': {
                textDecoration: 'underline',
                textDecorationStyle: 'dashed',
                textUnderlineOffset: '4px',
              },
            },
            code: {
              fontWeight: '500',
              backgroundColor: 'rgba(150, 150, 150, 0.15)',
              padding: '0.2em 0.4em',
              borderRadius: '0.25rem',
              color: '#C83C23',
              '&::before': { content: '""' },
              '&::after': { content: '""' },
            },
            'pre code': {
              backgroundColor: 'transparent',
              padding: '0',
              color: 'inherit',
              borderRadius: '0',
            },
            'pre': {
              backgroundColor: 'transparent',
              padding: '0',
              marginTop: '1em',
              marginBottom: '1em',
            },
            strong: {
              color: 'inherit',
              fontWeight: '700',
            },
            em: {
              color: 'inherit',
            },
            del: {
              color: 'inherit',
            },
            h3: {
              fontWeight: '700',
            },
            h4: {
              fontWeight: '700',
            },
            table: {
              width: '100%',
              tableLayout: 'auto',
              textAlign: 'left',
              marginTop: '0',
              marginBottom: '0',
              lineHeight: '1.5',
            },
            'thead th': {
              borderBottomWidth: '2px',
              borderBottomColor: '#A3C6B1',
              padding: '0.75em 1em',
              whiteSpace: 'nowrap',
            },
            'tbody td': {
              borderBottomWidth: '1px',
              borderBottomColor: '#E2DDCF',
              padding: '0.75em 1em',
              minWidth: '120px',
            },
            'tbody tr:last-child td': {
              borderBottomWidth: '0',
            },
            blockquote: {
              fontStyle: 'normal',
              borderLeftWidth: '4px',
              borderLeftColor: '#A3C6B1',
              backgroundColor: 'rgba(163, 198, 177, 0.05)',
              padding: '0.5rem 1rem',
              borderRadius: '0 0.5rem 0.5rem 0',
              marginTop: '1.5em',
              marginBottom: '1.5em',
              color: '#4A4A4A',
              '& p': {
                marginTop: '0',
                marginBottom: '0',
              },
              '& blockquote': {
                marginTop: '1em',
                marginBottom: '1em',
                borderLeftColor: '#C83C23',
                backgroundColor: 'rgba(200, 60, 35, 0.05)',
              }
            }
          },
        }
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
