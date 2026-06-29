// Feature: workflow-graph-model — example test for parsePortType malformed strings (R3.11)
import { describe, it, expect } from 'vitest';

import { parsePortType } from './portType';

describe('parsePortType() on malformed strings', () => {
  const malformed = [
    '', // empty
    'list<', // unterminated composite, missing inner + close
    'foo', // unknown base type name
    'optional<>', // empty inner
    'list<string', // missing closing '>'
    'list', // composite keyword with no '<...>'
    'optional', // composite keyword with no '<...>'
    'list<<>', // malformed inner
    'list<string>>', // trailing '>' after a complete type
    'string ', // trailing whitespace not consumed
    'List<string>', // wrong case base/keyword
    'optional<list>', // inner composite keyword without its own '<...>'
  ];

  for (const input of malformed) {
    it(`returns null for ${JSON.stringify(input)}`, () => {
      expect(parsePortType(input)).toBeNull();
    });
  }
});
