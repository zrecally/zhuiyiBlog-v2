import { useEffect, useState } from 'react';
import { useToast } from '../Toast';
import { adminApi } from './adminApi';
import { ProductPollDefinition, ProductPollOptionDefinition } from './adminTypes';

const inputClass = 'w-full px-3 py-2 bg-xianxia-bg/55 border border-xianxia-border/70 focus:outline-none focus:border-xianxia-jade text-xs text-xianxia-text font-song tracking-wide';

export const PollManagementPanel = () => {
  const { showToast } = useToast();
  const [definition, setDefinition] = useState<ProductPollDefinition | null>(null);
  const [totalVotes, setTotalVotes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await adminApi.getProductPoll();
      if (!result.success || !result.data) throw new Error(result.message || '读取投票配置失败');
      setDefinition(result.data.definition);
      setTotalVotes(result.data.results.totalVotes);
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : '读取投票配置失败', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateCategory = (categoryIndex: number, patch: { title?: string; description?: string }) => {
    setDefinition(current => current ? {
      ...current,
      categories: current.categories.map((category, index) => (
        index === categoryIndex ? { ...category, ...patch } : category
      )),
    } : current);
  };

  const updateOption = (categoryIndex: number, optionIndex: number, patch: Partial<ProductPollOptionDefinition>) => {
    setDefinition(current => current ? {
      ...current,
      categories: current.categories.map((category, index) => (
        index === categoryIndex
          ? {
            ...category,
            options: category.options.map((option, currentOptionIndex) => (
              currentOptionIndex === optionIndex ? { ...option, ...patch } : option
            )),
          }
          : category
      )),
    } : current);
  };

  const save = async () => {
    if (!definition) return;
    setSaving(true);
    try {
      const result = await adminApi.updateProductPoll(definition);
      if (!result.success || !result.data) throw new Error(result.message || '保存失败');
      setDefinition(result.data.definition);
      showToast({ message: result.message || '投票配置已保存', type: 'success' });
    } catch (error) {
      showToast({ message: error instanceof Error ? error.message : '保存投票配置失败', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-14"><div className="w-6 h-6 border-2 border-xianxia-border border-t-xianxia-jade rounded-full animate-spin" /></div>;
  }

  if (!definition) {
    return <div className="py-12 text-center text-xs text-xianxia-text/50 font-song">无法读取投票配置</div>;
  }

  return (
    <div className="mt-4 space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar-thin relative">
      <div className="flex items-center justify-between border border-xianxia-border/60 bg-xianxia-bg/35 p-3">
        <div>
          <p className="text-xs font-song font-bold tracking-widest text-xianxia-text">投票状态</p>
          <p className="mt-1 text-[10px] font-song tracking-wider text-xianxia-text/50">当前累计 {totalVotes} 份有效投票</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={definition.enabled}
          onClick={() => setDefinition(current => current ? { ...current, enabled: !current.enabled } : current)}
          className={`relative w-12 h-6 rounded-full transition-colors ${definition.enabled ? 'bg-xianxia-jade' : 'bg-xianxia-border'}`}
        >
          <span className={`absolute left-1 top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${definition.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
      </div>

      <div className="space-y-3 border border-xianxia-border/60 p-3">
        <label className="block text-[10px] font-song tracking-widest text-xianxia-text/55">
          页面标题
          <input
            value={definition.title}
            maxLength={80}
            onChange={(event) => setDefinition(current => current ? { ...current, title: event.target.value } : current)}
            className={`${inputClass} mt-1.5`}
          />
        </label>
        <label className="block text-[10px] font-song tracking-widest text-xianxia-text/55">
          页面说明
          <textarea
            value={definition.description}
            maxLength={300}
            rows={3}
            onChange={(event) => setDefinition(current => current ? { ...current, description: event.target.value } : current)}
            className={`${inputClass} mt-1.5 resize-y leading-5`}
          />
        </label>
      </div>

      {definition.categories.map((category, categoryIndex) => (
        <section key={category.id} className="space-y-3 border border-xianxia-border/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-xianxia-text/35">{category.id}</span>
            <span className="text-[10px] font-song text-xianxia-text/45">内部标识不可修改</span>
          </div>
          <input
            aria-label={`${category.id} 分类标题`}
            value={category.title}
            maxLength={80}
            onChange={(event) => updateCategory(categoryIndex, { title: event.target.value })}
            className={inputClass}
          />
          <textarea
            aria-label={`${category.id} 分类说明`}
            value={category.description}
            maxLength={200}
            rows={2}
            onChange={(event) => updateCategory(categoryIndex, { description: event.target.value })}
            className={`${inputClass} resize-y leading-5`}
          />

          <div className="space-y-2">
            {category.options.map((option, optionIndex) => (
              <div key={option.id} className="space-y-2 bg-xianxia-bg/40 border-l-2 border-xianxia-jade/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-mono text-xianxia-text/35">{option.id}</span>
                  {option.preview && (
                    <label className="inline-flex items-center gap-2 text-[10px] font-song text-xianxia-text/55 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={option.previewEnabled}
                        onChange={(event) => updateOption(categoryIndex, optionIndex, { previewEnabled: event.target.checked })}
                        className="accent-xianxia-jade"
                      />
                      开放功能预览
                    </label>
                  )}
                </div>
                <input
                  aria-label={`${option.id} 选项标题`}
                  value={option.title}
                  maxLength={60}
                  onChange={(event) => updateOption(categoryIndex, optionIndex, { title: event.target.value })}
                  className={inputClass}
                />
                <textarea
                  aria-label={`${option.id} 选项说明`}
                  value={option.description}
                  maxLength={240}
                  rows={2}
                  onChange={(event) => updateOption(categoryIndex, optionIndex, { description: event.target.value })}
                  className={`${inputClass} resize-y leading-5`}
                />
                {option.preview && (
                  <label className="block text-[10px] font-song tracking-widest text-xianxia-text/55">
                    外部静态预览地址
                    <input
                      aria-label={`${option.id} 外部静态预览地址`}
                      type="url"
                      value={option.previewUrl || ''}
                      maxLength={2048}
                      placeholder="https://preview.hizhuiyi.cn/feature/"
                      onChange={(event) => updateOption(categoryIndex, optionIndex, { previewUrl: event.target.value })}
                      className={`${inputClass} mt-1.5 font-mono tracking-normal`}
                    />
                    <span className="mt-1 block normal-case tracking-normal leading-4 text-xianxia-text/40">
                      留空使用内置演示；仅允许服务器白名单中的 HTTPS 预览站地址。
                    </span>
                  </label>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 pt-3 pb-1 bg-xianxia-bg/95 z-10">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="w-full py-3 bg-xianxia-text text-xianxia-bg hover:bg-xianxia-red disabled:opacity-50 transition-colors text-xs font-song tracking-[0.2em]"
        >
          {saving ? '保存中...' : '保存投票配置'}
        </button>
      </div>
    </div>
  );
};
