// Feature: workflow-node-types — cross-layer integration example test (R15.5)

import { describe, it, expect } from 'vitest';

import { NODE_TYPES } from '../types';
import type { Port, PortType, WorkflowEdge, WorkflowGraph, WorkflowNode } from '../types';
import { validateGraph } from '../validate';
import { defaultConfig, validateNodeConfig } from './index';

/**
 * R15.5: a node built from `defaultConfig(t)` must satisfy BOTH the config-layer
 * `validateNodeConfig` AND the base-layer graph `validateGraph` once its required
 * inputs are connected.
 *
 * For each `NodeType` we build the default node and:
 *   - if it has required input ports (llm's `prompt`), we add a predecessor
 *     source node + edge so the requirement is satisfied, with the predecessor
 *     marked as the graph entry (the default node then has an incoming edge);
 *   - otherwise we build a single-node entry graph.
 *
 * In both cases the assembled graph must validate cleanly.
 */
describe('default nodes integrate across config & graph layers (R15.5)', () => {
  /** Build a WorkflowNode from a `defaultConfig` output. */
  function nodeFromDefault(id: string, t: (typeof NODE_TYPES)[number]): WorkflowNode {
    const def = defaultConfig(t);
    return {
      id,
      type: t,
      config: def.config as unknown as WorkflowNode['config'],
      inputs: def.inputs,
      outputs: def.outputs,
    };
  }

  /** Build a source node that emits exactly `portType` on its single output port. */
  function sourceNode(id: string, portType: PortType): WorkflowNode {
    const out: Port = { id: 'out', direction: 'output', portType, required: false };
    return {
      id,
      type: 'human_input',
      // human_input has no inputs, so it is a valid graph entry / source.
      config: { kind: 'human_input', prompt: '请输入', responseType: portType } as unknown as WorkflowNode['config'],
      inputs: [],
      outputs: [out],
    };
  }

  for (const t of NODE_TYPES) {
    it(`${t}: default node passes validateNodeConfig and validateGraph`, () => {
      const node = nodeFromDefault(t, t);

      // Config-layer validity (R10.2): the default config is valid on its own.
      const configResult = validateNodeConfig(node);
      expect(configResult.valid).toBe(true);
      expect(configResult.errors).toEqual([]);

      const requiredInputs = node.inputs.filter((p) => p.required);

      let graph: WorkflowGraph;
      if (requiredInputs.length === 0) {
        // No required inputs: a single-node entry graph already validates.
        graph = {
          nodes: [node],
          edges: [],
          loopScopes: [],
          entryNodeId: node.id,
        };
      } else {
        // Connect every required input from a dedicated source node. The first
        // source is the graph entry; the default node then has incoming edges.
        const sources: WorkflowNode[] = [];
        const edges: WorkflowEdge[] = [];
        requiredInputs.forEach((port, i) => {
          const src = sourceNode(`src_${t}_${i}`, port.portType);
          sources.push(src);
          edges.push({
            id: `e_${t}_${i}`,
            source: { nodeId: src.id, portId: 'out' },
            target: { nodeId: node.id, portId: port.id },
          });
        });
        graph = {
          nodes: [...sources, node],
          edges,
          loopScopes: [],
          entryNodeId: sources[0].id,
        };
      }

      // Base-layer graph validity (R15.5).
      const graphResult = validateGraph(graph);
      expect(graphResult.valid).toBe(true);
      expect(graphResult.errors).toEqual([]);
    });
  }
});
