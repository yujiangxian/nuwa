// Feature: agent-tool-system
/**
 * Agent tool system — custom fast-check arbitraries.
 *
 * Shared generators used by the property tests (prop-01..24). These produce
 * PortType values, parameter definitions/schemas, tool definitions (both
 * arbitrary and guaranteed-valid), registries, argument maps and malformed
 * registry JSON. Pure data generators only — no I/O, no mutable global state.
 */

import fc from 'fast-check';

import type {
  ToolDefinition,
  ParameterDef,
  ParameterSchema,
  ToolRegistry,
  ArgumentMap,
} from './types';
import type { PortType } from '../workflow/types';
import {
  T_STRING,
  T_NUMBER,
  T_BOOLEAN,
  T_JSON,
  T_MESSAGE,
  listOf,
  optionalOf,
} from '../workflow/portType';
import { emptyRegistry, addTool } from './registry';

// ---------------------------------------------------------------------------
// PortType
// ---------------------------------------------------------------------------

/** The five base PortType constants. */
const arbitraryBasePortType: fc.Arbitrary<PortType> = fc.constantFrom(
  T_STRING,
  T_NUMBER,
  T_BOOLEAN,
  T_JSON,
  T_MESSAGE,
);

/**
 * A PortType generator: any base type, or a single level of `list`/`optional`
 * wrapping a base type. The recursion depth is fixed at one composite layer to
 * keep generation finite and inexpensive while still exercising composites.
 */
export const arbitraryPortType: fc.Arbitrary<PortType> = fc.oneof(
  arbitraryBasePortType,
  arbitraryBasePortType.map(listOf),
  arbitraryBasePortType.map(optionalOf),
);

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * An arbitrary parameter definition. `name` may be empty or duplicated across a
 * schema (useful for exercising validation and normalization).
 */
export const arbitraryParameterDef: fc.Arbitrary<ParameterDef> = fc.record({
  name: fc.string(),
  type: arbitraryPortType,
  required: fc.boolean(),
});

/**
 * An arbitrary parameter schema: an array of parameter definitions that may
 * contain duplicate names and arbitrary ordering.
 */
export const arbitraryParameterSchema: fc.Arbitrary<ParameterSchema> =
  fc.array(arbitraryParameterDef);

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/**
 * An arbitrary tool definition. `tags` and `parameters` may be empty, duplicated
 * or unordered, and string fields may be empty — suitable for validation,
 * normalization and serialization tests.
 */
export const arbitraryToolDefinition: fc.Arbitrary<ToolDefinition> = fc.record({
  id: fc.string(),
  name: fc.string(),
  description: fc.string(),
  parameters: arbitraryParameterSchema,
  resultType: arbitraryPortType,
  tags: fc.array(fc.string()),
});

/**
 * A tool definition that is guaranteed to pass `validateTool`: non-empty
 * `id`/`name`, parameters whose names are non-empty and unique, and tags that
 * are each non-empty. `description` and `resultType` are unconstrained.
 */
export const arbitraryValidToolDefinition: fc.Arbitrary<ToolDefinition> =
  fc.record({
    id: fc.string({ minLength: 1 }),
    name: fc.string({ minLength: 1 }),
    description: fc.string(),
    parameters: fc.uniqueArray(
      fc.record({
        name: fc.string({ minLength: 1 }),
        type: arbitraryPortType,
        required: fc.boolean(),
      }),
      { selector: (p) => p.name },
    ),
    resultType: arbitraryPortType,
    tags: fc.array(fc.string({ minLength: 1 })),
  });

/**
 * Given a base tool, produce a semantically-equivalent reordering: a full-length
 * permutation of its `tags` and `parameters`, with all other fields preserved.
 */
export function arbitraryReorderedTool(
  base: ToolDefinition,
): fc.Arbitrary<ToolDefinition> {
  return fc
    .tuple(
      fc.shuffledSubarray([...base.tags], {
        minLength: base.tags.length,
        maxLength: base.tags.length,
      }),
      fc.shuffledSubarray([...base.parameters], {
        minLength: base.parameters.length,
        maxLength: base.parameters.length,
      }),
    )
    .map(([tags, parameters]) => ({ ...base, tags, parameters }));
}

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

