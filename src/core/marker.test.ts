import {
  describe,
  expect,
  it
} from 'vitest';

import {
  ExnfMarkerParseError,
  parseExnfMarker,
  serializeExnfMarker
} from './marker.ts';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('.exnf marker contract', () => {
  it('serializes with a trailing newline', () => {
    expect(serializeExnfMarker(VALID_UUID)).toBe(`${VALID_UUID}\n`);
  });

  it('parses a single UUID line', () => {
    expect(parseExnfMarker(VALID_UUID)).toBe(VALID_UUID);
  });

  it('accepts one optional trailing newline', () => {
    expect(parseExnfMarker(`${VALID_UUID}\n`)).toBe(VALID_UUID);
  });

  it('rejects a BOM', () => {
    expect(() => parseExnfMarker(`\uFEFF${VALID_UUID}`)).toThrow(ExnfMarkerParseError);
  });

  it('rejects CRLF line endings', () => {
    expect(() => parseExnfMarker(`${VALID_UUID}\r\n`)).toThrow(ExnfMarkerParseError);
  });

  it('rejects extra lines', () => {
    expect(() => parseExnfMarker(`${VALID_UUID}\n${VALID_UUID}`)).toThrow(ExnfMarkerParseError);
  });

  it('rejects non-canonical UUID values', () => {
    expect(() => parseExnfMarker(VALID_UUID.toUpperCase())).toThrow(ExnfMarkerParseError);
  });
});
