// Feature: agent-definition-registry, Property 5: 更新保持 id 与键集合
//
// 对任意非空 AgentRegistry r、取自 r 的 Agent_Id id 与任意 AgentDefinition 内容 body，
// 令 a = { ...body, id }，updateAgent(r, a) 返回成功结果，其新注册表在 id 处的定义等于
// a、其余条目不变，且键集合与 size 与 r 相同、被更新定义的 id 不变。
//
// Validates: Requirements 8.2, 8.4, 8.5

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { updateAgent, getAgent, size } from './registry';
import { agentEquals } from './normalize';
import { arbitraryRegistry, arbitraryValidAgentDefinition } from './arbitraries';

describe('Property 5: updateAgent preserves id and key set, replacing only the target entry', () => {
  it('updating an existing id replaces that entry and leaves the rest unchanged', () => {
    fc.assert(
      fc.property(
        arbitraryRegistry
          .filter((r) => r.agents.size > 0)
          .chain((r) => {
            const keys = [...r.agents.keys()];
            return fc.record({
              r: fc.constant(r),
              idx: fc.nat({ max: keys.length - 1 }),
              body: arbitraryValidAgentDefinition,
            });
          }),
        ({ r, idx, body }) => {
          const id = [...r.agents.keys()][idx];
          const a = { ...body, id };

          const sizeBefore = size(r);
          const keysBefore = [...r.agents.keys()].sort();

          const result = updateAgent(r, a);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // The target entry now equals a, and its id is unchanged.
          const updated = getAgent(result.registry, id);
          expect(updated).toBeDefined();
          expect(updated !== undefined && updated.id === id).toBe(true);
          expect(updated !== undefined && agentEquals(updated, a)).toBe(true);

          // Size and key set unchanged.
          expect(size(result.registry)).toBe(sizeBefore);
          const keysAfter = [...result.registry.agents.keys()].sort();
          expect(keysAfter).toEqual(keysBefore);

          // Every other entry is unchanged.
          for (const key of keysBefore) {
            if (key === id) continue;
            const before = r.agents.get(key);
            const after = result.registry.agents.get(key);
            expect(
              before !== undefined &&
                after !== undefined &&
                agentEquals(before, after)
            ).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
