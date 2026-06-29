import { useState } from 'react';
import { useUIStore, type Character, type CharacterInput } from '@/store/uiStore';
import { useVoices } from '@/hooks/useApi';
import { validateName, NAME_MAX_LENGTH } from '@/lib/character';
import { ArrowLeft, Settings, Plus, User, Pencil, Trash2, Check, X, Loader2, AlertCircle } from 'lucide-react';

/**
 * Gradient_Presets：供用户为角色选择 Avatar_Gradient 的预设渐变集合
 * （复用现有 defaultCharacters 的 avatar 风格）。
 */
const GRADIENT_PRESETS: string[] = [
  'linear-gradient(135deg, #48CAE4, #0096C7)',
  'linear-gradient(135deg, #FF6B9D, #D44D7A)',
  'linear-gradient(135deg, #52B788, #40916C)',
  'linear-gradient(135deg, #7B82E1, #5A60C0)',
  'linear-gradient(135deg, #D4AF37, #B8860B)',
  'linear-gradient(135deg, #F4A261, #E76F51)',
  'linear-gradient(135deg, #9B5DE5, #7B2CBF)',
  'linear-gradient(135deg, #00BBF9, #0077B6)',
];

const EMPTY_FORM: CharacterInput = {
  name: '',
  systemPrompt: '',
  description: '',
  avatar: GRADIENT_PRESETS[0],
  voiceId: '',
};

type FormMode = { kind: 'create' } | { kind: 'edit'; id: string } | null;

