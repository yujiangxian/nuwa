import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// ==================== Types ====================
interface Model {
  id: string;
  name: string;
  version: string;
  quant: string;
  path: string;
  sample_rate: number;
}

interface Voice {
  id: string;
  name: string;
  path: string;
  transcript: string | null;
  sample_rate: number;
}

interface AppConfig {
  voxcpm_tts_path: string | null;
  voxcpm_server_path: string | null;
  models_dir: string;
  output_dir: string;
  voices_dir: string;
  backend: string;
  threads: number;
  default_cfg: number;
  default_timesteps: number;
  current_model_id: string | null;
  current_mode: "VoiceDesign" | "ControllableClone" | "UltimateClone";
  current_voice_id: string | null;
  theme?: string;
}

type GenerationMode = "VoiceDesign" | "ControllableClone" | "UltimateClone";

interface HistoryItem {
  text: string;
  path: string;
  timestamp: Date;
  duration?: string;
}

// ==================== Theme System ====================
function applyTheme(name: string) {
  document.body.dataset.theme = name;
}

// ==================== State ====================
let config: AppConfig | null = null;
let models: Model[] = [];
let voices: Voice[] = [];
let history: HistoryItem[] = [];
let currentOutputPath: string | null = null;
let isGenerating = false;
let genProgress = 0;
let miniCanvas: HTMLCanvasElement | null = null;
let mainCanvas: HTMLCanvasElement | null = null;
let leftDrawerOpen = false;
let rightDrawerOpen = false;
let miniWaveformObserver: ResizeObserver | null = null;
let retryBadcaseEnabled = false;
let referenceAudioId: string | null = null;
let seedValue = -1;
let temperatureValue = 1.0;
let swaySamplingCoefValue: number | null = null;
let noCfgZeroStarEnabled = false;
let outputSampleRateValue: number | null = null;

// ==================== DOM Refs ====================
const $ = (id: string) => document.getElementById(id)!;

// ==================== Layout Engine ====================
let layoutEngine: LayoutEngine | null = null;

class LayoutEngine {
  private sidebarLeft: HTMLElement;
  private sidebarRight: HTMLElement;
  private drawerToggles: NodeListOf<HTMLElement>;
  private threshold: number;
  private isDesktop: boolean = true;

  constructor(threshold: number = 768) {
    this.threshold = threshold;
    this.sidebarLeft = $('sidebarLeft');
    this.sidebarRight = $('sidebarRight');
    this.drawerToggles = document.querySelectorAll('.drawer-toggle-btn');
    this.applyLayout(window.innerWidth, true);
    window.addEventListener('resize', () => this.applyLayout(window.innerWidth, false));
  }

  private applyLayout(width: number, force: boolean = false) {
    const shouldBeDesktop = width >= this.threshold;
    if (!force && shouldBeDesktop === this.isDesktop) return;
    this.isDesktop = shouldBeDesktop;

    if (shouldBeDesktop) {
      this.sidebarLeft.classList.remove('is-drawer', 'drawer-left-closed');
      this.sidebarRight.classList.remove('is-drawer', 'drawer-right-closed');
      this.drawerToggles.forEach(el => el.style.display = 'none');
      $('leftOverlay').classList.add('hidden');
      $('rightOverlay').classList.add('hidden');
      leftDrawerOpen = false;
      rightDrawerOpen = false;
    } else {
      this.sidebarLeft.classList.add('is-drawer', 'drawer-left-closed');
      this.sidebarRight.classList.add('is-drawer', 'drawer-right-closed');
      this.drawerToggles.forEach(el => el.style.display = 'block');
      $('leftOverlay').classList.add('hidden');
      $('rightOverlay').classList.add('hidden');
      leftDrawerOpen = false;
      rightDrawerOpen = false;
    }
  }
}

// ==================== Touch Gestures ====================
class DrawerGestures {
  private startX: number = 0;
  private startY: number = 0;
  private isTracking: boolean = false;
  private readonly EDGE_THRESHOLD = 24;
  private readonly SWIPE_THRESHOLD = 60;

  constructor() {
    document.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: true });
    document.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: true });
    document.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: true });
  }

  private onTouchStart(e: TouchEvent) {
    const touch = e.touches[0];
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.isTracking = true;
  }

  private onTouchMove(e: TouchEvent) {
    if (!this.isTracking) return;
    // Could add visual feedback here (translateX of drawer)
  }

  private onTouchEnd(e: TouchEvent) {
    if (!this.isTracking) return;
    this.isTracking = false;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - this.startX;
    const dy = touch.clientY - this.startY;

    // Ignore vertical swipes
    if (Math.abs(dy) > Math.abs(dx) * 0.8) return;

    const vw = window.innerWidth;

    // Edge swipe from left → open left drawer
    if (this.startX < this.EDGE_THRESHOLD && dx > this.SWIPE_THRESHOLD && !layoutEngine?.['isDesktop']) {
      openLeftDrawer();
    }
    // Edge swipe from right → open right drawer
    else if (this.startX > vw - this.EDGE_THRESHOLD && dx < -this.SWIPE_THRESHOLD && !layoutEngine?.['isDesktop']) {
      openRightDrawer();
    }
    // Swipe left inside left drawer → close
    else if (leftDrawerOpen && dx < -this.SWIPE_THRESHOLD) {
      closeLeftDrawer();
    }
    // Swipe right inside right drawer → close
    else if (rightDrawerOpen && dx > this.SWIPE_THRESHOLD) {
      closeRightDrawer();
    }
  }
}

// ==================== Init ====================
async function init() {
  renderApp();
  applyTheme('ocean');
  await loadConfig();
  await loadModels();
  await loadVoices();
  loadHistory();
  initWaveforms();
  bindEvents();
  initDrawerEvents();
  initCanvasResize();
  initLayoutEngine();
  initTouchGestures();
  checkSetup();
}

function initLayoutEngine() {
  layoutEngine = new LayoutEngine(768);
}

function initTouchGestures() {
  new DrawerGestures();
}

// ==================== Render ====================

