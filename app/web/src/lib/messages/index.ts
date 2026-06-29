// Feature: agent-message-protocol
//
// Barrel module (R1.1, R1.2): re-exports the entire public API and type surface
// of the `messages/` layer from a single entry point. All sub-modules export
// disjoint names, so `export *` introduces no naming conflicts.

export * from './types';
export * from './canonicalJson';
export * from './normalize';
export * from './validate';
export * from './transcript';
export * from './query';
export * from './serialize';
