// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: workflow-node-types — example test for ConfigErrorCode existence (R8.7)

import { describe, it, expect } from 'vitest';

import { ConfigErrorCode } from './index';

/**
 * R8.7: the config-layer error code enum must expose a stable set of codes. This
 * example test pins the eight required codes so that accidental renames or
 * removals are caught immediately.
 */
describe('ConfigErrorCode enum (R8.7)', () => {
  // The eight required, stable config-layer error codes.
  const REQUIRED_CODES = [
    'CONFIG_TYPE_MISMATCH',
    'MISSING_REQUIRED_FIELD',
    'NUMERIC_OUT_OF_RANGE',
    'PORT_ARITY_MISMATCH',
    'PORT_CONTRACT_MISMATCH',
    'DUPLICATE_ARGUMENT_BINDING',
    'EXPRESSION_TYPE_ERROR',
    'EXPRESSION_UNKNOWN_INPUT',
  ] as const;

  it('contains at least the eight required codes', () => {
    const values = new Set<string>(Object.values(ConfigErrorCode));
    for (const code of REQUIRED_CODES) {
      expect(values.has(code)).toBe(true);
    }
    // The enum must have no fewer than the eight required members.
    expect(values.size).toBeGreaterThanOrEqual(REQUIRED_CODES.length);
  });

  it('maps each member name to its own string value (string enum convention)', () => {
    // Each required code is also reachable as a named member whose value equals
    // its own name, which the aggregator relies on for stable serialization.
    for (const code of REQUIRED_CODES) {
      expect(ConfigErrorCode[code as keyof typeof ConfigErrorCode]).toBe(code);
    }
  });
});
