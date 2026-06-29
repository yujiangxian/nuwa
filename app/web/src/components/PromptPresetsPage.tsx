import { useState } from 'react';
import { useUIStore, type PromptPreset } from '@/store/uiStore';
import { validatePreset, TITLE_MAX_LENGTH, CONTENT_MAX_LENGTH } from '@/lib/promptPreset';
import { ArrowLeft, Settings, Plus, MessageSquareText, Pencil, Trash2, Check, X, AlertTriangle } from 'lucide-react';

interface PresetForm {
  title: string;
  content: string;
}

const EMPTY_FORM: PresetForm = { title: '', content: '' };

type FormMode = { kind: 'create' } | { kind: 'edit'; id: string } | null;

export default function PromptPresetsPage() {
  const setPage = useUIStore((s) => s.setPage);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const presets = useUIStore((s) => s.presets);
  const presetsPersistent = useUIStore((s) => s.presetsPersistent);
  const createPreset = useUIStore((s) => s.createPreset);
  const updatePreset = useUIStore((s) => s.updatePreset);
  const deletePreset = useUIStore((s) => s.deletePreset);

  const [formMode, setFormMode] = useState<FormMode>(null);
  const [form, setForm] = useState<PresetForm>(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormMode({ kind: 'create' });
  };

  const openEdit = (p: PromptPreset) => {
    setForm({ title: p.title, content: p.content });
    setFormMode({ kind: 'edit', id: p.id });
  };

  const closeForm = () => {
    setFormMode(null);
    setForm(EMPTY_FORM);
  };

  // 提交前用 validatePreset：任一字段 trim 后为空时分别提示并禁用提交。
  const validation = validatePreset(form.title, form.content);
  const titleEmpty = form.title.trim().length === 0;
  const contentEmpty = form.content.trim().length === 0;

  const handleSubmit = async () => {
    // 校验未通过时不创建/编辑（提交按钮已禁用，此处为防御性保护）。
    if (!validation.ok) {
      return;
    }
    if (formMode?.kind === 'create') {
      await createPreset(form.title, form.content);
    } else if (formMode?.kind === 'edit') {
      await updatePreset(formMode.id, form.title, form.content);
    }
    closeForm();
  };

  const handleConfirmDelete = async (id: string) => {
    await deletePreset(id);
    setConfirmDeleteId(null);
  };

  return (
    <div className="flex flex-col h-full relative" style={{ zIndex: 10 }}>
      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPage('home')}
            aria-label="返回首页"
            className="flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-dim))', boxShadow: '0 0 16px var(--primary-glow)' }}>
              <MessageSquareText size={16} style={{ color: 'var(--bg)' }} />
            </div>
            <span className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>提示词预设</span>
          </div>
        </div>
        <button
          aria-label="设置"
          className="flex items-center justify-center"
          style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
          onClick={() => setSettingsOpen(true)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
        >
          <Settings size={22} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto">
          {/* 降级提示：处于 Memory_Fallback_Mode 时显示非阻断提示条 */}
          {!presetsPersistent && (
            <div
              role="status"
              className="flex items-center gap-2 mb-4 px-3 py-2 rounded-xl text-xs"
              style={{ color: '#F4A261', background: 'rgba(244,162,97,0.08)', border: '1px solid rgba(244,162,97,0.2)' }}
            >
              <AlertTriangle size={14} /> 预设无法保存
            </div>
          )}

          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>我的预设</h2>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all"
              style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.08)', border: '1px solid rgba(72,202,228,0.15)' }}
            >
              <Plus size={16} />
              新建预设
            </button>
          </div>

          {/* 空状态 */}
          {presets.length === 0 ? (
            <div
              className="glass rounded-2xl px-6 py-12 flex flex-col items-center justify-center text-center"
              style={{ border: '1px solid var(--border)' }}
            >
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'rgba(72,202,228,0.08)' }}>
                <MessageSquareText size={22} style={{ color: 'var(--primary)' }} />
              </div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>还没有预设，点击新建一条</p>
            </div>
          ) : (
            // 按 presets 顺序渲染每条的 title 与 content
            <div className="space-y-3">
              {presets.map((p) => {
                const confirming = confirmDeleteId === p.id;
                return (
                  <div key={p.id} className="glass rounded-2xl p-4 glow-edge transition-all" style={{ border: '1px solid var(--border)' }}>
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{p.title}</h3>
                        <p className="text-xs mt-1 whitespace-pre-wrap break-words" style={{ color: 'var(--text-secondary)' }}>{p.content}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          aria-label={`编辑${p.title}`}
                          className="flex items-center justify-center cursor-pointer"
                          style={{ width: 32, height: 32, borderRadius: 8, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}
                          onClick={() => openEdit(p)}
                        >
                          <Pencil size={15} />
                        </button>

                        {confirming ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>确认删除?</span>
                            <button
                              aria-label="确认删除"
                              className="flex items-center justify-center cursor-pointer"
                              style={{ width: 30, height: 30, borderRadius: 8, color: '#FF6B6B', background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.2)' }}
                              onClick={() => handleConfirmDelete(p.id)}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              aria-label="取消删除"
                              className="flex items-center justify-center cursor-pointer"
                              style={{ width: 30, height: 30, borderRadius: 8, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button
                            aria-label={`删除${p.title}`}
                            title="删除预设"
                            className="flex items-center justify-center cursor-pointer"
                            style={{ width: 32, height: 32, borderRadius: 8, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}
                            onClick={() => setConfirmDeleteId(p.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 新建 / 编辑表单（覆盖层） */}
      {formMode && (
        <div
          className="absolute inset-0 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.5)', zIndex: 50 }}
          role="dialog"
          aria-label={formMode.kind === 'create' ? '新建预设' : '编辑预设'}
        >
          <div className="glass glow-edge rounded-2xl p-6 w-full max-w-lg" style={{ border: '1px solid var(--border)', maxHeight: '90%', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {formMode.kind === 'create' ? '新建预设' : '编辑预设'}
              </h3>
              <button
                aria-label="关闭"
                onClick={closeForm}
                className="flex items-center justify-center cursor-pointer"
                style={{ width: 30, height: 30, borderRadius: 8, color: 'var(--text-secondary)', background: 'transparent', border: 'none' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {/* 标题 */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>标题</label>
                <input
                  aria-label="预设标题"
                  type="text"
                  value={form.title}
                  maxLength={TITLE_MAX_LENGTH}
                  placeholder="请输入预设标题"
                  onChange={(e) => { setForm((f) => ({ ...f, title: e.target.value })); }}
                  className="w-full outline-none rounded-xl px-3 py-2 text-sm"
                  style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
                {titleEmpty && (
                  <p className="text-xs mt-1" style={{ color: '#FF6B6B' }}>请填写标题</p>
                )}
              </div>

              {/* 内容 */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>内容</label>
                <textarea
                  aria-label="预设内容"
                  value={form.content}
                  maxLength={CONTENT_MAX_LENGTH}
                  placeholder="请输入待插入对话输入框的提示词正文"
                  onChange={(e) => { setForm((f) => ({ ...f, content: e.target.value })); }}
                  className="w-full outline-none resize-none rounded-xl px-3 py-2 text-sm"
                  style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', minHeight: 120 }}
                />
                {contentEmpty && (
                  <p className="text-xs mt-1" style={{ color: '#FF6B6B' }}>请填写内容</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                onClick={closeForm}
                className="px-4 py-2 rounded-xl text-sm cursor-pointer"
                style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!validation.ok}
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{ color: 'var(--bg)', background: 'linear-gradient(135deg, var(--primary), var(--primary-dim))', border: 'none', boxShadow: '0 0 16px var(--primary-glow)', cursor: validation.ok ? 'pointer' : 'not-allowed', opacity: validation.ok ? 1 : 0.5 }}
              >
                {formMode.kind === 'create' ? '创建' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
