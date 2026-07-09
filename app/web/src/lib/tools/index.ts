// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-tool-system
/**
 * Agent tool system — barrel module.
 *
 * Re-exports the entire public API and types of the `tools/` layer from a
 * single entry point. Under `isolatedModules`, `export *` wildcard re-exports
 * are legal because no concrete name binding is required at this site.
 *
 * Member exports (no naming conflicts across modules):
 *   - types:     ParameterDef, ParameterSchema, ToolDefinition, ToolRegistry,
 *                ArgumentMap, ToolErrorCode, ToolErrorLocation, ToolError,
 *                ToolRegistryResult, RegistryDeserializeResult,
 *                ToolValidationResult, RegistryValidationResult,
 *                ArgumentValidationResult, ToolIndex
 *   - normalize: normalizeTool, toolEquals, toolSemanticEquals
 *   - validate:  validateTool, validateRegistry, validateArguments,
 *                compareToolErrors
 *   - registry:  emptyRegistry, size, getTool, listTools, listByTag, addTool,
 *                removeTool, updateTool, buildToolIndex
 *   - serialize: serializeRegistry, deserializeRegistry
 *   - bind:      toolConfigToToolName, isToolReferencedBy
 */

export * from './types';
export * from './normalize';
export * from './validate';
export * from './registry';
export * from './serialize';
export * from './bind';
