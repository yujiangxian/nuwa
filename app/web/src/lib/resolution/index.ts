// Feature: agent-tool-resolution
/**
 * Barrel module for the agent-tool-resolution layer.
 *
 * Re-exports the full public API and types of the resolution sub-spec from a
 * single entry point. There are no naming conflicts across the re-exported
 * modules: `types` exports the data-model types and the ResolutionErrorCode
 * enum; `resolve` exports resolveAgentTools; `validate` exports
 * validateAgentToolRefs / validateRegistriesConsistency /
 * resolveToolNodeArguments / compareResolutionErrors; `capability` exports
 * agentCapabilities / buildCapabilityIndex.
 */

export * from './types';
export * from './resolve';
export * from './validate';
export * from './capability';
