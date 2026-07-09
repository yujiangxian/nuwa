// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-resolution
/**
 * Custom fast-check arbitraries for the agent-tool-resolution test suite.
 *
 * These generators are the shared input space for this layer's property tests
 * (prop-01..17). They reuse the prior layers' guaranteed-valid generators
 * (tool definitions / registries, agent definitions / registries, port types)
 * and compose new generators that deliberately straddle the resolution layer's
 * interesting boundaries: dangling Tool_Ids, duplicate / missing / unknown /
 * type-mismatched argument bindings, and fully-aligned tool configs.
 *
 * This module is test-support code only: no production logic, no I/O, no React
 * and no mutable global state — only pure arbitrary definitions on `fast-check`.
 */

import fc from 'fast-check';

import type { AgentDefinition } from '../agents/types';
import type { ToolRegistry, ToolDefinition } from '../tools/types';
import type { ToolConfig, ArgumentBinding } from '../workflow/nodeTypes/configTypes';
import type { PortType } from '../workflow/types';
import {
  arbitraryRegistry as arbitraryToolRegistry,
  arbitraryPortType,
} from '../tools/arbitraries';
import {
  arbitraryRegistry as arbitraryAgentRegistry,
  arbitraryValidAgentDefinition,
} from '../agents/arbitraries';
import { listTools } from '../tools/registry';

// ---------------------------------------------------------------------------
// Re-exported prior-layer generators
// ---------------------------------------------------------------------------

/**
 * Re-expose the prior-layer registry/port generators under resolution-local
 * names so property tests can source a `ToolRegistry`, an `AgentRegistry`, a
 * valid `ToolDefinition` and a `PortType` from one place.
 */
export { arbitraryToolRegistry, arbitraryAgentRegistry, arbitraryPortType };
export { arbitraryValidToolDefinition } from '../tools/arbitraries';

// ---------------------------------------------------------------------------
// Agent with explicit tool ids
// ---------------------------------------------------------------------------

/** A non-empty placeholder Port_Id for argument bindings. */
const arbitraryPortId: fc.Arbitrary<string> = fc.string({ minLength: 1 });

/**
 * Build a legal AgentDefinition whose Tool_Binding_List is exactly the given
 * `toolIds` (mapped one-to-one to `{ toolId }`). The list may contain ids that
 * exist in a registry, ids that do not (dangling), and duplicates — this models
 * the full resolution input space. Other fields are forced into a guaranteed-
 * valid, minimal shape: non-empty id/name, legal model params, a short
 * systemPrompt, null voice and empty tags.
 */
export function arbitraryAgentWithToolIds(
  toolIds: readonly string[],
): fc.Arbitrary<AgentDefinition> {
  return arbitraryValidAgentDefinition.map((base) => ({
    ...base,
    systemPrompt: base.systemPrompt.slice(0, 64),
    voice: null,
    tags: [],
    tools: toolIds.map((toolId) => ({ toolId })),
  }));
}

// ---------------------------------------------------------------------------
// Tool registry paired with an agent (mix of resolvable & dangling bindings)
// ---------------------------------------------------------------------------

/**
 * A ToolRegistry paired with an agent whose Tool_Binding_List mixes ids drawn
 * from the registry (resolvable) with random strings (dangling), shuffled into
 * an arbitrary order. Built with `.chain` so the agent's ids depend on the
 * concrete registry produced first.
 */
export const arbitraryToolRegistryAndAgent: fc.Arbitrary<{
  toolRegistry: ToolRegistry;
  agent: AgentDefinition;
}> = arbitraryToolRegistry.chain((toolRegistry) => {
  const existingIds = listTools(toolRegistry).map((t) => t.id);
  const pickedArb: fc.Arbitrary<readonly string[]> =
    existingIds.length > 0
      ? fc.shuffledSubarray(existingIds)
      : fc.constant<readonly string[]>([]);
  const danglingArb: fc.Arbitrary<readonly string[]> = fc.array(
    fc.string({ minLength: 1 }),
    { maxLength: 5 },
  );
  const toolIdsArb: fc.Arbitrary<readonly string[]> = fc
    .tuple(pickedArb, danglingArb)
    .chain(([picked, dangling]) => {
      const combined = [...picked, ...dangling];
      return combined.length > 0
        ? fc.shuffledSubarray(combined, {
            minLength: combined.length,
            maxLength: combined.length,
          })
        : fc.constant<readonly string[]>([]);
    });
  return toolIdsArb.chain((toolIds) =>
    arbitraryAgentWithToolIds(toolIds).map((agent) => ({ toolRegistry, agent })),
  );
});

