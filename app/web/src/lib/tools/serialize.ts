// Feature: agent-tool-system
/**
 * Agent tool system — canonical JSON serialization / deserialization
 * (Key Algorithm 6).
 *
 * Pure functions only: no I/O, no React, no network, no mutable global state.
 * `serializeRegistry` normalizes then emits a fixed field order so that
 * semantically equal registries produce byte-identical strings (R13.5).
 * `deserializeRegistry` strictly validates the structure and never partially
 * constructs a registry; any deviation yields TOOL_MALFORMED_JSON (R13.6).
 * PortType fields are encoded with the prior layer's `formatPortType` and
 * restored with `parsePortType`, giving round-trip identity (R13.3).
 */

import type {
  ToolRegistry,
  ToolDefinition,
  RegistryDeserializeResult,
} from './types';
import { ToolErrorCode } from './types';
import { normalizeTool } from './normalize';
import { listTools } from './registry';
import { formatPortType, parsePortType } from '../workflow/portType';

// ---------------------------------------------------------------------------
// Serialization — Algorithm 6 (Task 5.1)
// ---------------------------------------------------------------------------

/** Plain (JSON-ready) shape of a single tool, with a fixed field order. */
interface PlainParameter {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

interface PlainTool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly PlainParameter[];
  readonly resultType: string;
  readonly tags: readonly string[];
}

interface PlainRegistry {
  readonly version: number;
  readonly tools: readonly PlainTool[];
}

/** Convert a canonical ToolDefinition into its plain JSON shape (fixed key order). */
function toolToPlain(t: ToolDefinition): PlainTool {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    parameters: t.parameters.map((p) => ({
      name: p.name,
      type: formatPortType(p.type),
      required: p.required,
    })),
    resultType: formatPortType(t.resultType),
    tags: [...t.tags],
  };
}

/**
 * Serialize a registry to its canonical Registry_Json string (R13.1, R13.5).
 * Tools are normalized and ordered by id (via listTools), then encoded with a
 * fixed field order and `JSON.stringify`.
 */
export function serializeRegistry(registry: ToolRegistry): string {
  const entries = listTools(registry).map(normalizeTool);
  const plain: PlainRegistry = {
    version: 1,
    tools: entries.map(toolToPlain),
  };
  return JSON.stringify(plain);
}

// ---------------------------------------------------------------------------
// Deserialization — Algorithm 6 (Task 5.2)
// ---------------------------------------------------------------------------

/**
 * Internal sentinel thrown by the strict structural validation. It is always
 * caught within `deserializeRegistry` and converted into TOOL_MALFORMED_JSON;
 * it never escapes this module.
 */
class MalformedRegistryError extends Error {}

function malformed(): RegistryDeserializeResult {
  return {
    ok: false,
    error: {
      code: ToolErrorCode.TOOL_MALFORMED_JSON,
      message: 'The input is not a well-formed canonical Registry_Json string.',
      location: {},
    },
  };
}

/** True when value is a non-null plain object (not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Assert a condition; throw the internal sentinel when it fails. */
function check(condition: boolean): asserts condition {
  if (!condition) {
    throw new MalformedRegistryError();
  }
}

/** Restore a single plain tool entry into a clean ToolDefinition. */
function restoreTool(entry: unknown): ToolDefinition {
  check(isPlainObject(entry));
  const { id, name, description, parameters, resultType, tags } = entry;

  check(typeof id === 'string');
  check(typeof name === 'string');
  check(typeof description === 'string');
  check(Array.isArray(parameters));
  check(typeof resultType === 'string');
  check(Array.isArray(tags));

  const restoredResultType = parsePortType(resultType);
  check(restoredResultType !== null);

  const restoredParameters = parameters.map((param) => {
    check(isPlainObject(param));
    const { name: pName, type: pType, required: pRequired } = param;
    check(typeof pName === 'string');
    check(typeof pType === 'string');
    check(typeof pRequired === 'boolean');
    const restoredType = parsePortType(pType);
    check(restoredType !== null);
    return { name: pName, type: restoredType, required: pRequired };
  });

  const restoredTags = tags.map((tag) => {
    check(typeof tag === 'string');
    return tag;
  });

  return {
    id,
    name,
    description,
    parameters: restoredParameters,
    resultType: restoredResultType,
    tags: restoredTags,
  };
}

/**
 * Deserialize a canonical Registry_Json string (R13.2, R13.6, R13.7).
 * Returns TOOL_MALFORMED_JSON on parse failure or any structural deviation,
 * never partially constructing a registry.
 */
export function deserializeRegistry(json: string): RegistryDeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return malformed();
  }

  try {
    check(isPlainObject(parsed));
    check(parsed.version === 1);
    check(Array.isArray(parsed.tools));

    const tools = new Map<string, ToolDefinition>();
    for (const entry of parsed.tools) {
      const restored = restoreTool(entry);
      tools.set(restored.id, restored);
    }
    return { ok: true, registry: { tools } };
  } catch (error) {
    if (error instanceof MalformedRegistryError) {
      return malformed();
    }
    throw error;
  }
}
