// SPDX-License-Identifier: MIT
// Copyright (c) 2025-2026 yujiangxian

/**
 * workflow-node-types — expression AST and total static typer.
 *
 * Feature: workflow-node-types
 *
 * This module is a bottom-level leaf of the nodeTypes sub-spec. It declares the
 * `Expression` discriminated union together with the operator alias types, the
 * `InputTypeEnv` / `ExpressionTypeResult` / `ExpressionTypeError` types, and two
 * pure functions:
 *
 *   - `typeOfExpression(expr, inputTypes)`: a TOTAL, deterministic, pure static
 *     typer that derives the output `PortType` of an expression from the input
 *     port type environment. It never throws and always terminates (induction on
 *     a strictly smaller sub-expression). It reuses the base layer `isAssignable`
 *     as the ONLY compatibility rule (R14.4).
 *   - `referencedInputs(expr)`: collects all `inputRef` Port_Ids reachable in the
 *     expression.
 *
 * The reference to `ConfigError` is a type-only import; only the `ConfigErrorCode`
 * enum is imported as a value (configTypes carries no runtime dependency on this
 * module, so there is no runtime import cycle).
 */

import type { PortType } from '../types';
// Reuse the base layer type constructors and the single compatibility rule.
// Only the constructors used by the typer are imported (T_MESSAGE is unused
// here); `noUnusedLocals` forbids importing constructors this module never uses.
import { T_STRING, T_NUMBER, T_BOOLEAN, T_JSON, isAssignable } from '../portType';
import { ConfigErrorCode, type ConfigError } from './configTypes';

// ---------------------------------------------------------------------------
// 2.1 Expression AST and operator alias types
// ---------------------------------------------------------------------------

/**
 * A small, total, pure expression abstract syntax (Expression AST). It carries
 * no runtime side effects; the typer only statically derives the output PortType
 * and never evaluates it.
 */
export type Expression =
  // Literals
  | { readonly node: 'litString'; readonly value: string }
  | { readonly node: 'litNumber'; readonly value: number }
  | { readonly node: 'litBool'; readonly value: boolean }
  // Input reference: references an input port (its type comes from Input_Type_Environment)
  | { readonly node: 'inputRef'; readonly portId: string }
  // Field access: reads a field from a json/message value (result type is json)
  | { readonly node: 'field'; readonly target: Expression; readonly name: string }
  // Comparison operators: == != < <= > >= (result boolean)
  | { readonly node: 'compare'; readonly op: CompareOp; readonly left: Expression; readonly right: Expression }
  // Logical operators: and or (both operands must be boolean, result boolean)
  | { readonly node: 'logic'; readonly op: LogicOp; readonly left: Expression; readonly right: Expression }
  // Logical negation: not (operand must be boolean, result boolean)
  | { readonly node: 'not'; readonly operand: Expression }
  // Arithmetic operators: + - * / (both operands must be number, result number)
  | { readonly node: 'arith'; readonly op: ArithOp; readonly left: Expression; readonly right: Expression };

export type CompareOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';
export type LogicOp = 'and' | 'or';
export type ArithOp = 'add' | 'sub' | 'mul' | 'div';

/** Input_Type_Environment: Port_Id -> PortType (the R13 typing environment). */
export type InputTypeEnv = ReadonlyMap<string, PortType>;

/** Expression static typing result (R13.1): success carries the type, failure carries the error. */
export type ExpressionTypeResult =
  | { readonly ok: true; readonly type: PortType }
  | { readonly ok: false; readonly error: ExpressionTypeError };

/**
 * Expression typing error: `code` is restricted to the two EXPRESSION_* codes
 * (R13.5 / R13.6). `portId` carries the referenced Port_Id on unknown input.
 */
export interface ExpressionTypeError {
  readonly code: ConfigError['code']; // limited to EXPRESSION_* of ConfigErrorCode
  readonly message: string;
  readonly portId?: string; // referenced Port_Id when the input is unknown (R16.4)
}

// ---------------------------------------------------------------------------
// 2.2 Total recursive typer `typeOfExpression` and `referencedInputs`
// ---------------------------------------------------------------------------

/** Build a successful typing result. */
function ok(type: PortType): ExpressionTypeResult {
  return { ok: true, type };
}

/** Build an EXPRESSION_UNKNOWN_INPUT failure carrying the referenced Port_Id. */
function unknownInput(portId: string): ExpressionTypeResult {
  return {
    ok: false,
    error: {
      code: ConfigErrorCode.EXPRESSION_UNKNOWN_INPUT,
      message: `Expression references unknown input port "${portId}".`,
      portId,
    },
  };
}

/** Build an EXPRESSION_TYPE_ERROR failure with a human-readable description. */
function typeError(message: string): ExpressionTypeResult {
  return {
    ok: false,
    error: {
      code: ConfigErrorCode.EXPRESSION_TYPE_ERROR,
      message,
    },
  };
}

