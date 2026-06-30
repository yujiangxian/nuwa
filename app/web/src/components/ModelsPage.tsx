import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useToastStore } from '@/store/toastStore';
import { apiClient } from '@/api/client';
import { useConfig, useSetModel } from '@/hooks/useApi';
import {
  sortInstalled,
  sortPresets,
  type InstalledSortBy,
  type PresetSortBy,
} from '@/lib/modelSort';
import { filterInstalledByType, filterPresets } from '@/lib/modelFilter';
import { parseActiveModelMap } from '@/lib/activeModel';
import { countActiveTasks } from '@/lib/downloadTask';
import { totalInstalledSizeMb } from '@/lib/systemResource';
import { formatBytes } from '@/lib/modelFormat';
import { typeConfig } from '@/lib/modelTypeConfig';
import DiskBar from './models/DiskBar';
import GpuBar from './models/GpuBar';
import StatsBar from './models/StatsBar';
import PresetCard from './models/PresetCard';
import ActiveModelBanner from './models/ActiveModelBanner';
import ModelCard from './models/ModelCard';
import ModelNotesEditor from './models/ModelNotesEditor';
import DownloadTaskCard from './models/DownloadTaskCard';
import type {
  InstalledModel,
  PresetModel,
  DownloadTask,
  DiskInfo,
  GpuInfo,
  ModelType,
  ModelTypeFilter,
} from '@/lib/modelTypes';
import {
  ArrowLeft, RefreshCw, Box, Check,
  HardDrive, Download, Globe, X,
  FolderOpen, AlertTriangle, File,
  Search, SlidersHorizontal, ChevronDown, Layers,
} from 'lucide-react';

/** ModelsPage 内沿用的别名（等价于领域类型 InstalledModel）。 */
type ModelItem = InstalledModel;

interface RepoFile {
  path: string;
  size: number;
  size_text: string;
  is_lfs: boolean;
}

interface ModelFileInfo {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
}

// typeConfig / statusConfig 已提取至 @/lib/modelTypeConfig

// ===== Helpers =====
// formatSize / formatBytes 现由 @/lib/modelFormat 提供（行为逐位一致）。

// PresetCard extracted to components/models/PresetCard.tsx
// ModelNotesEditor / DownloadTaskCard 已提取至 components/models/
// DiskBar / GpuBar / StatsBar 已提取至 components/models/

// 当前模型选择字段经 @/lib/activeModel.parseActiveModelMap 从 useConfig 返回值解析。
// ModelConfigView 类型由 @/lib/modelTypes 提供。

