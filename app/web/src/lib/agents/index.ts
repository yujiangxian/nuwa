// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

// Feature: agent-definition-registry
//
// Barrel module: re-exports the full public API and type surface of the agent
// definition registry library so consumers can import from a single entry
// point (`@/lib/agents`) instead of reaching into individual modules (R1.1, R1.2).
//
// Each module's named exports are mutually disjoint, so wildcard re-export is
// unambiguous:
//   - types     : data models, AgentErrorCode enum, result types, constants
//   - normalize : clampGenerationParams, normalizeAgent, agentEquals, agentSemanticEquals
//   - validate  : validateAgent, validateRegistry, compareAgentErrors
//   - registry  : emptyRegistry, size, getAgent, listAgents, listByTag, findByTool,
//                 addAgent, removeAgent, updateAgent, buildTagIndex
//   - serialize : serializeRegistry, deserializeRegistry
//   - bind      : resolveModelBinding, bindAgentToNodeConfig

export * from './types';
export * from './normalize';
export * from './validate';
export * from './registry';
export * from './serialize';
export * from './bind';