/**
 * Expression static typer (Expression_Typer, R13.1).
 *
 * Totality (R13.2): for any expr/env this terminates and returns a result; it
 * never throws and never diverges. Each recursive call operates on a strictly
 * smaller sub-expression, so the induction is well-founded.
 * Determinism (R13.3): the same input always yields the same result; failure
 * propagation is fixed left-first.
 * It reuses the base layer `isAssignable` as the ONLY compatibility rule (R14.4).
 */
export function typeOfExpression(expr: Expression, inputTypes: InputTypeEnv): ExpressionTypeResult {
  switch (expr.node) {
    case 'litString':
      return ok(T_STRING);
    case 'litNumber':
      return ok(T_NUMBER);
    case 'litBool':
      return ok(T_BOOLEAN);

    case 'inputRef': {
      const t = inputTypes.get(expr.portId);
      // `ReadonlyMap.get` returns undefined for absent keys; an explicit `has`
      // check would also work but `get` + undefined is sufficient and total.
      if (t === undefined) {
        return unknownInput(expr.portId); // R13.5
      }
      return ok(t);
    }

    case 'field': {
      const tr = typeOfExpression(expr.target, inputTypes);
      if (!tr.ok) {
        return tr; // propagate the failure
      }
      // Field access requires the target to be assignable to json. Since json is
      // the global top type, this holds for every well-typed target; the check is
      // kept for fidelity with the design algorithm. Result type is json.
      if (isAssignable(tr.type, T_JSON)) {
        return ok(T_JSON);
      }
      return typeError(`Field access target is not assignable to json.`); // R13.6
    }

    case 'compare': {
      const lt = typeOfExpression(expr.left, inputTypes);
      if (!lt.ok) {
        return lt; // left-first deterministic propagation
      }
      const rt = typeOfExpression(expr.right, inputTypes);
      if (!rt.ok) {
        return rt;
      }
      if (expr.op === 'eq' || expr.op === 'ne') {
        // eq/ne: either side assignable to the other (json top type included).
        if (isAssignable(lt.type, rt.type) || isAssignable(rt.type, lt.type)) {
          return ok(T_BOOLEAN); // R14.1
        }
        return typeError(`Comparison operands are not comparable for "${expr.op}".`);
      }
      // lt/le/gt/ge: both sides assignable to number, or both assignable to string.
      const bothNumber = isAssignable(lt.type, T_NUMBER) && isAssignable(rt.type, T_NUMBER);
      const bothString = isAssignable(lt.type, T_STRING) && isAssignable(rt.type, T_STRING);
      if (bothNumber || bothString) {
        return ok(T_BOOLEAN); // R14.1
      }
      return typeError(`Ordered comparison "${expr.op}" requires both operands to be number or both string.`);
    }

    case 'logic': {
      const lt = typeOfExpression(expr.left, inputTypes);
      if (!lt.ok) {
        return lt;
      }
      const rt = typeOfExpression(expr.right, inputTypes);
      if (!rt.ok) {
        return rt;
      }
      if (isAssignable(lt.type, T_BOOLEAN) && isAssignable(rt.type, T_BOOLEAN)) {
        return ok(T_BOOLEAN);
      }
      return typeError(`Logical operator "${expr.op}" requires both operands to be boolean.`); // R13.6
    }

    case 'not': {
      const ot = typeOfExpression(expr.operand, inputTypes);
      if (!ot.ok) {
        return ot;
      }
      if (isAssignable(ot.type, T_BOOLEAN)) {
        return ok(T_BOOLEAN);
      }
      return typeError(`Logical negation requires a boolean operand.`); // R13.6
    }

    case 'arith': {
      const lt = typeOfExpression(expr.left, inputTypes);
      if (!lt.ok) {
        return lt;
      }
      const rt = typeOfExpression(expr.right, inputTypes);
      if (!rt.ok) {
        return rt;
      }
      if (isAssignable(lt.type, T_NUMBER) && isAssignable(rt.type, T_NUMBER)) {
        return ok(T_NUMBER);
      }
      return typeError(`Arithmetic operator "${expr.op}" requires both operands to be number.`); // R13.6
    }

    default: {
      // Exhaustiveness guard: if a new Expression branch is added without a case
      // here, this assignment fails to compile. At runtime it never executes.
      const _exhaustive: never = expr;
      return _exhaustive;
    }
  }
}

/** Returns the set of all `inputRef` Port_Ids referenced (directly/indirectly) by the expression. */
export function referencedInputs(expr: Expression): ReadonlySet<string> {
  const acc = new Set<string>();
  collectInputs(expr, acc);
  return acc;
}

/** Structural recursion accumulating referenced Port_Ids into `acc`. Total (finite AST). */
function collectInputs(expr: Expression, acc: Set<string>): void {
  switch (expr.node) {
    case 'litString':
    case 'litNumber':
    case 'litBool':
      return;
    case 'inputRef':
      acc.add(expr.portId);
      return;
    case 'field':
      collectInputs(expr.target, acc);
      return;
    case 'compare':
    case 'logic':
    case 'arith':
      collectInputs(expr.left, acc);
      collectInputs(expr.right, acc);
      return;
    case 'not':
      collectInputs(expr.operand, acc);
      return;
    default: {
      const _exhaustive: never = expr;
      return _exhaustive;
    }
  }
}