export default function ModelsPage() {
  const setPage = useUIStore((s) => s.setPage);
  const addToast = useToastStore((s) => s.addToast);

  const [activeTab, setActiveTab] = useState<'my' | 'store' | 'downloads'>('my');

  // My Models
  const [models, setModels] = useState<ModelItem[]>([]);
  // 当前 ASR/TTS/LLM 等模型选择统一经 useConfig（GET /api/config）读取并回显，
  // 经 useSetModel（POST /api/config/set-model）提交；二者共享 ['config'] react-query 缓存，
  // 因此设置后回显会自动更新。
  const { data: configData, refetch: refetchConfig } = useConfig();
  const setModelMutation = useSetModel();
  // 从 config 解析各类型当前选中模型（优先 current_models map，兼容旧字段，排除空值）。
  const currentModels: Record<string, string> = parseActiveModelMap(configData);
  const [isScanning, setIsScanning] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [mySortBy, setMySortBy] = useState<InstalledSortBy>('recent');
  const [loadingMy, setLoadingMy] = useState(true);
  // 模型元数据（备注、标签、最近使用时间）
  const [modelMeta, setModelMeta] = useState<Record<string, { notes: string; tags: string[]; last_used?: number }>>({});

  // Store
  const [presets, setPresets] = useState<PresetModel[]>([]);
  const [loadingStore, setLoadingStore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<PresetSortBy>('installed');
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Downloads
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const prevTaskStatuses = useRef<Record<string, string>>({});

  // Batch download modal
  const [showFileModal, setShowFileModal] = useState(false);
  const [modalPreset, setModalPreset] = useState<PresetModel | null>(null);
  const [repoFiles, setRepoFiles] = useState<RepoFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [loadingFiles, setLoadingFiles] = useState(false);

  // Disk info
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);

  // GPU info
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModelItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Model detail modal
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailModel, setDetailModel] = useState<ModelItem | null>(null);
  const [modelFiles, setModelFiles] = useState<ModelFileInfo[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Store filtering & sorting
  const storeTypes = useMemo(() => [...new Set(presets.map((p) => p.model_type))], [presets]);

  const filteredPresets = useMemo(() => {
    return sortPresets(filterPresets(presets, searchQuery, storeFilter as ModelTypeFilter), sortBy);
  }, [presets, searchQuery, storeFilter, sortBy]);

  // Fetch my models
  const fetchModels = async () => {
    try {
      setLoadingMy(true);
      const [{ data: modelsData }, { data: cfg }] = await Promise.all([
        apiClient.get<ModelItem[]>('/api/models'),
        apiClient.get<{
          current_asr_model: string | null;
          current_tts_model: string | null;
          current_llm_model: string | null;
          current_models: Record<string, string>;
          model_meta: Record<string, { notes: string; tags: string[]; last_used?: number }>;
        }>('/api/config'),
      ]);
      setModels(modelsData);
      // 当前模型选择由 useConfig 统一读取回显；此处仅取模型元数据（备注/标签/最近使用）
      setModelMeta(cfg.model_meta || {});
    } catch {
      addToast({ message: '获取模型列表失败', type: 'error' });
    } finally {
      setLoadingMy(false);
    }
  };

  // Fetch presets
  const fetchPresets = async () => {
    try {
      setLoadingStore(true);
      const { data } = await apiClient.get<PresetModel[]>('/api/downloads/presets');
      setPresets(data);
    } catch {
      addToast({ message: '获取预设模型失败', type: 'error' });
    } finally {
      setLoadingStore(false);
    }
  };

  const handleRefreshPresets = async () => {
    try {
      await apiClient.post('/api/downloads/presets/refresh');
      await fetchPresets();
      addToast({ message: '仓库列表已刷新', type: 'success' });
    } catch {
      addToast({ message: '刷新仓库列表失败', type: 'error' });
    }
  };

  // Fetch downloads
  const fetchDownloads = useCallback(async () => {
    try {
      const { data } = await apiClient.get<DownloadTask[]>('/api/downloads');
      for (const task of data) {
        const prev = prevTaskStatuses.current[task.id];
        if (task.status === 'completed' && prev && prev !== 'completed') {
          const name = task.repo_id || task.dest.split('/').pop() || '文件';
          addToast({ message: `「${name}」下载完成，已自动扫描模型`, type: 'success' });
          fetchModels();
        }
      }
      prevTaskStatuses.current = Object.fromEntries(data.map((t) => [t.id, t.status]));
      setTasks(data);
    } catch {
      // silent
    }
  }, [addToast]);

  useEffect(() => {
    fetchModels();
    fetchPresets();
    fetchDownloads();
  }, []);

  // Poll download progress (global)
  useEffect(() => {
    const id = setInterval(fetchDownloads, 2000);
    return () => clearInterval(id);
  }, [fetchDownloads]);

  const handleScan = async () => {
    setIsScanning(true);
    try {
      await apiClient.post<ModelItem[]>('/api/models/scan');
      // 开始轮询扫描进度
      const pollScan = setInterval(async () => {
        try {
          const { data: progress } = await apiClient.get<{ scanning: boolean }>('/api/models/scan-progress');
          if (!progress.scanning) {
            clearInterval(pollScan);
            setIsScanning(false);
            await fetchModels();
            addToast({ message: '扫描完成', type: 'success' });
          }
        } catch {
          clearInterval(pollScan);
          setIsScanning(false);
        }
      }, 1000);
      // 30 秒超时保护
      setTimeout(() => {
        clearInterval(pollScan);
        setIsScanning(false);
      }, 30000);
    } catch {
      addToast({ message: '扫描模型目录失败', type: 'error' });
      setIsScanning(false);
    }
  };

  const handleSetCurrent = async (id: string, type?: string) => {
    try {
      const modelType = type || models.find((m) => m.id === id)?.model_type;
      if (!modelType) return;
      // 经 useSetModel 提交 { model_type, model_id }；onSuccess 会用返回的 AppConfig
      // 刷新 ['config'] 缓存，从而自动更新当前模型的高亮回显。
      await setModelMutation.mutateAsync({
        model_type: modelType as ModelType,
        model_id: id,
      });
      const modelName = models.find((m) => m.id === id)?.name || id;
      addToast({ message: `已切换为「${modelName}」`, type: 'success' });
    } catch {
      addToast({ message: '切换模型失败', type: 'error' });
    }
  };

  // ========== Disk info ==========
  const fetchDiskInfo = async () => {
    try {
      const { data } = await apiClient.get<DiskInfo>('/api/system/disk');
      setDiskInfo(data);
    } catch {
      // silent
    }
  };

  // ========== GPU info ==========
  const fetchGpuInfo = async () => {
    try {
      const { data } = await apiClient.get<GpuInfo | null>('/api/system/gpu');
      setGpuInfo(data);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    fetchDiskInfo();
    fetchGpuInfo();
  }, []);

  // ========== Delete model ==========
  const handleDeleteModel = (model: ModelItem) => {
    setDeleteTarget(model);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await apiClient.delete(`/api/models/${encodeURIComponent(deleteTarget.id)}`);
      addToast({ message: `「${deleteTarget.name}」已删除`, type: 'success' });
      setModels((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      // 若删除的是某类型的当前模型，刷新 config 缓存以更新回显（后端可能已清除该选择）
      refetchConfig();
      // Refresh disk info after delete
      fetchDiskInfo();
    } catch (err: any) {
      addToast({ message: `删除失败: ${err?.response?.data?.error || err.message}`, type: 'error' });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setDeleteTarget(null);
    }
  };

  // ========== Model detail ==========
  const openDetailModal = async (model: ModelItem) => {
    setDetailModel(model);
    setShowDetailModal(true);
    setLoadingDetail(true);
    setModelFiles([]);
    try {
      const [{ data: fileData }, { data: metaData }] = await Promise.all([
        apiClient.get<{ files: ModelFileInfo[] }>(`/api/models/${encodeURIComponent(model.id)}/files`),
        apiClient.get<{ notes: string; tags: string[]; last_used?: number }>(`/api/models/${encodeURIComponent(model.id)}/meta`),
      ]);
      setModelFiles(fileData.files);
      setModelMeta((prev) => ({ ...prev, [model.id]: metaData }));
    } catch {
      addToast({ message: '获取模型详情失败', type: 'error' });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSaveNotes = async (modelId: string, notes: string) => {
    try {
      const { data } = await apiClient.post<{ notes: string; tags: string[]; last_used?: number }>(
        `/api/models/${encodeURIComponent(modelId)}/meta`,
        { notes }
      );
      setModelMeta((prev) => ({ ...prev, [modelId]: data }));
      addToast({ message: '备注已保存', type: 'success' });
    } catch {
      addToast({ message: '保存备注失败', type: 'error' });
    }
  };

  // ========== Batch download modal ==========

  const openFileModal = async (preset: PresetModel) => {
    setModalPreset(preset);
    setShowFileModal(true);
    setLoadingFiles(true);
    setSelectedFiles(new Set());
    setRepoFiles([]);

    try {
      const { data } = await apiClient.get<RepoFile[]>(
        `/api/downloads/repo-files?repo_id=${encodeURIComponent(preset.repo_id)}&source=${preset.source}`
      );
      setRepoFiles(data);
      // 默认全选
      setSelectedFiles(new Set(data.map((f) => f.path)));
    } catch (err: any) {
      addToast({ message: `获取文件列表失败: ${err?.response?.data?.error || err.message}`, type: 'error' });
      setShowFileModal(false);
    } finally {
      setLoadingFiles(false);
    }
  };

  const toggleFile = (path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedFiles.size === repoFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(repoFiles.map((f) => f.path)));
    }
  };

  const handleConfirmBatchDownload = async () => {
    if (!modalPreset || selectedFiles.size === 0) return;

    try {
      await apiClient.post('/api/downloads/batch', {
        repo_id: modalPreset.repo_id,
        source: modalPreset.source,
        dest_dir: modalPreset.dest_dir,
        files: Array.from(selectedFiles),
      });
      addToast({ message: `开始批量下载 ${modalPreset.name} (${selectedFiles.size} 个文件)`, type: 'success' });
      setShowFileModal(false);
      setActiveTab('downloads');
    } catch (err: any) {
      addToast({ message: `启动下载失败: ${err?.response?.data?.error || err.message}`, type: 'error' });
    }
  };

  const selectedTotalSize = repoFiles
    .filter((f) => selectedFiles.has(f.path))
    .reduce((sum, f) => sum + f.size, 0);

  // ========== Download task handlers ==========

  const handleCancelDownload = async (taskId: string) => {
    try {
      await apiClient.post(`/api/downloads/${taskId}/cancel`);
      addToast({ message: '已取消下载', type: 'info' });
      fetchDownloads();
    } catch {
      addToast({ message: '取消下载失败', type: 'error' });
    }
  };

  const handleDeleteDownload = async (taskId: string) => {
    try {
      await apiClient.delete(`/api/downloads/${taskId}`);
      fetchDownloads();
    } catch {
      addToast({ message: '删除任务失败', type: 'error' });
    }
  };

  const handleRetryDownload = async (task: DownloadTask) => {
    try {
      if (task.status === 'partial_failed') {
        // 调用重试 API，只重试失败文件
        await apiClient.post(`/api/downloads/${task.id}/retry`);
        addToast({ message: '已重新启动失败文件下载', type: 'success' });
      } else if (task.mode === 'batch' && task.repo_id && task.dest_dir) {
        await apiClient.post('/api/downloads/batch', {
          repo_id: task.repo_id,
          source: task.source,
          dest_dir: task.dest_dir,
        });
        addToast({ message: '已重新启动下载', type: 'success' });
      } else {
        await apiClient.post('/api/downloads', { url: task.url, dest: task.dest });
        addToast({ message: '已重新启动下载', type: 'success' });
      }
      fetchDownloads();
    } catch (err: any) {
      addToast({ message: `重试下载失败: ${err?.response?.data?.error || err.message}`, type: 'error' });
    }
  };

  const typeCounts = models.reduce((acc, m) => {
    acc[m.model_type] = (acc[m.model_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filteredModels = useMemo(() => {
    return sortInstalled(
      filterInstalledByType(models, filter as ModelTypeFilter),
      mySortBy,
      modelMeta,
    );
  }, [models, filter, mySortBy, modelMeta]);

  return (
    <div className="flex flex-col h-full relative" style={{ zIndex: 10 }}>
      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setPage('home')} className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}>
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #D4AF37, #B8941F)', boxShadow: '0 0 16px rgba(212,175,55,0.3)' }}>
              <HardDrive size={16} style={{ color: 'var(--bg)' }} />
            </div>
            <span className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>模型管理</span>
          </div>
        </div>

        <div className="flex items-center gap-1 glass rounded-full px-1.5 py-1">
          {(['my', 'store', 'downloads'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className="transition-all"
              style={{
                padding: '7px 16px', borderRadius: 100, fontSize: 13, fontWeight: 500,
                whiteSpace: 'nowrap', border: 'none', cursor: 'pointer',
                background: activeTab === t ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: activeTab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {t === 'my' ? '我的模型' : t === 'store' ? '模型仓库' : '下载任务'}
              {t === 'downloads' && tasks.length > 0 && (
                <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--primary)', color: 'var(--bg)' }}>
                  {countActiveTasks(tasks)}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-4xl mx-auto">

          {/* ========== My Models ========== */}
          {activeTab === 'my' && (
            <>
              {/* Active models banner */}
              <ActiveModelBanner
                models={models}
                currentModels={currentModels}
              />

              {/* Disk space bar */}
              {!loadingMy && models.length > 0 && (
                <DiskBar diskInfo={diskInfo} modelsTotalSize={totalInstalledSizeMb(models)} />
              )}

              {/* GPU memory bar */}
              {!loadingMy && models.length > 0 && (
                <GpuBar gpuInfo={gpuInfo} />
              )}

              {/* Stats bar */}
              {!loadingMy && models.length > 0 && <StatsBar models={models} />}

              {/* Filter + Sort + Scan */}
              <div className="flex items-center justify-between mb-5 gap-3">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setFilter('all')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all"
                    style={{ background: filter === 'all' ? 'rgba(255,255,255,0.06)' : 'transparent', color: filter === 'all' ? 'var(--text-primary)' : 'var(--text-secondary)', border: `1px solid ${filter === 'all' ? 'rgba(255,255,255,0.10)' : 'var(--border)'}` }}>
                    <Box size={14} /> 全部 ({models.length})
                  </button>
                  {Object.entries(typeCounts).map(([type, count]) => {
                    const cfg = typeConfig[type] || typeConfig.other;
                    const Icon = cfg.icon;
                    return (
                      <button key={type} onClick={() => setFilter(type)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all"
                        style={{ background: filter === type ? cfg.bg : 'transparent', color: filter === type ? cfg.color : 'var(--text-secondary)', border: `1px solid ${filter === type ? cfg.color + '25' : 'var(--border)'}` }}>
                        <Icon size={14} /> {cfg.label} ({count})
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Sort dropdown */}
                  <select
                    value={mySortBy}
                    onChange={(e) => setMySortBy(e.target.value as any)}
                    className="text-xs px-2.5 py-1.5 rounded-lg cursor-pointer outline-none transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                  >
                    <option value="recent">最近使用</option>
                    <option value="name">名称 A-Z</option>
                    <option value="size_desc">大小: 大到小</option>
                    <option value="size_asc">大小: 小到大</option>
                  </select>
                  <button onClick={handleScan} disabled={isScanning}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all"
                    style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.06)', border: '1px solid rgba(72,202,228,0.12)', opacity: isScanning ? 0.6 : 1 }}>
                    <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
                    {isScanning ? '扫描中...' : '重新扫描'}
                  </button>
                </div>
              </div>

              {loadingMy ? (
                <div className="text-center py-16">
                  <div className="w-8 h-8 rounded-full border-2 border-t-transparent mx-auto mb-4" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>加载模型列表...</p>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--border)' }}>
                    <Box size={28} style={{ color: 'var(--text-muted)' }} />
                  </div>
                  <h3 className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>暂无模型</h3>
                  <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>models/ 目录下没有找到模型文件</p>
                  <button onClick={() => setActiveTab('store')}
                    className="flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all"
                    style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-dim))', color: 'var(--bg)', border: 'none', boxShadow: '0 0 20px var(--primary-glow)' }}>
                    <Download size={16} /> 去模型仓库下载
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredModels.map((model) => {
                    const isCurrent = currentModels[model.model_type] === model.id;
                    return (
                      <ModelCard
                        key={model.id}
                        model={model}
                        isCurrent={isCurrent}
                        notes={modelMeta[model.id]?.notes}
                        lastUsed={modelMeta[model.id]?.last_used}
                        onSetCurrent={handleSetCurrent}
                        onDelete={handleDeleteModel}
                        onViewDetail={openDetailModal}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ========== Store ========== */}
          {activeTab === 'store' && (
            <>
              {/* Toolbar */}
              <div className="flex flex-col gap-4 mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>模型仓库</h2>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      <Globe size={12} className="inline mr-1" />
                      来源: HuggingFace / ModelScope · 共 {presets.length} 个模型 · 已安装 {presets.filter((p) => p.is_downloaded).length} 个
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRefreshPresets}
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl cursor-pointer transition-all"
                      style={{ color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                    >
                      <RefreshCw size={13} /> 刷新
                    </button>
                    {/* Sort */}
                    <div className="relative">
                      <button
                        onClick={() => setShowSortMenu(!showSortMenu)}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl cursor-pointer transition-all"
                        style={{ color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}
                      >
                        <SlidersHorizontal size={13} />
                        {sortBy === 'installed' && '已安装优先'}
                        {sortBy === 'size_desc' && '大小 ↓'}
                        {sortBy === 'size_asc' && '大小 ↑'}
                        {sortBy === 'name' && '名称'}
                        <ChevronDown size={12} />
                      </button>
                      {showSortMenu && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
                          <div className="absolute right-0 top-full mt-1.5 z-50 glass rounded-xl overflow-hidden py-1" style={{ border: '1px solid var(--border)', minWidth: 140 }}>
                            {[
                              { key: 'installed', label: '已安装优先' },
                              { key: 'size_desc', label: '大小: 大到小' },
                              { key: 'size_asc', label: '大小: 小到大' },
                              { key: 'name', label: '名称 A-Z' },
                            ].map((opt) => (
                              <button
                                key={opt.key}
                                onClick={() => { setSortBy(opt.key as any); setShowSortMenu(false); }}
                                className="w-full text-left text-xs px-3 py-2 cursor-pointer transition-all"
                                style={{ color: sortBy === opt.key ? 'var(--primary)' : 'var(--text-secondary)', background: sortBy === opt.key ? 'rgba(72,202,228,0.08)' : 'transparent' }}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Search + Filter */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="搜索模型名称、描述..."
                      className="w-full text-sm rounded-xl pl-9 pr-4 py-2.5 outline-none transition-all"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                    />
                  </div>
                </div>

                {/* Category Pills */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setStoreFilter('all')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all"
                    style={{
                      background: storeFilter === 'all' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                      color: storeFilter === 'all' ? 'var(--text-primary)' : 'var(--text-muted)',
                      border: `1px solid ${storeFilter === 'all' ? 'rgba(255,255,255,0.10)' : 'var(--border)'}`,
                    }}
                  >
                    <Layers size={13} /> 全部 ({presets.length})
                  </button>
                  {storeTypes.map((type) => {
                    const cfg = typeConfig[type] || typeConfig.other;
                    const Icon = cfg.icon;
                    const count = presets.filter((p) => p.model_type === type).length;
                    return (
                      <button
                        key={type}
                        onClick={() => setStoreFilter(storeFilter === type ? 'all' : type)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all"
                        style={{
                          background: storeFilter === type ? cfg.bg : 'rgba(255,255,255,0.02)',
                          color: storeFilter === type ? cfg.color : 'var(--text-muted)',
                          border: `1px solid ${storeFilter === type ? cfg.color + '25' : 'var(--border)'}`,
                        }}
                      >
                        <Icon size={13} /> {cfg.label} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              {loadingStore ? (
                <div className="text-center py-16">
                  <div className="w-8 h-8 rounded-full border-2 border-t-transparent mx-auto mb-4" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>加载模型仓库...</p>
                </div>
              ) : filteredPresets.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--border)' }}>
                    <Search size={28} style={{ color: 'var(--text-muted)' }} />
                  </div>
                  <h3 className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>未找到匹配的模型</h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>尝试更换关键词或清除筛选条件</p>
                  <button
                    onClick={() => { setSearchQuery(''); setStoreFilter('all'); }}
                    className="mt-4 text-xs px-4 py-2 rounded-lg cursor-pointer transition-all"
                    style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.08)', border: '1px solid rgba(72,202,228,0.15)' }}
                  >
                    清除筛选
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-10">
                  {storeFilter === 'all'
                    ? (() => {
                        // Group by type when showing all
                        const typesInFiltered = [...new Set(filteredPresets.map((p) => p.model_type))];
                        return typesInFiltered.map((type) => {
                          const group = filteredPresets.filter((p) => p.model_type === type);
                          if (group.length === 0) return null;
                          const cfg = typeConfig[type] || typeConfig.other;
                          const Icon = cfg.icon;
                          const installedCount = group.filter((p) => p.is_downloaded).length;
                          const installPct = group.length > 0 ? (installedCount / group.length) * 100 : 0;
                          return (
                            <div key={type} style={{ animation: 'fadeIn 0.4s ease' }}>
                              {/* Category Header */}
                              <div className="flex items-center gap-4 mb-5">
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${cfg.color}20, ${cfg.color}06)`, border: `1px solid ${cfg.color}15`, boxShadow: `0 0 20px ${cfg.glow}10` }}>
                                  <Icon size={22} style={{ color: cfg.color }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-3 mb-1">
                                    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{cfg.label}</h3>
                                    <span className="text-[11px] px-2 py-0.5 rounded-md font-medium" style={{ background: cfg.bg, color: cfg.color }}>{group.length} 个模型</span>
                                    {installedCount > 0 && (
                                      <span className="text-[11px] px-2 py-0.5 rounded-md font-medium flex items-center gap-1" style={{ background: 'rgba(82,183,136,0.08)', color: '#52B788' }}>
                                        <Check size={10} /> 已安装 {installedCount} 个
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', maxWidth: 240 }}>
                                      <div className="h-full rounded-full transition-all" style={{ width: `${installPct}%`, background: cfg.color, opacity: 0.5 }} />
                                    </div>
                                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{installPct.toFixed(0)}%</span>
                                  </div>
                                </div>
                              </div>
                              {/* Cards Grid */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {group.map((preset) => <PresetCard key={preset.id} preset={preset} cfg={cfg} onDownload={openFileModal} />)}
                              </div>
                            </div>
                          );
                        });
                      })()
                    : (() => {
                        // Flat list when filtered by type or search
                        return (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredPresets.map((preset) => {
                              const pCfg = typeConfig[preset.model_type] || typeConfig.other;
                              return <PresetCard key={preset.id} preset={preset} cfg={pCfg} onDownload={openFileModal} />;
                            })}
                          </div>
                        );
                      })()
                  }
                </div>
              )}
            </>
          )}

          {/* ========== Downloads ========== */}
          {activeTab === 'downloads' && (
            <>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>下载任务</h2>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {tasks.filter((t) => t.status === 'running').length} 个进行中 · {tasks.filter((t) => t.status === 'completed').length} 个已完成
                  </p>
                </div>
                <button onClick={fetchDownloads} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                  style={{ color: 'var(--primary)', background: 'rgba(72,202,228,0.06)', border: '1px solid rgba(72,202,228,0.12)' }}>
                  <RefreshCw size={12} /> 刷新
                </button>
              </div>

              {/* 手动导入提示 */}
              <div className="glass rounded-2xl p-4 mb-6" style={{ border: '1px dashed rgba(212,175,55,0.25)', background: 'rgba(212,175,55,0.02)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(212,175,55,0.08)' }}>
                    <FolderOpen size={16} style={{ color: '#D4AF37' }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>手动导入模型</p>
                    <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--text-secondary)' }}>
                      如果网络下载失败，可将模型文件直接放入对应目录后点击扫描
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { dir: 'models/asr/', color: '#52B788' },
                        { dir: 'models/tts/', color: '#FF6B9D' },
                        { dir: 'models/llm/', color: '#48CAE4' },
                        { dir: 'models/music/', color: '#F59E0B' },
                        { dir: 'models/svs/', color: '#A78BFA' },
                        { dir: 'models/audio_lm/', color: '#38BDF8' },
                      ].map(({ dir, color }) => (
                        <code key={dir} className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(255,255,255,0.03)', color }}>{dir}</code>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {tasks.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--border)' }}>
                    <Download size={28} style={{ color: 'var(--text-muted)' }} />
                  </div>
                  <h3 className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>暂无下载任务</h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>去模型仓库选择模型下载</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <DownloadTaskCard
                      key={task.id}
                      task={task}
                      onCancel={handleCancelDownload}
                      onDelete={handleDeleteDownload}
                      onRetry={handleRetryDownload}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ========== File Selection Modal ========== */}
      {showFileModal && modalPreset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
          <div className="glass rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col" style={{ border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{modalPreset.name}</h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>选择要下载的文件</p>
              </div>
              <button onClick={() => setShowFileModal(false)}
                className="flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 8, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {loadingFiles ? (
                <div className="text-center py-8">
                  <div className="w-6 h-6 rounded-full border-2 border-t-transparent mx-auto mb-3" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>获取文件列表...</p>
                </div>
              ) : repoFiles.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>仓库中没有可下载的文件</p>
                </div>
              ) : (
                <>
                  {/* Select all */}
                  <div className="flex items-center gap-2 mb-3 p-2 rounded-lg cursor-pointer"
                    style={{ background: 'rgba(255,255,255,0.03)' }}
                    onClick={toggleAll}>
                    <div className="w-4 h-4 rounded flex items-center justify-center"
                      style={{
                        border: `1.5px solid ${selectedFiles.size === repoFiles.length ? 'var(--primary)' : 'var(--text-muted)'}`,
                        background: selectedFiles.size === repoFiles.length ? 'var(--primary)' : 'transparent',
                      }}>
                      {selectedFiles.size === repoFiles.length && <Check size={10} style={{ color: 'var(--bg)' }} />}
                    </div>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      全选 ({selectedFiles.size}/{repoFiles.length})
                    </span>
                  </div>

                  {/* File list */}
                  <div className="space-y-1">
                    {repoFiles.map((file) => {
                      const isSelected = selectedFiles.has(file.path);
                      return (
                        <div key={file.path}
                          className="flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-all"
                          style={{ background: isSelected ? 'rgba(72,202,228,0.06)' : 'transparent' }}
                          onClick={() => toggleFile(file.path)}>
                          <div className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                            style={{
                              border: `1.5px solid ${isSelected ? 'var(--primary)' : 'var(--text-muted)'}`,
                              background: isSelected ? 'var(--primary)' : 'transparent',
                            }}>
                            {isSelected && <Check size={10} style={{ color: 'var(--bg)' }} />}
                          </div>
                          <File size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <span className="text-xs flex-1 truncate" style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{file.path}</span>
                          <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{file.size_text}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                已选: {selectedFiles.size} 个文件 · {formatBytes(selectedTotalSize)}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowFileModal(false)}
                  className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                  style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}>
                  取消
                </button>
                <button onClick={handleConfirmBatchDownload}
                  disabled={selectedFiles.size === 0 || loadingFiles}
                  className="text-xs px-4 py-1.5 rounded-lg cursor-pointer transition-all font-medium"
                  style={{
                    color: 'var(--bg)',
                    background: selectedFiles.size === 0 ? 'var(--text-muted)' : 'var(--primary)',
                    border: 'none',
                    opacity: selectedFiles.size === 0 ? 0.5 : 1,
                  }}>
                  确认下载
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== Delete Confirmation Modal ========== */}
      {showDeleteConfirm && deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
          <div className="glass rounded-2xl w-full max-w-sm flex flex-col" style={{ border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,107,107,0.08)' }}>
                <AlertTriangle size={18} style={{ color: '#FF6B6B' }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>确认删除</h3>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>此操作不可撤销</p>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                确定要删除模型 <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>「{deleteTarget.name}」</span> 吗？
              </p>
              <p className="text-[11px] mt-2 font-mono" style={{ color: 'var(--text-muted)' }}>{deleteTarget.path}</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={() => { setShowDeleteConfirm(false); setDeleteTarget(null); }}
                className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}>
                取消
              </button>
              <button onClick={confirmDelete} disabled={isDeleting}
                className="text-xs px-4 py-1.5 rounded-lg cursor-pointer transition-all font-medium"
                style={{ color: 'var(--bg)', background: isDeleting ? 'var(--text-muted)' : '#FF6B6B', border: 'none', opacity: isDeleting ? 0.5 : 1 }}>
                {isDeleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Model Detail Modal ========== */}
      {showDetailModal && detailModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
          <div className="glass rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col" style={{ border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{detailModel.name}</h3>
                <p className="text-[11px] mt-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>{detailModel.id}</p>
              </div>
              <button onClick={() => setShowDetailModal(false)}
                className="flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 8, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {/* Notes editor */}
              <ModelNotesEditor
                modelId={detailModel.id}
                initialNotes={modelMeta[detailModel.id]?.notes || ''}
                onSave={handleSaveNotes}
              />

              {loadingDetail ? (
                <div className="text-center py-8">
                  <div className="w-6 h-6 rounded-full border-2 border-t-transparent mx-auto mb-3" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>加载文件列表...</p>
                </div>
              ) : modelFiles.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>暂无文件信息</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {modelFiles.map((f: ModelFileInfo, idx: number) => (
                    <div key={idx} className="flex items-center gap-2.5 p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      {f.is_dir ? (
                        <FolderOpen size={14} style={{ color: '#D4AF37', flexShrink: 0 }} />
                      ) : (
                        <File size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      )}
                      <span className="text-xs flex-1 truncate font-mono" style={{ color: 'var(--text-secondary)' }}>{f.path}</span>
                      {!f.is_dir && (
                        <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{formatBytes(f.size)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {modelFiles.filter((f: ModelFileInfo) => !f.is_dir).length} 个文件 · 共 {formatBytes(modelFiles.filter((f: ModelFileInfo) => !f.is_dir).reduce((s: number, f: ModelFileInfo) => s + f.size, 0))}
              </span>
              <button onClick={() => setShowDetailModal(false)}
                className="text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all"
                style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)' }}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
