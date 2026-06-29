// Feature: workflow-graph-model, Property 18: 循环作用域良构性检出
import { describe, it } from 'vitest';
import fc from 'fast-check';

import { validateGraph } from './validate';
import { ErrorCode, type LoopScope, type WorkflowGraph } from './types';
import {
  arbitraryValidGraph,
  duplicateLoopScopeId,
  introduceForwardCycle,
  invalidateLoopHeader,
} from './arbitraries';

/** Codes specific to loop-scope well-formedness (R11). */
const LOOP_CODES: readonly ErrorCode[] = [
  ErrorCode.INVALID_LOOP_HEADER,
  ErrorCode.DUPLICATE_LOOP_SCOPE_ID,
  ErrorCode.LOOP_BODY_REFERENCES_MISSING_NODE,
  ErrorCode.MALFORMED_BACK_EDGE,
];

describe('Property 18: loop-scope well-formedness detection', () => {
  it('ill-formed loop scopes raise their codes; a well-formed back-edge raises none of them', () => {
    fc.assert(
      fc.property(arbitraryValidGraph({ minNodes: 2, maxNodes: 5 }), (g) => {
        // Only meaningful when the valid graph actually declared a loop scope
        // (hence carries a well-formed back-edge).
        fc.pre(g.loopScopes.length > 0);

        // (well-formed) The pristine valid graph raises none of the loop codes.
        const baseCodes = new Set(validateGraph(g).errors.map((e) => e.code));
        for (const c of LOOP_CODES) {
          if (baseCodes.has(c)) return false;
        }

        // (a) Loop header whose NodeType is not `loop`.
        const mHeader = invalidateLoopHeader(g);
        if (mHeader !== null) {
          const codes = validateGraph(mHeader.graph).errors.map((e) => e.code);
          if (!codes.includes(ErrorCode.INVALID_LOOP_HEADER)) return false;
        }

        // (b) Duplicate Loop_Scope_Id.
        const mDup = duplicateLoopScopeId(g);
        if (mDup !== null) {
          const codes = validateGraph(mDup.graph).errors.map((e) => e.code);
          if (!codes.includes(ErrorCode.DUPLICATE_LOOP_SCOPE_ID)) return false;
        }

        // (c) Loop_Body referencing a missing node.
        const firstScope = g.loopScopes[0];
        const ghostScope: LoopScope = {
          ...firstScope,
          bodyNodeIds: [...firstScope.bodyNodeIds, 'ghost_body_node'],
        };
        const withGhostBody: WorkflowGraph = {
          ...g,
          loopScopes: [ghostScope, ...g.loopScopes.slice(1)],
        };
        if (
          !validateGraph(withGhostBody).errors.some(
            (e) => e.code === ErrorCode.LOOP_BODY_REFERENCES_MISSING_NODE,
          )
        ) {
          return false;
        }

        // (d) An edge that forms a cycle but is not a well-formed back-edge.
        const mMalformed = introduceForwardCycle(g);
        if (mMalformed !== null) {
          const codes = validateGraph(mMalformed.graph).errors.map((e) => e.code);
          if (!codes.includes(ErrorCode.MALFORMED_BACK_EDGE)) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
