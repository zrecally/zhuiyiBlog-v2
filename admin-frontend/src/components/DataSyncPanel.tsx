import { useState, useRef, useEffect } from 'react';
import { useToast } from './Toast';
import { adminApi } from './admin/adminApi';

export const DataSyncPanel = () => {
  const { showToast } = useToast();
  const [logs, setLogs] = useState<{ time: string; text: string; type: 'info' | 'error' | 'success' }[]>([]);
  const [loadingModules, setLoadingModules] = useState<Record<string, boolean>>({});
  const logContainerRef = useRef<HTMLDivElement>(null);

  const modules = [
    { key: 'users', label: '飞书用户同步', desc: '从飞书拉取最新的用户列表与部门信息，清理重复记录。' },
    { key: 'projects', label: '项目集同步', desc: '从飞书项目集读取已发布项目，并刷新动态站项目缓存。' },
    { key: 'posts', label: '飞书文章数据同步', desc: '全量同步或更新飞书文档至本地数据库。' },
    { key: 'comments', label: '评论数据同步', desc: '后台异步同步评论数据。' },
    { key: 'albums', label: '飞书相册同步', desc: '同步公开相册照片，处理图片并更新北京静态站快照。' },
    { key: 'friends', label: '友链同步', desc: '同步已通过的飞书友链，并更新北京静态站快照。' },
    { key: 'config', label: '系统配置与国际化同步', desc: '从飞书配置表同步基础配置与 i18n 数据。' },
    { key: 'blacklist', label: '黑名单同步', desc: '同步飞书的访问控制黑名单表。' },
    { key: 'article-access', label: '文章密码同步', desc: '导入并加密一次性文章密码，更新核销与撤销状态。' },
  ];

  const addLog = (text: string, type: 'info' | 'error' | 'success' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { time, text, type }]);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleSync = async (module: string, label: string) => {
    if (loadingModules[module]) return;

    setLoadingModules((prev) => ({ ...prev, [module]: true }));
    addLog(`[${label}] 发起飞书同步请求...`, 'info');

    try {
      const data = await adminApi.syncModule(module);

      if (data.success) {
        addLog(`[${label}] 同步成功: ${data.message || '操作完成'}`, 'success');
        showToast({ message: `${label}同步成功：${data.message || '操作完成'}`, type: 'success' });
      } else {
        addLog(`[${label}] 同步失败: ${data.message || '未知错误'}`, 'error');
        showToast({ message: `${label}同步失败：${data.message || '未知错误'}`, type: 'error' });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误';
      addLog(`[${label}] 网络或服务异常: ${message}`, 'error');
      showToast({ message: `${label}同步失败：${message}`, type: 'error' });
    } finally {
      setLoadingModules((prev) => ({ ...prev, [module]: false }));
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-left-2 duration-500">
      <div className="text-xianxia-text font-song tracking-widest text-sm font-bold border-b border-xianxia-border/30 pb-2">
        分业务数据同步 (飞书 -&gt; 博客)
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((mod) => (
          <div key={mod.key} className="p-4 border border-xianxia-border/40 bg-xianxia-bg/50 flex flex-col justify-between gap-4 hover:border-xianxia-jade/50 transition-colors">
            <div>
              <h3 className="text-[13px] font-song font-bold text-xianxia-text tracking-widest mb-1">{mod.label}</h3>
              <p className="text-[11px] text-xianxia-text/50 font-song">{mod.desc}</p>
            </div>
            <button
              onClick={() => handleSync(mod.key, mod.label)}
              disabled={loadingModules[mod.key]}
              className="w-full py-2 bg-xianxia-border/10 border border-xianxia-border/50 text-xianxia-text hover:bg-xianxia-jade hover:text-xianxia-bg hover:border-xianxia-jade transition-colors text-[11px] tracking-widest rounded-sm whitespace-nowrap font-song disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loadingModules[mod.key] && (
                <svg className="animate-spin h-3 w-3 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              执行同步
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 border border-xianxia-border/60 bg-xianxia-bg/40 p-4 font-mono text-[10px] sm:text-xs shadow-inner">
        <div className="flex items-center justify-between mb-3 border-b border-xianxia-border/30 pb-2">
          <span className="text-xianxia-text font-bold tracking-widest font-song">同步执行日志</span>
          <span className="px-2 py-0.5 border text-[10px] border-xianxia-jade/50 text-xianxia-jade">
            TERMINAL
          </span>
        </div>
        <div
          ref={logContainerRef}
          className="h-48 overflow-y-auto space-y-1 text-xianxia-text/80 custom-scrollbar-thin flex flex-col-reverse"
        >
          <div className="flex flex-col space-y-1">
            {logs.length === 0 ? (
              <span className="text-xianxia-text/40 italic">等待任务执行...</span>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`flex items-start gap-2 break-all ${
                  log.type === 'error' ? 'text-xianxia-red' :
                  log.type === 'success' ? 'text-xianxia-jade' :
                  'text-xianxia-text/80'
                }`}>
                  <span className="opacity-50 shrink-0">[{log.time}]</span>
                  <span className="flex-1 leading-relaxed">{log.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