function renderApp() {
  document.getElementById('app')!.innerHTML = `
    <div class="app-root text-text-primary font-body">

      <!-- Header -->
      <header class="app-header">
        <div class="flex items-center gap-3">
          <button id="btnToggleLeft" class="drawer-toggle-btn p-2 rounded-full hover:bg-surface-hover transition-colors text-text-muted shrink-0" title="声音库">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
          <div class="flex items-center gap-3">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <circle cx="13" cy="13" r="12" stroke="rgba(255,255,255,0.2)" stroke-width="1" fill="none"/>
              <circle cx="13" cy="13" r="4" fill="var(--primary)"/>
            </svg>
            <div>
              <h1 class="font-display font-semibold tracking-wide" style="font-size: var(--text-sm);">VoxCPM</h1>
            </div>
          </div>
        </div>
        <canvas id="miniWaveform" style="height: 30px; max-width: 300px;" class="mx-auto opacity-40 flex-1"></canvas>
        <div class="flex items-center gap-2 ml-auto">
          <span id="backendStatus" class="text-text-muted font-mono items-center gap-1.5" style="font-size: var(--text-xs);">
            <span class="w-1 h-1 rounded-full bg-text-secondary pulse-dot"></span>
            CPU · 8T
          </span>
          <button id="btnHeaderSettings" class="p-2 rounded-full hover:bg-surface-hover transition-colors shrink-0" title="设置">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-text-muted">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button id="btnToggleRight" class="drawer-toggle-btn p-2 rounded-full hover:bg-surface-hover transition-colors text-text-muted shrink-0" title="参数">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
      </header>

      <!-- Main Layout -->
      <div class="app-body" id="appBody">

        <!-- Left Sidebar -->
        <aside id="sidebarLeft" class="sidebar sidebar-left glass glow-edge">
          <div style="padding: var(--space-md); padding-bottom: var(--space-sm);">
            <div class="flex items-center justify-between" style="margin-bottom: 4px;">
              <h2 style="font-size: var(--text-xs);" class="font-medium text-text-secondary uppercase tracking-widest">声音库</h2>
              <button id="btnAddVoice" class="w-7 h-7 rounded-full flex items-center justify-center hover:bg-surface-hover transition-colors" title="添加参考音频">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-text-muted"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
            <p id="voiceCount" style="font-size: var(--text-xs);" class="text-text-muted">0 个参考音频</p>
          </div>
          <div id="voiceList" class="flex-1 overflow-y-auto" style="padding: 0 var(--space-sm); padding-bottom: var(--space-sm);"></div>
          <div class="border-t" style="padding: var(--space-md); border-color: var(--border);">
            <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest block" style="margin-bottom: 8px;">模型</label>
            <div class="relative">
              <select id="modelSelect" class="w-full bg-transparent border rounded-xl text-text-primary appearance-none cursor-pointer hover:border-border-active transition-colors font-mono" style="border-color: var(--border); padding: 10px 12px; font-size: var(--text-xs);">
                <option value="">加载中...</option>
              </select>
              <svg class="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <p id="modelInfo" style="font-size: var(--text-xs);" class="text-text-muted font-mono" style="margin-top: 6px;"></p>
          </div>
        </aside>

        <!-- Center: Main Stage -->
        <main class="app-center">

          <!-- Central Waveform Visualizer -->
          <div class="stage-viz glass glow-edge flex flex-col items-center justify-center relative">
            <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div class="orb-primary rounded-full blur-3xl breathe" style="background: radial-gradient(circle, var(--primary-glow), transparent 60%);"></div>
              <div class="orb-secondary absolute rounded-full blur-3xl breathe-delayed" style="background: radial-gradient(circle, var(--warm), transparent 55%); opacity: 0.5;"></div>
            </div>
            <canvas id="mainWaveform" class="relative z-10 w-full h-full"></canvas>
            <div class="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 text-text-muted font-mono z-10" style="bottom: var(--space-sm); font-size: var(--text-xs);">
              <span id="waveStatus">就绪</span>
              <span class="w-1 h-1 rounded-full bg-text-muted"></span>
              <span>24kHz</span>
            </div>
          </div>

          <!-- Text Input -->
          <div class="input-area glass glow-edge flex flex-col min-h-0">
            <div class="flex items-center justify-between" style="margin-bottom: 12px;">
              <label style="font-size: var(--text-xs);" class="font-medium text-text-secondary uppercase tracking-widest">输入文本</label>
              <span id="charCount" style="font-size: var(--text-xs);" class="text-text-muted font-mono">0 / 5000</span>
            </div>
            <textarea
              id="textInput"
              class="flex-1 bg-transparent border-none p-0 leading-relaxed resize-none text-text-primary placeholder-text-muted focus:outline-none font-body"
              style="font-size: var(--text-md);"
              placeholder="在此输入要合成的文本...&#10;&#10;提示：&#10;· 声音设定：(年轻女性，温柔甜美)你好&#10;· 可控克隆：(更激动)今天太开心了&#10;· 终极克隆：需要精确的文本转写"
            ></textarea>
          </div>
        </main>

        <!-- Right Sidebar -->
        <aside id="sidebarRight" class="sidebar sidebar-right glass glow-edge">
          <div style="padding: var(--space-md); padding-bottom: var(--space-sm);">
            <h2 style="font-size: var(--text-xs);" class="font-medium text-text-secondary uppercase tracking-widest">参数</h2>
          </div>
          <div class="flex-1 overflow-y-auto" style="padding: 0 var(--space-md);">

            <div style="margin-bottom: var(--space-lg);">
              <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest block" style="margin-bottom: 8px;">生成模式</label>
              <div class="space-y-1">
                <button class="mode-pill w-full text-left px-3 py-2 rounded-lg text-text-secondary hover:bg-surface-hover" style="font-size: var(--text-xs);" data-mode="VoiceDesign" id="modeVoiceDesign">声音设定</button>
                <button class="mode-pill active w-full text-left px-3 py-2 rounded-lg" style="font-size: var(--text-xs);" data-mode="ControllableClone" id="modeControllableClone">可控克隆</button>
                <button class="mode-pill w-full text-left px-3 py-2 rounded-lg text-text-secondary hover:bg-surface-hover" style="font-size: var(--text-xs);" data-mode="UltimateClone" id="modeUltimateClone">终极克隆</button>
              </div>
              <p id="modeDesc" style="font-size: var(--text-xs);" class="text-text-muted leading-relaxed" style="margin-top: 8px;">选择参考音频克隆音色，可用括号控制风格。例: (更激动)今天太开心了</p>
            </div>

            <div style="margin-bottom: var(--space-lg);">
              <div class="flex justify-between items-center" style="margin-bottom: 12px;">
                <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest">CFG</label>
                <span id="cfgValueDisplay" style="font-size: var(--text-base);" class="font-mono text-primary font-medium">2.0</span>
              </div>
              <input type="range" id="cfgSlider" min="0" max="10" step="0.1" value="2.0" class="slider-track w-full">
              <div class="flex justify-between text-text-muted font-mono" style="font-size: var(--text-xs); margin-top: 6px;">
                <span>0</span><span>5</span><span>10</span>
              </div>
            </div>

            <div style="margin-bottom: var(--space-lg);">
              <div class="flex justify-between items-center" style="margin-bottom: 12px;">
                <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest">推理步数</label>
                <span id="timestepsValueDisplay" style="font-size: var(--text-base);" class="font-mono text-primary font-medium">10</span>
              </div>
              <input type="range" id="timestepsSlider" min="1" max="50" step="1" value="10" class="slider-track w-full">
              <div class="flex justify-between text-text-muted font-mono" style="font-size: var(--text-xs); margin-top: 6px;">
                <span>1</span><span>25</span><span>50</span>
              </div>
            </div>

            <div style="margin-bottom: var(--space-lg);">
              <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest block" style="margin-bottom: 8px;">后端</label>
              <div class="relative">
                <select id="settingBackend" class="w-full bg-transparent border rounded-xl text-text-primary appearance-none cursor-pointer hover:border-border-active transition-colors" style="border-color: var(--border); padding: 10px 12px; font-size: var(--text-xs);">
                  <option value="cpu">CPU</option>
                  <option value="cuda">CUDA</option>
                  <option value="vulkan">Vulkan</option>
                </select>
                <svg class="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>

            <div style="margin-bottom: var(--space-lg);">
              <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest block" style="margin-bottom: 8px;">参考音频增强</label>
              <div class="relative">
                <select id="referenceAudioSelect" class="w-full bg-transparent border rounded-xl text-text-primary appearance-none cursor-pointer hover:border-border-active transition-colors" style="border-color: var(--border); padding: 10px 12px; font-size: var(--text-xs);">
                  <option value="">不使用</option>
                </select>
                <svg class="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <p style="font-size: var(--text-xs);" class="text-text-muted leading-relaxed" style="margin-top: 8px;">选择额外参考音频提升克隆相似度（可与任何模式叠加）</p>
            </div>

            <div style="margin-bottom: var(--space-lg);">
              <div class="flex justify-between items-center" style="margin-bottom: 12px;">
                <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest">推理种子</label>
                <span id="seedValueDisplay" style="font-size: var(--text-base);" class="font-mono text-primary font-medium">随机</span>
              </div>
              <div class="flex gap-2">
                <input type="number" id="seedInput" class="flex-1 bg-transparent border rounded-xl text-text-primary placeholder-text-muted transition-colors hover:border-border-active font-mono" style="border-color: var(--border); padding: 10px 12px; font-size: var(--text-xs);" placeholder="留空表示随机">
                <button id="btnRandomSeed" class="px-3 py-2 rounded-xl border hover:bg-surface-hover transition-colors text-text-secondary shrink-0" style="border-color: var(--border); font-size: var(--text-xs);">随机</button>
              </div>
            </div>

            <div style="margin-bottom: var(--space-lg);">
              <button id="retryBadcaseToggle" class="mode-pill w-full text-left px-3 py-2 rounded-lg text-text-secondary hover:bg-surface-hover" style="font-size: var(--text-xs);" data-active="false">
                <span class="flex items-center justify-between">
                  <span>Badcase 自动重试</span>
                  <span id="retryBadcaseStatus" style="font-size: var(--text-xs);" class="text-text-muted">关闭</span>
                </span>
              </button>
              <p style="font-size: var(--text-xs);" class="text-text-muted leading-relaxed" style="margin-top: 8px;">当生成音频异常过长时自动重试（最多 3 次）</p>
            </div>

            <div style="margin-bottom: var(--space-lg);">
              <div class="flex justify-between items-center" style="margin-bottom: 8px;">
                <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest">Temperature</label>
                <span id="temperatureDisplay" style="font-size: var(--text-base);" class="font-mono text-primary font-medium">1.0</span>
              </div>
              <input type="range" id="temperatureSlider" min="0.1" max="2.0" step="0.05" value="1.0" class="w-full accent-primary h-1 bg-surface-hover rounded-lg appearance-none cursor-pointer">
            </div>

            <div style="margin-bottom: var(--space-lg);">
              <div class="flex justify-between items-center" style="margin-bottom: 8px;">
                <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest">Sway Coef</label>
                <span id="swayCoefDisplay" style="font-size: var(--text-base);" class="font-mono text-primary font-medium">默认</span>
              </div>
              <input type="number" id="swayCoefInput" class="w-full bg-transparent border rounded-xl text-text-primary placeholder-text-muted transition-colors hover:border-border-active font-mono" style="border-color: var(--border); padding: 10px 12px; font-size: var(--text-xs);" placeholder="留空使用模型默认">
            </div>

            <div style="margin-bottom: var(--space-lg);">
              <button id="noCfgZeroStarToggle" class="mode-pill w-full text-left px-3 py-2 rounded-lg text-text-secondary hover:bg-surface-hover" style="font-size: var(--text-xs);" data-active="false">
                <span class="flex items-center justify-between">
                  <span>禁用 CFG Zero-Star</span>
                  <span id="noCfgZeroStarStatus" style="font-size: var(--text-xs);" class="text-text-muted">关闭</span>
                </span>
              </button>
              <p style="font-size: var(--text-xs);" class="text-text-muted leading-relaxed" style="margin-top: 8px;">关闭 zero-star 初始化，可能改变生成风格</p>
            </div>

            <div style="margin-bottom: var(--space-lg);">
              <div class="flex justify-between items-center" style="margin-bottom: 8px;">
                <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest">输出采样率</label>
                <span id="outputSampleRateDisplay" style="font-size: var(--text-base);" class="font-mono text-primary font-medium">默认</span>
              </div>
              <select id="outputSampleRateSelect" class="w-full bg-transparent border rounded-xl text-text-primary cursor-pointer hover:border-border-active transition-colors" style="border-color: var(--border); padding: 10px 12px; font-size: var(--text-xs);">
                <option value="">模型默认</option>
                <option value="16000">16000 Hz</option>
                <option value="22050">22050 Hz</option>
                <option value="24000">24000 Hz</option>
                <option value="32000">32000 Hz</option>
                <option value="44100">44100 Hz</option>
                <option value="48000">48000 Hz</option>
              </select>
            </div>

          </div>
        </aside>
      </div>

      <!-- Bottom Control Bar -->
      <div class="bottom-bar glass glow-edge" id="bottomBar">
        <div class="bottom-bar-side flex items-center gap-3" style="min-width: 0;">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: linear-gradient(135deg, var(--primary-glow), rgba(255,255,255,0.02));">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
          </div>
          <div class="min-w-0">
            <div id="currentVoiceName" style="font-size: var(--text-xs);" class="text-text-primary font-medium truncate">未选择</div>
            <div id="currentModeLabel" style="font-size: var(--text-xs);" class="text-text-muted">可控克隆</div>
          </div>
        </div>

        <div class="bottom-bar-center flex flex-col items-center" style="gap: 4px; min-width: 0;">
          <div class="flex items-center" style="gap: 12px;">
            <button id="btnPrev" class="p-2 rounded-full hover:bg-surface-hover transition-colors text-text-muted hover:text-text-secondary" title="上一个">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><rect x="5" y="4" width="2" height="16"/></svg>
            </button>
            <button id="btnGenerate" class="play-btn rounded-full flex items-center justify-center" title="生成语音" style="width: 48px; height: 48px;">
              <svg id="genIcon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>
            <button id="btnPlay" class="p-2 rounded-full hover:bg-surface-hover transition-colors text-text-muted hover:text-text-secondary disabled:opacity-30" title="播放" disabled>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><rect x="17" y="4" width="2" height="16"/></svg>
            </button>
          </div>

          <div class="w-full flex items-center" style="gap: 12px; max-width: 400px;">
            <span style="font-size: var(--text-xs);" class="text-text-muted font-mono" style="width: 32px; text-align: right;">0:00</span>
            <div class="flex-1 h-1 rounded-full relative cursor-pointer group" style="background: var(--border);">
              <div id="progressBar" class="absolute left-0 top-0 h-full rounded-full transition-all duration-300" style="width: 0%; background: var(--primary);"></div>
              <div id="progressThumb" class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg" style="left: 0%; background: var(--primary);"></div>
            </div>
            <span style="font-size: var(--text-xs);" class="text-text-muted font-mono" style="width: 32px;">0:00</span>
          </div>
        </div>

        <div class="bottom-bar-side flex items-center justify-end" style="min-width: 0;">
          <button id="btnOpenOutput" class="p-2 rounded-full hover:bg-surface-hover transition-colors text-text-muted hover:text-text-secondary" title="打开输出目录">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>
      </div>

      <!-- Drawers Overlay -->
      <div id="leftOverlay" class="drawer-overlay hidden"></div>
      <div id="rightOverlay" class="drawer-overlay hidden"></div>

      <!-- Settings Modal -->
      <div id="settingsModal" class="fixed inset-0 z-50 hidden items-center justify-center" style="background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);">
        <div class="modal-panel w-full max-h-[80vh] overflow-y-auto relative" style="margin: 0 var(--space-md); max-width: 500px; padding: var(--space-md);">
          <button id="btnCloseSettings" class="absolute top-4 right-4 p-1 rounded-lg hover:bg-surface-hover transition-colors text-text-muted">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <h2 style="font-size: var(--text-lg);" class="font-display font-bold text-primary" style="margin-bottom: 24px;">设置</h2>
          <div class="space-y-5">
            <div>
              <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest block" style="margin-bottom: 8px;">voxcpm_tts 路径</label>
              <div class="flex gap-2">
                <input id="settingTtsPath" type="text" class="flex-1 bg-transparent border rounded-xl text-text-primary placeholder-text-muted transition-colors hover:border-border-active font-mono" style="border-color: var(--border); padding: 10px 16px; font-size: var(--text-sm);" placeholder="选择 voxcpm_tts.exe">
                <button id="btnBrowseTts" class="px-4 py-2.5 rounded-xl border hover:bg-surface-hover transition-colors text-text-secondary" style="border-color: var(--border); font-size: var(--text-sm);">浏览</button>
              </div>
            </div>
            <div>
              <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest block" style="margin-bottom: 8px;">模型目录</label>
              <input id="settingModelsDir" type="text" class="w-full bg-transparent border rounded-xl text-text-primary transition-colors hover:border-border-active font-mono" style="border-color: var(--border); padding: 10px 16px; font-size: var(--text-sm);">
            </div>
            <div>
              <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest block" style="margin-bottom: 8px;">线程数</label>
              <input id="settingThreads" type="number" min="1" max="64" class="w-full bg-transparent border rounded-xl text-text-primary transition-colors hover:border-border-active font-mono" style="border-color: var(--border); padding: 10px 16px; font-size: var(--text-sm);">
            </div>
            <div>
              <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest block" style="margin-bottom: 8px;">下载模型</label>
              <div class="flex gap-2">
                <input id="downloadRepoId" type="text" class="flex-1 bg-transparent border rounded-xl text-text-primary placeholder-text-muted transition-colors hover:border-border-active font-mono" style="border-color: var(--border); padding: 10px 12px; font-size: var(--text-sm);" placeholder="仓库 ID，如 modelscope/VoxCPM-0.5B">
                <input id="downloadFilename" type="text" class="bg-transparent border rounded-xl text-text-primary placeholder-text-muted transition-colors hover:border-border-active font-mono" style="border-color: var(--border); padding: 10px 12px; font-size: var(--text-sm); width: 140px;" placeholder="文件名.gguf">
                <button id="btnDownloadModel" class="px-3 py-2 rounded-xl border hover:bg-surface-hover transition-colors text-text-secondary shrink-0" style="border-color: var(--border); font-size: var(--text-sm);">下载</button>
              </div>
              <p id="downloadStatus" style="font-size: var(--text-xs);" class="text-text-muted font-mono" style="margin-top: 6px;"></p>
            </div>
            <div>
              <label style="font-size: var(--text-xs);" class="text-text-muted uppercase tracking-widest block" style="margin-bottom: 8px;">主题</label>
              <div class="relative">
                <select id="themeSelect" class="w-full bg-transparent border rounded-xl text-text-primary appearance-none cursor-pointer hover:border-border-active transition-colors" style="border-color: var(--border); padding: 10px 16px; font-size: var(--text-sm);">
                  <option value="amber">琥珀工作室</option>
                  <option value="spotify">Spotify 绿</option>
                  <option value="linear">Linear 靛蓝</option>
                  <option value="stripe">Stripe 紫</option>
                  <option value="tesla">Tesla 单色</option>
                  <option value="notion">Notion 暖色</option>
                  <option value="apple">Apple Music 红</option>
                  <option value="tidal">TIDAL 青</option>
                  <option value="soundcloud">SoundCloud 橙</option>
                  <option value="discord">Discord 蓝紫</option>
                  <option value="obsidian">Obsidian 紫晶</option>
                  <option value="sunset">日落渐变</option>
                  <option value="forest">森林绿</option>
                  <option value="ocean">海洋蓝</option>
                </select>
                <svg class="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-3" style="margin-top: 32px;">
            <button id="btnCancelSettings" class="px-5 py-2.5 rounded-xl text-text-secondary hover:bg-surface-hover transition-colors border" style="border-color: var(--border); font-size: var(--text-sm);">取消</button>
            <button id="btnSaveSettings" class="px-5 py-2.5 rounded-xl bg-primary text-bg font-medium hover:brightness-110 transition-all" style="font-size: var(--text-sm);">保存</button>
          </div>
        </div>
      </div>
    </div>
  `;
}


