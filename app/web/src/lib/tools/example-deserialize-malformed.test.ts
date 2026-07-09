// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system, Example: deserializeRegistry 拒斥典型畸形输入
/**
 * Example & boundary test (R13.6): representative malformed Registry_Json
 * strings — invalid JSON, wrong shapes, a missing resultType entry, and an
 * unparseable PortType string — all yield ok === false with code
 * TOOL_MALFORMED_JSON and never partially construct a registry.
 */

import { describe, it, expect } from 'vitest';
import { deserializeRegistry } from './serialize';
import { ToolErrorCode } from './types';

const cases: ReadonlyArray<readonly [string, string]> = [
  ['empty string', ''],
  ['truncated object', '{'],
  ['tools is not an array', '{"tools":1}'],
  [
    'entry missing resultType',
    '{"version":1,"tools":[{"id":"a","name":"n","description":"","parameters":[],"tags":[]}]}',
  ],
  [
    'entry with unparseable PortType string',
    '{"version":1,"tools":[{"id":"a","name":"n","description":"","parameters":[],"resultType":"notatype!!","tags":[]}]}',
  ],
];

describe('Example: deserializeRegistry rejects malformed input', () => {
  for (const [label, json] of cases) {
    it(`${label} → TOOL_MALFORMED_JSON`, () => {
      const result = deserializeRegistry(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ToolErrorCode.TOOL_MALFORMED_JSON);
      }
    });
  }
});
