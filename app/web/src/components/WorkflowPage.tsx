import { useMemo, useState } from 'react';
import { ArrowLeft, Play, StepForward, RotateCcw, CircleCheck, CircleDot, Circle, CircleX, Ban } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import type { JsonValue, NodeType, Port, PortType, WorkflowGraph, WorkflowNode } from '@/lib/workflow/types';
import {
  initialState,
  step,
  stepBudget,
} from '@/lib/workflow/engine';
import type {
  ExecutionState,
  ExecutionStatus,
  ExecutionEnvironment,
  NodeExecutor,
} from '@/lib/workflow/engine';

// ---------------------------------------------------------------------------
// Demo graph construction helpers
//
// Nodes carry an opaque `config` (a `{ label }` object, deliberately NOT a valid
// typed node config) so the engine's output-port validation falls back to each
// node's explicitly declared ports. All ports are `json`-typed so every edge is
// trivially type-compatible. The graphs are acyclic with no loop scopes, so they
// pass workflow validation and run purely through the executor-driven path.
// ---------------------------------------------------------------------------

const JSON_TYPE: PortType = { kind: 'json' };

function inPort(id: string, required: boolean): Port {
  return { id, direction: 'input', portType: JSON_TYPE, required };
}
function outPort(id: string): Port {
  return { id, direction: 'output', portType: JSON_TYPE, required: false };
}
function node(
  id: string,
  type: NodeType,
  label: string,
  inputs: readonly Port[],
  outputs: readonly Port[],
): WorkflowNode {
  return { id, type, config: { label } as unknown as JsonValue, inputs, outputs };
}

interface DemoGraph {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly graph: WorkflowGraph;
  readonly labels: Readonly<Record<string, string>>;
}

/** Demo 1: a linear three-stage pipeline (intake → reason → record). */
function buildLinearDemo(): DemoGraph {
  const n1 = node('intake', 'tool', '采集 · Intake', [], [outPort('out')]);
  const n2 = node('reason', 'llm', '推理 · Reason', [inPort('in', true)], [outPort('out')]);
  const n3 = node('record', 'tool', '记录 · Record', [inPort('in', true)], [outPort('out')]);
  const graph: WorkflowGraph = {
    nodes: [n1, n2, n3],
    edges: [
      { id: 'e1', source: { nodeId: 'intake', portId: 'out' }, target: { nodeId: 'reason', portId: 'in' } },
      { id: 'e2', source: { nodeId: 'reason', portId: 'out' }, target: { nodeId: 'record', portId: 'in' } },
    ],
    loopScopes: [],
    entryNodeId: 'intake',
  };
  return {
    key: 'linear',
    name: '线性流水线',
    description: '采集 → 推理 → 记录：三个智能体节点顺序执行，每个节点的输出沿边传递给下游作为输入。',
    graph,
    labels: { intake: '采集 · Intake', reason: '推理 · Reason', record: '记录 · Record' },
  };
}

/** Demo 2: a fan-out / fan-in (one source, two parallel workers, one joining node). */
function buildFanDemo(): DemoGraph {
  const src = node('plan', 'tool', '规划 · Plan', [], [outPort('out')]);
  const a = node('search', 'llm', '检索 · Search', [inPort('in', true)], [outPort('out')]);
  const b = node('analyze', 'llm', '分析 · Analyze', [inPort('in', true)], [outPort('out')]);
  const join = node('compose', 'tool', '汇总 · Compose', [inPort('inA', true), inPort('inB', true)], [outPort('out')]);
  const graph: WorkflowGraph = {
    nodes: [src, a, b, join],
    edges: [
      { id: 'e1', source: { nodeId: 'plan', portId: 'out' }, target: { nodeId: 'search', portId: 'in' } },
      { id: 'e2', source: { nodeId: 'plan', portId: 'out' }, target: { nodeId: 'analyze', portId: 'in' } },
      { id: 'e3', source: { nodeId: 'search', portId: 'out' }, target: { nodeId: 'compose', portId: 'inA' } },
      { id: 'e4', source: { nodeId: 'analyze', portId: 'out' }, target: { nodeId: 'compose', portId: 'inB' } },
    ],
    loopScopes: [],
    entryNodeId: 'plan',
  };
  return {
    key: 'fan',
    name: '并行汇聚',
    description: '规划节点同时驱动检索与分析两个智能体并行就绪，二者完成后汇总节点（需两个输入齐备）才就绪并执行。',
    graph,
    labels: { plan: '规划 · Plan', search: '检索 · Search', analyze: '分析 · Analyze', compose: '汇总 · Compose' },
  };
}