// ==================== Waveform Animation ====================

function getPrimaryRGB(): [number, number, number] {
  const style = getComputedStyle(document.body);
  const primary = style.getPropertyValue('--primary').trim();
  const temp = document.createElement('div');
  temp.style.color = primary;
  document.body.appendChild(temp);
  const rgb = getComputedStyle(temp).color;
  document.body.removeChild(temp);
  const match = rgb.match(/\d+/g);
  return match ? [parseInt(match[0]), parseInt(match[1]), parseInt(match[2])] : [232, 220, 200];
}

function initWaveforms() {
  miniCanvas = document.getElementById('miniWaveform') as HTMLCanvasElement;
  mainCanvas = document.getElementById('mainWaveform') as HTMLCanvasElement;
  if (miniCanvas) {
    resizeCanvas(miniCanvas);
    drawMiniWaveform();
  }
  if (mainCanvas) {
    resizeCanvas(mainCanvas);
    drawMainWaveform();
  }
}

function resizeCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  // Only update if size actually changed to avoid infinite loops
  if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function initCanvasResize() {
  const miniCanvas = document.getElementById('miniWaveform') as HTMLCanvasElement;
  const mainCanvas = document.getElementById('mainWaveform') as HTMLCanvasElement;
  if ('ResizeObserver' in window) {
    // Observe the parent stage-viz container for main canvas, not the canvas itself
    const stageViz = document.querySelector('.stage-viz');
    if (stageViz) {
      const stageObserver = new ResizeObserver(() => {
        if (mainCanvas) resizeCanvas(mainCanvas);
      });
      stageObserver.observe(stageViz);
    }
    miniWaveformObserver = new ResizeObserver(() => {
      if (miniCanvas) resizeCanvas(miniCanvas);
    });
    if (miniCanvas) miniWaveformObserver.observe(miniCanvas);
  }
  // Fallback: handle window resize
  window.addEventListener('resize', () => {
    if (miniCanvas) resizeCanvas(miniCanvas);
    if (mainCanvas) resizeCanvas(mainCanvas);
  });
}

function getCanvasCSSSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

// ==================== Drawer Logic ====================

function openLeftDrawer() {
  $('sidebarLeft').classList.remove('drawer-left-closed');
  $('leftOverlay').classList.remove('hidden');
  leftDrawerOpen = true;
}

function closeLeftDrawer() {
  $('sidebarLeft').classList.add('drawer-left-closed');
  $('leftOverlay').classList.add('hidden');
  leftDrawerOpen = false;
}

function toggleLeftDrawer() {
  leftDrawerOpen ? closeLeftDrawer() : openLeftDrawer();
}

function openRightDrawer() {
  $('sidebarRight').classList.remove('drawer-right-closed');
  $('rightOverlay').classList.remove('hidden');
  rightDrawerOpen = true;
}

function closeRightDrawer() {
  $('sidebarRight').classList.add('drawer-right-closed');
  $('rightOverlay').classList.add('hidden');
  rightDrawerOpen = false;
}

function toggleRightDrawer() {
  rightDrawerOpen ? closeRightDrawer() : openRightDrawer();
}

function initDrawerEvents() {
  $('btnToggleLeft').addEventListener('click', toggleLeftDrawer);
  $('btnToggleRight').addEventListener('click', toggleRightDrawer);
  $('leftOverlay').addEventListener('click', closeLeftDrawer);
  $('rightOverlay').addEventListener('click', closeRightDrawer);

  // Close drawers when resizing to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
      closeLeftDrawer();
      closeRightDrawer();
    }
  });
}

