// Feature: workflow-graph-model, Property 31: replaceNodeConfig 仅替换配置
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { replaceNodeConfig } from './mutate';
import type { NodeConfig } from './types';
import { arbitraryValidGraph } from './arbitraries';

describe('Property 31: replaceNodeConfig replaces only the config', () => {
  it('target config is replaced; id/type/inputs/outputs and all other elements are unchanged', () => {
    fc.assert(
      fc.property(
        arbitraryValidGraph(),
        fc.nat(),
        fc.jsonValue({ maxDepth: 2 }),
        (g, idx, rawConfig) => {
          const target = g.nodes[idx % g.nodes.length];
          const config = rawConfig as unknown as NodeConfig;
          const result = replaceNodeConfig(g, target.id, config);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const out = result.graph;

          const updated = out.nodes.find((n) => n.id === target.id);
          expect(updated).toBeDefined();
          if (updated === undefined) return;

          // Config is replaced with exactly the supplied value.
          expect(JSON.stringify(updated.config)).toBe(JSON.stringify(config));
          // Identity, type and port sets of the target node are preserved.
          expect(updated.id).toBe(target.id);
          expect(updated.type).toBe(target.type);
          expect(JSON.stringify(updated.inputs)).toBe(JSON.stringify(target.inputs));
          expect(JSON.stringify(updated.outputs)).toBe(JSON.stringify(target.outputs));

          // All other nodes are untouched.
          for (const original of g.nodes) {
            if (original.id === target.id) continue;
            const after = out.nodes.find((n) => n.id === original.id);
            expect(JSON.stringify(after)).toBe(JSON.stringify(original));
          }

          // Edges, loop scopes and entry marker are unchanged.
          expect(JSON.stringify(out.edges)).toBe(JSON.stringify(g.edges));
          expect(JSON.stringify(out.loopScopes)).toBe(JSON.stringify(g.loopScopes));
          expect(out.entryNodeId).toBe(g.entryNodeId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