const DEMOS: readonly DemoGraph[] = [buildLinearDemo(), buildFanDemo()];

// ---------------------------------------------------------------------------
// A deterministic mock execution environment.
//
// The executor returns, for each declared output port, a small JSON value that
// echoes the producing node and the inputs it received — so the ValueStore makes
// the data flow visible. It satisfies the engine's output-port-set validation
// because it returns exactly the node's declared output ports.
// ---------------------------------------------------------------------------

const mockExecutor: NodeExecutor = (n, inputs) => {
  const inputObj: { [k: string]: JsonValue } = {};
  for (const [portId, value] of inputs) inputObj[portId] = value;
  const outputs = new Map<string, JsonValue>();
  for (const p of n.outputs) {
    outputs.set(p.id, {
      producedBy: n.id,
      type: n.type,
      receivedInputs: inputObj,
    });
  }
  return { ok: true, outputs };
};

function makeEnv(): ExecutionEnvironment {
  return {
    executorRegistry: {
      byType: new Map<NodeType, NodeExecutor>([
        ['tool', mockExecutor],
        ['llm', mockExecutor],
        ['transform', mockExecutor],
      ]),
    },
    conditionEvaluator: () => ({ ok: true, value: true }),
    humanInputProvider: () => undefined,
    errorPolicy: 'block_downstream',
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<ExecutionStatus, { label: string; color: string; bg: string }> = {
  Pending: { label: '等待', color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' },
  Ready: { label: '就绪', color: '#48CAE4', bg: 'rgba(72,202,228,0.14)' },
  Running: { label: '运行中', color: '#F4A261', bg: 'rgba(244,162,97,0.16)' },
  Completed: { label: '完成', color: '#52B788', bg: 'rgba(82,183,136,0.16)' },
  Skipped: { label: '跳过', color: '#94A3B8', bg: 'rgba(148,163,184,0.10)' },
  Failed: { label: '失败', color: '#EF476F', bg: 'rgba(239,71,111,0.16)' },
  Blocked: { label: '阻塞', color: '#EF476F', bg: 'rgba(239,71,111,0.10)' },
};

function StatusIcon({ status }: { status: ExecutionStatus }) {
  const size = 16;
  const c = STATUS_STYLE[status].color;
  if (status === 'Completed') return <CircleCheck size={size} style={{ color: c }} />;
  if (status === 'Ready' || status === 'Running') return <CircleDot size={size} style={{ color: c }} />;
  if (status === 'Failed' || status === 'Blocked') return status === 'Failed' ? <CircleX size={size} style={{ color: c }} /> : <Ban size={size} style={{ color: c }} />;
  return <Circle size={size} style={{ color: c }} />;
}

const RUN_STATUS_LABEL: Record<RunStatusKey, string> = {
  Idle: '空闲',
  Running: '执行中',
  Paused: '已暂停',
  Completed: '已完成',
  Failed: '已失败',
};
type RunStatusKey = ExecutionState['runStatus'];

export default function WorkflowPage() {
  const setPage = useUIStore((s) => s.setPage);
  const [demoKey, setDemoKey] = useState<string>(DEMOS[0].key);
  const demo = useMemo(() => DEMOS.find((d) => d.key === demoKey) ?? DEMOS[0], [demoKey]);
  const env = useMemo(() => makeEnv(), []);

  const init = useMemo(() => initialState(demo.graph), [demo]);
  const [state, setState] = useState<ExecutionState | null>(init.ok ? init.state : null);
  const [steps, setSteps] = useState(0);
  const [error, setError] = useState<string | null>(init.ok ? null : '图初始化失败');

  // Re-init when switching demos.
  const [activeKey, setActiveKey] = useState(demo.key);
  if (activeKey !== demo.key) {
    setActiveKey(demo.key);
    const fresh = initialState(demo.graph);
    setState(fresh.ok ? fresh.state : null);
    setSteps(0);
    setError(fresh.ok ? null : '图初始化失败');
  }

  const terminal = state !== null && (state.runStatus === 'Completed' || state.runStatus === 'Failed');

  const reset = () => {
    const fresh = initialState(demo.graph);
    setState(fresh.ok ? fresh.state : null);
    setSteps(0);
    setError(fresh.ok ? null : '图初始化失败');
  };

  const doStep = () => {
    if (state === null) return;
    const out = step(state, demo.graph, env);
    if (!out.ok) {
      setError(out.error.message);
      return;
    }
    setState(out.result.state);
    setSteps((s) => s + 1);
  };

  const doRun = () => {
    if (state === null) return;
    let cur = state;
    let count = steps;
    const budget = stepBudget(demo.graph) + 5;
    for (let i = 0; i < budget; i++) {
      if (cur.runStatus === 'Completed' || cur.runStatus === 'Failed' || cur.runStatus === 'Paused') break;
      const out = step(cur, demo.graph, env);
      if (!out.ok) {
        setError(out.error.message);
        break;
      }
      cur = out.result.state;
      count += 1;
      if (!out.result.progress) break;
    }
    setState(cur);
    setSteps(count);
  };

  const valueEntries = state ? [...state.valueStore.entries()] : [];

  return (
    <div className="flex flex-col h-full" style={{ zIndex: 10 }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPage('home')}
            className="flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            title="返回首页"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>工作流编排</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>纯函数执行引擎 · 单步可视化（无需后端）</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {DEMOS.map((d) => (
            <button
              key={d.key}
              onClick={() => setDemoKey(d.key)}
              className="px-3 py-1.5 rounded-lg text-sm transition-all"
              style={{
                background: d.key === demoKey ? 'var(--primary)' : 'var(--surface-hover)',
                color: d.key === demoKey ? 'var(--bg)' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              {d.name}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: controls + nodes */}
        <div className="flex flex-col gap-4 p-6 overflow-y-auto" style={{ width: 460, borderRight: '1px solid var(--border)' }}>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{demo.description}</p>

          {/* Run status + controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={doStep} disabled={terminal || state === null} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--surface-hover)', color: 'var(--text-primary)', border: '1px solid var(--border)', cursor: terminal ? 'not-allowed' : 'pointer', opacity: terminal ? 0.5 : 1 }}>
              <StepForward size={16} /> 单步
            </button>
            <button onClick={doRun} disabled={terminal || state === null} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--primary)', color: 'var(--bg)', border: 'none', cursor: terminal ? 'not-allowed' : 'pointer', opacity: terminal ? 0.5 : 1 }}>
              <Play size={16} /> 执行到完成
            </button>
            <button onClick={reset} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>
              <RotateCcw size={16} /> 重置
            </button>
          </div>

          <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span>运行状态：
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {state ? RUN_STATUS_LABEL[state.runStatus] : '—'}
              </span>
            </span>
            <span>已执行步数：<span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{steps}</span></span>
          </div>

          {error && (
            <div className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,71,111,0.12)', color: '#EF476F', border: '1px solid rgba(239,71,111,0.2)' }}>
              {error}
            </div>
          )}

          {/* Nodes */}
          <div className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>节点</h2>
            {demo.graph.nodes.map((n) => {
              const status: ExecutionStatus = state?.nodeStatus.get(n.id) ?? 'Pending';
              const st = STATUS_STYLE[status];
              return (
                <div key={n.id} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-3">
                    <StatusIcon status={status} />
                    <div>
                      <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{demo.labels[n.id] ?? n.id}</div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{n.type} · {n.id}</div>
                    </div>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-md" style={{ background: st.bg, color: st.color, fontWeight: 600 }}>{st.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: value store */}
        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
            ValueStore（已产出的端口值 · {valueEntries.length}）
          </h2>
          {valueEntries.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>尚无产出。点击「单步」或「执行到完成」开始执行。</div>
          ) : (
            <div className="flex flex-col gap-2">
              {valueEntries.map(([key, stored]) => {
                const [nodeId, portId] = key.split('\u0000');
                return (
                  <div key={key} className="rounded-xl px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="text-xs mb-1" style={{ color: 'var(--primary)' }}>{nodeId} · {portId}</div>
                    <pre className="text-xs whitespace-pre-wrap break-all" style={{ color: 'var(--text-secondary)', margin: 0, fontFamily: 'JetBrains Mono, monospace' }}>
                      {JSON.stringify(stored.value, null, 2)}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