// ==================== Logic ====================

async function loadConfig() {
  try {
    config = await invoke<AppConfig>("get_config_sync");
    const themeName = config.theme || 'ocean';
    applyTheme(themeName);

    ($("settingTtsPath") as HTMLInputElement).value = config.voxcpm_tts_path || "";
    ($("settingModelsDir") as HTMLInputElement).value = config.models_dir;
    ($("settingBackend") as HTMLSelectElement).value = config.backend;
    ($("settingThreads") as HTMLInputElement).value = String(config.threads);
    ($("themeSelect") as HTMLSelectElement).value = themeName;

    if (config.current_mode) {
      setMode(config.current_mode);
    }
    ($("cfgSlider") as HTMLInputElement).value = String(config.default_cfg);
    $("cfgValueDisplay").textContent = String(config.default_cfg);
    ($("timestepsSlider") as HTMLInputElement).value = String(config.default_timesteps);
    $("timestepsValueDisplay").textContent = String(config.default_timesteps);
  } catch (e) {
    console.error("加载配置失败:", e);
  }
}

async function loadModels() {
  try {
    models = await invoke<Model[]>("list_models");
    const select = $("modelSelect") as HTMLSelectElement;
    select.innerHTML = '';
    if (models.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '无可用模型';
      select.appendChild(opt);
      return;
    }
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (${m.quant})`;
      select.appendChild(opt);
    });
    // Select current
    if (config?.current_model_id) {
      select.value = config.current_model_id;
    }
    updateModelInfo(select.value);
  } catch (e) {
    console.error("加载模型失败:", e);
  }
}

function updateModelInfo(modelId: string) {
  const model = models.find(m => m.id === modelId);
  const infoEl = $("modelInfo");
  if (model) {
    infoEl.textContent = `${model.version} · ${model.quant} · ${model.sample_rate}Hz`;
  } else {
    infoEl.textContent = '';
  }
}

async function loadVoices() {
  try {
    voices = await invoke<Voice[]>("list_voices");
    renderVoiceList();
    renderReferenceAudioSelect();
    $("voiceCount").textContent = `${voices.length} 个参考音频`;
  } catch (e) {
    console.error("加载声音失败:", e);
  }
}

function renderVoiceList() {
  const container = $("voiceList");
  container.innerHTML = '';
  if (voices.length === 0) {
    container.innerHTML = `<div class="text-text-muted text-center py-8" style="font-size: var(--text-xs);">暂无参考音频</div>`;
    return;
  }
  voices.forEach(v => {
    const el = document.createElement('div');
    el.className = 'track-item flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer';
    el.dataset.voiceId = v.id;
    el.innerHTML = `
      <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background: linear-gradient(135deg, var(--primary-glow), rgba(255,255,255,0.02));">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
      </div>
      <div class="flex-1 min-w-0">
        <div style="font-size: var(--text-xs);" class="text-text-primary font-medium truncate">${v.name}</div>
        ${v.transcript ? `<div style="font-size: var(--text-xs);" class="text-text-muted truncate">${v.transcript.slice(0, 20)}...</div>` : ''}
      </div>
      <button class="btn-delete-voice p-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-text-muted transition-colors" data-voice-id="${v.id}" title="删除">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    `;
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.btn-delete-voice')) return;
      selectVoice(v.id);
    });
    container.appendChild(el);
  });
  // Update delete buttons
  container.querySelectorAll('.btn-delete-voice').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (e.currentTarget as HTMLElement).dataset.voiceId;
      if (id) onDeleteVoice(id);
    });
  });
}

function selectVoice(voiceId: string) {
  document.querySelectorAll('#voiceList .track-item').forEach(el => {
    if ((el as HTMLElement).dataset.voiceId === voiceId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
  const voice = voices.find(v => v.id === voiceId);
  if (voice) {
    $("currentVoiceName").textContent = voice.name;
    if (config) config.current_voice_id = voiceId;
  }
}

function renderReferenceAudioSelect() {
  const select = $("referenceAudioSelect") as HTMLSelectElement;
  const currentValue = select.value;
  select.innerHTML = '<option value="">不使用</option>';
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    select.appendChild(opt);
  });
  select.value = currentValue;
}

async function onDeleteVoice(voiceId: string) {
  try {
    await invoke("delete_voice", { voiceId });
    await loadVoices();
  } catch (e) {
    $("waveStatus").textContent = "删除失败: " + e;
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem('voxcpm_history');
    if (raw) {
      const parsed = JSON.parse(raw);
      history = parsed.map((h: any) => ({ ...h, timestamp: new Date(h.timestamp) }));
    }
  } catch {
    history = [];
  }
}

function saveHistory() {
  localStorage.setItem('voxcpm_history', JSON.stringify(history.slice(-50)));
}

function addHistory(text: string, path: string) {
  history.push({ text, path, timestamp: new Date() });
  saveHistory();
}

function setMode(mode: GenerationMode) {
  document.querySelectorAll('.mode-pill').forEach(el => {
    el.classList.remove('active', 'text-text-primary');
    el.classList.add('text-text-secondary');
  });
  const activeBtn = document.getElementById(`mode${mode}`);
  if (activeBtn) {
    activeBtn.classList.add('active', 'text-text-primary');
    activeBtn.classList.remove('text-text-secondary');
  }
  const descMap: Record<GenerationMode, string> = {
    VoiceDesign: '纯文本描述生成音色，无需参考音频。例: (年轻女性，温柔甜美)你好',
    ControllableClone: '选择参考音频克隆音色，可用括号控制风格。例: (更激动)今天太开心了',
    UltimateClone: '提供精确文本转写，实现最高保真度克隆。需要参考音频 + 逐字转写',
  };
  $("modeDesc").textContent = descMap[mode];
  $("currentModeLabel").textContent = {
    VoiceDesign: '声音设定',
    ControllableClone: '可控克隆',
    UltimateClone: '终极克隆',
  }[mode];
  if (config) config.current_mode = mode;
}

function checkSetup() {
  invoke("validate_setup").catch((e: string) => {
    $("waveStatus").textContent = "初始化检查失败: " + e;
  });
}

// ==================== Event Bindings ====================

function bindEvents() {
  // Cfg slider
  $("cfgSlider").addEventListener("input", (e) => {
    const v = (e.target as HTMLInputElement).value;
    $("cfgValueDisplay").textContent = parseFloat(v).toFixed(1);
  });
  $("timestepsSlider").addEventListener("input", (e) => {
    const v = (e.target as HTMLInputElement).value;
    $("timestepsValueDisplay").textContent = v;
  });

  // Model select
  $("modelSelect").addEventListener("change", (e) => {
    const id = (e.target as HTMLSelectElement).value;
    updateModelInfo(id);
    if (config) config.current_model_id = id || null;
  });

  // Char count
  $("textInput").addEventListener("input", (e) => {
    const len = (e.target as HTMLTextAreaElement).value.length;
    $("charCount").textContent = `${len} / 5000`;
  });

  // Generate
  $("btnGenerate").addEventListener("click", onGenerate);

  // Play
  $("btnPlay").addEventListener("click", onPlay);

  // Previous
  $("btnPrev").addEventListener("click", onPrev);

  // Add voice
  $("btnAddVoice").addEventListener("click", onAddVoice);

  // Reference audio select
  $("referenceAudioSelect").addEventListener("change", (e) => {
    referenceAudioId = (e.target as HTMLSelectElement).value || null;
  });

  // Seed input
  $("seedInput").addEventListener("input", (e) => {
    const val = (e.target as HTMLInputElement).value;
    seedValue = val ? parseInt(val) : -1;
    $("seedValueDisplay").textContent = seedValue >= 0 ? String(seedValue) : "随机";
  });
  $("btnRandomSeed").addEventListener("click", () => {
    seedValue = Math.floor(Math.random() * 2147483647);
    ($("seedInput") as HTMLInputElement).value = String(seedValue);
    $("seedValueDisplay").textContent = String(seedValue);
  });

  // Retry badcase toggle
  $("retryBadcaseToggle").addEventListener("click", () => {
    retryBadcaseEnabled = !retryBadcaseEnabled;
    const btn = $("retryBadcaseToggle");
    const status = $("retryBadcaseStatus");
    if (retryBadcaseEnabled) {
      btn.classList.add('active');
      btn.classList.remove('text-text-secondary');
      btn.classList.add('text-text-primary');
      status.textContent = "开启";
    } else {
      btn.classList.remove('active');
      btn.classList.remove('text-text-primary');
      btn.classList.add('text-text-secondary');
      status.textContent = "关闭";
    }
  });

  // Temperature slider
  $("temperatureSlider").addEventListener("input", (e) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    temperatureValue = val;
    $("temperatureDisplay").textContent = val.toFixed(2);
  });

  // Sway sampling coef input
  $("swayCoefInput").addEventListener("input", (e) => {
    const val = (e.target as HTMLInputElement).value;
    swaySamplingCoefValue = val ? parseFloat(val) : null;
    $("swayCoefDisplay").textContent = swaySamplingCoefValue !== null ? String(swaySamplingCoefValue) : "默认";
  });

  // No CFG Zero-Star toggle
  $("noCfgZeroStarToggle").addEventListener("click", () => {
    noCfgZeroStarEnabled = !noCfgZeroStarEnabled;
    const btn = $("noCfgZeroStarToggle");
    const status = $("noCfgZeroStarStatus");
    if (noCfgZeroStarEnabled) {
      btn.classList.add('active');
      btn.classList.remove('text-text-secondary');
      btn.classList.add('text-text-primary');
      status.textContent = "开启";
    } else {
      btn.classList.remove('active');
      btn.classList.remove('text-text-primary');
      btn.classList.add('text-text-secondary');
      status.textContent = "关闭";
    }
  });

  // Output sample rate select
  $("outputSampleRateSelect").addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value;
    outputSampleRateValue = val ? parseInt(val) : null;
    $("outputSampleRateDisplay").textContent = outputSampleRateValue !== null ? String(outputSampleRateValue) + " Hz" : "默认";
  });

  // Download model
  $("btnDownloadModel").addEventListener("click", onDownloadModel);

  // Settings
  $("btnHeaderSettings").addEventListener("click", openSettings);
  $("btnCloseSettings").addEventListener("click", closeSettings);
  $("btnCancelSettings").addEventListener("click", closeSettings);
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnBrowseTts").addEventListener("click", browseTtsPath);
  $("themeSelect").addEventListener("change", (e) => {
    const theme = (e.target as HTMLSelectElement).value;
    applyTheme(theme);
  });

  // Mode pills
  document.querySelectorAll('.mode-pill[data-mode]').forEach(el => {
    el.addEventListener('click', () => {
      const mode = (el as HTMLElement).dataset.mode as GenerationMode;
      setMode(mode);
    });
  });

  // Settings modal backdrop click
  $("settingsModal").addEventListener("click", (e) => {
    if (e.target === $("settingsModal")) closeSettings();
  });

  // Open output dir
  $("btnOpenOutput").addEventListener("click", async () => {
    try {
      await invoke("open_output_dir");
    } catch (e) {
      console.error(e);
    }
  });
}

// ==================== Actions ====================

async function onGenerate() {
  if (isGenerating) return;
  const text = ($("textInput") as HTMLTextAreaElement).value.trim();
  if (!text) {
    $("waveStatus").textContent = "请输入文本";
    return;
  }

  const modeEl = document.querySelector('.mode-pill.active') as HTMLElement;
  const mode = (modeEl?.dataset.mode || "ControllableClone") as GenerationMode;
  const voiceId = config?.current_voice_id || undefined;
  const cfg = parseFloat(($("cfgSlider") as HTMLInputElement).value);
  const timesteps = parseInt(($("timestepsSlider") as HTMLInputElement).value);

  isGenerating = true;
  genProgress = 0;
  $("btnGenerate").classList.add("generating");
  $("genIcon").innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>';
  $("waveStatus").textContent = "推理中...";
  $("btnPlay").setAttribute("disabled", "true");

  try {
    const outputPath = await invoke<string>("synthesize", {
      text, mode, voiceId: voiceId || null, cfg, timesteps,
      retryBadcase: retryBadcaseEnabled,
      referenceVoiceId: referenceAudioId || null,
      seed: seedValue >= 0 ? seedValue : null,
      temperature: temperatureValue,
      swaySamplingCoef: swaySamplingCoefValue,
      noCfgZeroStar: noCfgZeroStarEnabled,
      outputSampleRate: outputSampleRateValue,
    });
    currentOutputPath = outputPath;
    $("btnPlay").removeAttribute("disabled");
    $("waveStatus").textContent = "合成完成";
    addHistory(text, outputPath);
  } catch (e: any) {
    $("waveStatus").textContent = "合成失败: " + e;
  } finally {
    isGenerating = false;
    genProgress = 1;
    $("btnGenerate").classList.remove("generating");
    $("genIcon").innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    setTimeout(() => { genProgress = 0; }, 500);
  }
}

async function onPlay() {
  if (!currentOutputPath) return;
  $("waveStatus").textContent = "播放中...";
  try {
    await invoke("play_audio", { path: currentOutputPath });
    $("waveStatus").textContent = "播放完成";
  } catch (e: any) {
    $("waveStatus").textContent = "播放失败: " + e;
  }
}

async function onPrev() {
  if (history.length < 2) return;
  const prev = history[history.length - 2];
  if (prev) {
    currentOutputPath = prev.path;
    ($("textInput") as HTMLTextAreaElement).value = prev.text;
    $("charCount").textContent = `${prev.text.length} / 5000`;
    $("btnPlay").removeAttribute("disabled");
    $("waveStatus").textContent = "已加载历史";
  }
}

async function onAddVoice() {
  try {
    const path = await open({
      multiple: false, directory: false,
      filters: [{ name: "Audio", extensions: ["wav", "mp3"] }],
    });
    if (!path) return;
    const name = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'voice';
    const voice = await invoke<Voice>("register_voice", { sourcePath: path, name, transcript: null });
    await loadVoices();
    selectVoice(voice.id);
  } catch (e: any) {
    $("waveStatus").textContent = "添加失败: " + e;
  }
}

async function onDownloadModel() {
  const repoId = ($("downloadRepoId") as HTMLInputElement).value.trim();
  const filename = ($("downloadFilename") as HTMLInputElement).value.trim();
  const statusEl = $("downloadStatus");

  if (!repoId || !filename) {
    statusEl.textContent = "请填写仓库 ID 和文件名";
    return;
  }

  statusEl.textContent = "下载中...";
  try {
    await invoke("download_model", { repoId, filename });
    statusEl.textContent = "下载完成";
    await loadModels();
  } catch (e: any) {
    statusEl.textContent = "下载失败: " + e;
  }
}

// ==================== Settings ====================

function openSettings() {
  $("settingsModal").classList.remove("hidden");
  $("settingsModal").classList.add("flex");
}

function closeSettings() {
  $("settingsModal").classList.add("hidden");
  $("settingsModal").classList.remove("flex");
}

async function browseTtsPath() {
  const path = await open({
    multiple: false, directory: false,
    filters: [{ name: "Executable", extensions: ["exe"] }],
  });
  if (path) {
    ($("settingTtsPath") as HTMLInputElement).value = path;
  }
}

async function saveSettings() {
  if (!config) {
    $("waveStatus").textContent = "配置未加载，无法保存";
    closeSettings();
    return;
  }
  config.voxcpm_tts_path = ($("settingTtsPath") as HTMLInputElement).value || null;
  config.models_dir = ($("settingModelsDir") as HTMLInputElement).value;
  config.backend = ($("settingBackend") as HTMLSelectElement).value;
  config.threads = parseInt(($("settingThreads") as HTMLInputElement).value) || 4;
  config.theme = ($("themeSelect") as HTMLSelectElement).value;

  try {
    await invoke("set_config", { config });
    $("waveStatus").textContent = "设置已保存";
  } catch (e: any) {
    $("waveStatus").textContent = "保存失败: " + e;
  }
  closeSettings();
}

// ==================== Mini Waveform ====================

let miniPhase = 0;

function drawMiniWaveform() {
  if (!miniCanvas) return;
  const ctx = miniCanvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = getCanvasCSSSize(miniCanvas);
  if (width === 0 || height === 0) return;

  ctx.clearRect(0, 0, width, height);
  const rgb = getPrimaryRGB();

  miniPhase += 0.05;
  const bars = Math.floor(width / 4);
  const barWidth = 2;
  const gap = 2;

  for (let i = 0; i < bars; i++) {
    const x = i * (barWidth + gap);
    const normalized = i / bars;
    const wave = Math.sin(normalized * Math.PI * 4 + miniPhase) * 0.5 + 0.5;
    const h = wave * height * 0.8;
    const y = (height - h) / 2;

    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.2 + wave * 0.3})`;
    ctx.fillRect(x, y, barWidth, h);
  }

  requestAnimationFrame(drawMiniWaveform);
}

