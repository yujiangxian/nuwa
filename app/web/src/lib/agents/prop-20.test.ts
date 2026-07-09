// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry, Property 20: 反序列化拒斥畸形输入
//
// 对任意不符合 Registry_Json 结构的字符串 s（随机非 JSON、缺字段/错类型的对象、
// 被破坏的合法序列化串），deserializeRegistry(s) 返回失败结果，其 AgentError 的 code
// 为 AGENT_MALFORMED_JSON，且调用不抛异常、不部分构造注册表。
//
// Validates: Requirements 15.6

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { deserializeRegistry } from './serialize';
import { AgentErrorCode } from './types';
import { arbitraryMalformedRegistryJson } from './arbitraries';

describe('Property 20: deserialize rejects malformed input', () => {
  it('returns AGENT_MALFORMED_JSON failure without throwing for any malformed string', () => {
    fc.assert(
      fc.property(arbitraryMalformedRegistryJson, (s) => {
        // The call must never throw — it is total over arbitrary input.
        expect(() => deserializeRegistry(s)).not.toThrow();

        const res = deserializeRegistry(s);

        // Failure result with the malformed-json code; no partial registry.
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error.code).toBe(AgentErrorCode.AGENT_MALFORMED_JSON);
        expect('registry' in res).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