/**
 * A registry built from valid tools with unique ids. Tools are accumulated via
 * `addTool` onto an empty registry; because ids are unique every add succeeds.
 */
export const arbitraryRegistry: fc.Arbitrary<ToolRegistry> = fc
  .uniqueArray(arbitraryValidToolDefinition, { selector: (t) => t.id })
  .map((tools) =>
    tools.reduce<ToolRegistry>((reg, tool) => {
      const result = addTool(reg, tool);
      return result.ok ? result.registry : reg;
    }, emptyRegistry()),
  );

/**
 * A registry whose values contain two tools sharing the same `.id` under
 * different placeholder map keys — used to exercise duplicate-id detection.
 */
export const arbitraryDuplicateIdRegistryValues: fc.Arbitrary<ToolRegistry> = fc
  .record({
    sharedId: fc.string({ minLength: 1 }),
    a: arbitraryValidToolDefinition,
    b: arbitraryValidToolDefinition,
  })
  .map(({ sharedId, a, b }) => ({
    tools: new Map<string, ToolDefinition>([
      ['k1', { ...a, id: sharedId }],
      ['k2', { ...b, id: sharedId, name: `${b.name}#dup` }],
    ]),
  }));

// ---------------------------------------------------------------------------
// Argument maps
// ---------------------------------------------------------------------------

type ArgEntry = readonly [string, PortType];
type ArgEntries = readonly ArgEntry[];

/**
 * An argument map generator for a given tool, mixing several situations: each
 * parameter may be omitted, provided with its declared type (a match), or
 * provided with a random type (possibly a mismatch); plus a random set of
 * unknown argument keys. Returns a ReadonlyMap<string, PortType>.
 */
export function arbitraryArgumentMap(
  tool: ToolDefinition,
): fc.Arbitrary<ArgumentMap> {
  // For each declared parameter: omit, provide-matching, or provide-random.
  const perParam: fc.Arbitrary<ArgEntries>[] = tool.parameters.map((p) =>
    fc.oneof(
      fc.constant<ArgEntries>([]),
      fc.constant<ArgEntries>([[p.name, p.type]]),
      arbitraryPortType.map<ArgEntries>((t) => [[p.name, t]]),
    ),
  );

  // A random set of unknown argument keys with arbitrary types.
  const unknownEntries: fc.Arbitrary<ArgEntries> = fc.array(
    fc.tuple(fc.string({ minLength: 1 }), arbitraryPortType),
  );

  return fc
    .tuple(fc.tuple(...perParam), unknownEntries)
    .map(([paramGroups, unknown]) => {
      const entries: ArgEntry[] = [];
      for (const group of paramGroups) {
        for (const entry of group) {
          entries.push(entry);
        }
      }
      for (const entry of unknown) {
        entries.push(entry);
      }
      return new Map<string, PortType>(entries) as ArgumentMap;
    });
}

// ---------------------------------------------------------------------------
// Malformed registry JSON
// ---------------------------------------------------------------------------

/**
 * Malformed registry-JSON strings, mixing: random non-JSON text (filtered so it
 * never accidentally parses), syntactically valid JSON with the wrong top-level
 * structure, and entries that omit required fields or carry a malformed PortType
 * string. All of these must be rejected by `deserializeRegistry`.
 */
export const arbitraryMalformedRegistryJson: fc.Arbitrary<string> = fc.oneof(
  // Random non-JSON strings; drop any that happen to be valid JSON.
  fc.string().filter((s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  }),
  // Valid JSON, wrong top-level structure.
  fc.constantFrom('{"tools":1}', '{"version":1}', '[]', 'null', '42'),
  // Missing fields / malformed PortType entries.
  fc.constantFrom(
    '{"version":1,"tools":[{"id":"a","name":"n","description":""}]}',
    '{"version":1,"tools":[{"id":"a","name":"n","description":"","parameters":[],"resultType":"notatype!!","tags":[]}]}',
  ),
);
