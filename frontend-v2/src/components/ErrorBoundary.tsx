import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
}

// 全局兜底：任一组件渲染时抛出异常时展示错误页，避免整站白屏
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[ErrorBoundary] 未捕获的渲染异常:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 text-center">
          <h1 className="text-4xl font-serif text-xianxia-red dark:text-[#C83C23] mb-4">页面出错了</h1>
          <p className="text-lg font-kai text-xianxia-text dark:text-gray-300 mb-8">
            山间起雾了，稍候片刻再试试吧。
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 border border-xianxia-red text-xianxia-red hover:bg-xianxia-red hover:text-white transition-colors duration-300 font-serif"
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