export default function CharactersPage() {
  const setPage = useUIStore((s) => s.setPage);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const characters = useUIStore((s) => s.characters);
  const createCharacter = useUIStore((s) => s.createCharacter);
  const updateCharacter = useUIStore((s) => s.updateCharacter);
  const deleteCharacter = useUIStore((s) => s.deleteCharacter);

  const voicesQuery = useVoices();
  const voices = voicesQuery.data ?? [];

  const [formMode, setFormMode] = useState<FormMode>(null);
  const [form, setForm] = useState<CharacterInput>(EMPTY_FORM);
  const [nameError, setNameError] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /** 经真实音色库解析 voiceId 的展示名；未命中显示占位。 */
  const voiceNameOf = (voiceId: string): string => {
    const v = voices.find((x) => x.id === voiceId);
    return v?.name ?? '默认音色';
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setNameError(false);
    setFormMode({ kind: 'create' });
  };

  const openEdit = (c: Character) => {
    setForm({
      name: c.name,
      systemPrompt: c.systemPrompt,
      description: c.description,
      avatar: c.avatar,
      voiceId: c.voiceId,
    });
    setNameError(false);
    setFormMode({ kind: 'edit', id: c.id });
  };

  const closeForm = () => {
    setFormMode(null);
    setForm(EMPTY_FORM);
    setNameError(false);
  };

  const handleSubmit = async () => {
    // 提交前用 validateName；不通过显示「请填写名称」且不创建/更新。
    if (!validateName(form.name).ok) {
      setNameError(true);
      return;
    }
    if (formMode?.kind === 'create') {
      await createCharacter(form);
    } else if (formMode?.kind === 'edit') {
      await updateCharacter(formMode.id, form);
    }
    closeForm();
  };

  const handleConfirmDelete = async (id: string) => {
    await deleteCharacter(id);
    setConfirmDeleteId(null);
  };

  const isOnly = characters.length <= 1;

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
              <User size={16} style={{ color: 'var(--bg)' }} />
            </div>
            <span className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>角色管理</span>
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
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>我的角色</h2>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all"
              style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.08)', border: '1px solid rgba(72,202,228,0.15)' }}
            >
              <Plus size={16} />
              新建角色
            </button>
          </div>

          {/* 音色加载态 / 错误态：错误时仍渲染角色其余信息。 */}
          {voicesQuery.isLoading && (
            <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={14} className="animate-spin" /> 音色加载中…
            </div>
          )}
          {!voicesQuery.isLoading && voicesQuery.isError && (
            <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: '#FF6B6B' }}>
              <AlertCircle size={14} /> 音色加载失败
            </div>
          )}

          {/* 角色列表 */}
          <div className="space-y-3">
            {characters.map((c) => {
              const confirming = confirmDeleteId === c.id;
              return (
                <div key={c.id} className="glass rounded-2xl p-4 glow-edge transition-all" style={{ border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: c.avatar }} data-testid={`avatar-${c.id}`}>
                      <User size={22} style={{ color: 'white' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</h3>
                      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{c.description}</p>
                      <span className="inline-block text-[11px] mt-1 px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(72,202,228,0.08)', color: 'var(--primary)' }}>
                        音色：{voiceNameOf(c.voiceId)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        aria-label={`编辑${c.name}`}
                        className="flex items-center justify-center cursor-pointer"
                        style={{ width: 32, height: 32, borderRadius: 8, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}
                        onClick={() => openEdit(c)}
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
                            onClick={() => handleConfirmDelete(c.id)}
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
                          aria-label={`删除${c.name}`}
                          title={isOnly ? '至少需保留一个角色' : '删除角色'}
                          disabled={isOnly}
                          className="flex items-center justify-center"
                          style={{ width: 32, height: 32, borderRadius: 8, color: isOnly ? 'var(--text-muted)' : 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', cursor: isOnly ? 'not-allowed' : 'pointer', opacity: isOnly ? 0.5 : 1 }}
                          onClick={() => { if (!isOnly) setConfirmDeleteId(c.id); }}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                  {isOnly && confirmDeleteId !== c.id && (
                    <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>至少需保留一个角色</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 新建 / 编辑表单（覆盖层） */}
      {formMode && (
        <div
          className="absolute inset-0 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.5)', zIndex: 50 }}
          role="dialog"
          aria-label={formMode.kind === 'create' ? '新建角色' : '编辑角色'}
        >
          <div className="glass glow-edge rounded-2xl p-6 w-full max-w-lg" style={{ border: '1px solid var(--border)', maxHeight: '90%', overflowY: 'auto' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {formMode.kind === 'create' ? '新建角色' : '编辑角色'}
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
              {/* 名称 */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>名称</label>
                <input
                  aria-label="角色名称"
                  type="text"
                  value={form.name}
                  maxLength={NAME_MAX_LENGTH}
                  placeholder="请输入角色名称"
                  onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); if (nameError) setNameError(false); }}
                  className="w-full outline-none rounded-xl px-3 py-2 text-sm"
                  style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
                {nameError && (
                  <p className="text-xs mt-1" style={{ color: '#FF6B6B' }}>请填写名称</p>
                )}
              </div>

              {/* 人设提示词 */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>人设提示词</label>
                <textarea
                  aria-label="人设提示词"
                  value={form.systemPrompt}
                  placeholder="描述这个角色的人设与说话方式"
                  onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                  className="w-full outline-none resize-none rounded-xl px-3 py-2 text-sm"
                  style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', minHeight: 80 }}
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>描述</label>
                <input
                  aria-label="角色描述"
                  type="text"
                  value={form.description}
                  placeholder="一句话简介"
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full outline-none rounded-xl px-3 py-2 text-sm"
                  style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                />
              </div>

              {/* 头像渐变 */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>头像</label>
                <div className="grid grid-cols-8 gap-2">
                  {GRADIENT_PRESETS.map((g) => {
                    const active = form.avatar === g;
                    return (
                      <button
                        key={g}
                        type="button"
                        aria-label={`选择头像渐变${active ? '（已选）' : ''}`}
                        onClick={() => setForm((f) => ({ ...f, avatar: g }))}
                        className="rounded-lg cursor-pointer"
                        style={{ height: 32, background: g, border: active ? '2px solid var(--primary)' : '2px solid transparent', boxShadow: active ? '0 0 8px var(--primary-glow)' : 'none' }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* 绑定音色 */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>绑定音色</label>
                <select
                  aria-label="绑定音色"
                  value={form.voiceId}
                  onChange={(e) => setForm((f) => ({ ...f, voiceId: e.target.value }))}
                  className="w-full outline-none rounded-xl px-3 py-2 text-sm"
                  style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                >
                  <option value="">不绑定（使用默认参考音）</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
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
                className="px-4 py-2 rounded-xl text-sm font-medium cursor-pointer"
                style={{ color: 'var(--bg)', background: 'linear-gradient(135deg, var(--primary), var(--primary-dim))', border: 'none', boxShadow: '0 0 16px var(--primary-glow)' }}
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