// ---------------------------------------------------------------------------
// Tool node configs (argument bindings)
// ---------------------------------------------------------------------------

/**
 * Build a ToolConfig referencing the given tool by its id (tools are keyed by
 * id in a ToolRegistry, and `getTool` / validation look the tool up by
 * `toolName`). The argument bindings mix several situations: per declared
 * parameter — omit (may trigger a missing-required error), align (argName =
 * the parameter name, portType = the parameter type → a match), or supply a
 * random portType (a possible type mismatch); plus a set of unknown argNames;
 * plus an optional duplicate of the first parameter's argName (to exercise the
 * duplicate-argument rule). The result therefore spans missing / unknown /
 * type-mismatch / duplicate / aligned cases.
 */
export function arbitraryToolConfigFor(
  tool: ToolDefinition,
): fc.Arbitrary<ToolConfig> {
  const perParam: fc.Arbitrary<ArgumentBinding[]>[] = tool.parameters.map((p) =>
    fc.oneof(
      // Omit this parameter entirely.
      fc.constant<ArgumentBinding[]>([]),
      // Aligned binding: argName matches, portType equals the declared type.
      arbitraryPortId.map<ArgumentBinding[]>((portId) => [
        { portId, argName: p.name, portType: p.type },
      ]),
      // Possible mismatch: a random portType for the parameter.
      fc
        .tuple(arbitraryPortId, arbitraryPortType)
        .map<ArgumentBinding[]>(([portId, portType]) => [
          { portId, argName: p.name, portType },
        ]),
    ),
  );

  // Unknown argument names (do not match any declared parameter).
  const unknownArb: fc.Arbitrary<ArgumentBinding[]> = fc.array(
    fc
      .tuple(arbitraryPortId, fc.string({ minLength: 1 }), arbitraryPortType)
      .map<ArgumentBinding>(([portId, argName, portType]) => ({
        portId,
        argName,
        portType,
      })),
    { maxLength: 4 },
  );

  // Optional duplicate of the first parameter's argName, to drive R6.6.
  const dupArb: fc.Arbitrary<ArgumentBinding[]> =
    tool.parameters.length > 0
      ? fc.oneof(
          fc.constant<ArgumentBinding[]>([]),
          arbitraryPortId.map<ArgumentBinding[]>((portId) => [
            {
              portId,
              argName: tool.parameters[0].name,
              portType: tool.parameters[0].type,
            },
          ]),
        )
      : fc.constant<ArgumentBinding[]>([]);

  return fc
    .tuple(fc.tuple(...perParam), unknownArb, dupArb)
    .map(([groups, unknown, dup]) => {
      const argumentBindings: ArgumentBinding[] = [];
      for (const group of groups) {
        for (const binding of group) argumentBindings.push(binding);
      }
      for (const binding of unknown) argumentBindings.push(binding);
      for (const binding of dup) argumentBindings.push(binding);
      return { kind: 'tool' as const, toolName: tool.id, argumentBindings };
    });
}

/**
 * Build a fully-aligned (legal) ToolConfig for the given tool: every required
 * parameter is provided, optional parameters may be present or omitted, each
 * argName equals its parameter name (so argNames are pairwise distinct when the
 * tool has unique parameter names), every portType equals the parameter's
 * declared type (reflexively assignable → a type match), and there are no
 * unknown argNames. Suitable for the pass branch / Property 10.
 */
export function arbitraryToolConfigAligned(
  tool: ToolDefinition,
): fc.Arbitrary<ToolConfig> {
  const perParam: fc.Arbitrary<ArgumentBinding[]>[] = tool.parameters.map((p) => {
    const present = arbitraryPortId.map<ArgumentBinding[]>((portId) => [
      { portId, argName: p.name, portType: p.type },
    ]);
    return p.required
      ? present
      : fc.oneof(fc.constant<ArgumentBinding[]>([]), present);
  });

  return fc.tuple(...perParam).map((groups) => {
    const argumentBindings: ArgumentBinding[] = [];
    for (const group of groups) {
      for (const binding of group) argumentBindings.push(binding);
    }
    return { kind: 'tool' as const, toolName: tool.id, argumentBindings };
  });
}

// Re-export PortType type for downstream tests that build bindings by hand.
export type { PortType };