// ==================== Main Waveform ====================

let mainPhase = 0;

function drawMainWaveform() {
  if (!mainCanvas) return;
  const ctx = mainCanvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = getCanvasCSSSize(mainCanvas);
  if (width === 0 || height === 0) return;

  ctx.clearRect(0, 0, width, height);
  const rgb = getPrimaryRGB();

  mainPhase += isGenerating ? 0.1 : 0.03;

  const centerX = width / 2;
  const centerY = height / 2;
  const rings = 5;

  for (let i = 0; i < rings; i++) {
    const baseRadius = 30 + i * 25;
    const expansion = isGenerating ? Math.sin(mainPhase + i * 0.5) * 15 : Math.sin(mainPhase + i * 0.5) * 5;
    const radius = baseRadius + expansion;

    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(0, radius), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.08 - i * 0.012})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Central glow
  const glowRadius = isGenerating ? 20 + Math.sin(mainPhase * 2) * 8 : 15;
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius * 2);
  gradient.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${isGenerating ? 0.4 : 0.15})`);
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fillRect(centerX - glowRadius * 2, centerY - glowRadius * 2, glowRadius * 4, glowRadius * 4);

  // Center dot
  const minDim = Math.min(width, height);
  ctx.beginPath();
  ctx.arc(centerX, centerY, isGenerating ? minDim * 0.03 : minDim * 0.02, 0, Math.PI * 2);
  ctx.fillStyle = isGenerating
    ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.8)`
    : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.3)`;
  ctx.fill();

  requestAnimationFrame(drawMainWaveform);
}

// ==================== Boot ====================
document.addEventListener('DOMContentLoaded', init);
