import React from 'react';
import { useTranslation } from 'react-i18next';

export const NotFoundPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <h1 className="text-6xl font-serif text-xianxia-red dark:text-[#C83C23] mb-4">404</h1>
      <p className="text-xl font-kai text-xianxia-text dark:text-gray-300 mb-8">
        {t('此间无路，请君折返')}
      </p>
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('navigate', { detail: '/' }));
        }}
        className="px-6 py-2 border border-xianxia-red text-xianxia-red hover:bg-xianxia-red hover:text-white transition-colors duration-300 font-serif"
      >
        {t('返回首页')}
      </a>
    </div>
  );
};
