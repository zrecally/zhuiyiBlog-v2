import React from 'react';

// 后端不可用时的页面级错误提示（替代过去"假装一切正常"的模拟文章）
export const LoadErrorPage: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <h1 className="text-5xl font-serif text-xianxia-red dark:text-[#C83C23] mb-4">内容暂时无法加载</h1>
      <p className="text-lg font-kai text-xianxia-text dark:text-gray-300 mb-8">
        服务似乎打了个盹，请稍后刷新重试。
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-6 py-2 border border-xianxia-red text-xianxia-red hover:bg-xianxia-red hover:text-white transition-colors duration-300 font-serif"
      >
        重新加载
      </button>
    </div>
  );
};
