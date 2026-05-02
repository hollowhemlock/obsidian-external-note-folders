import {
  describe,
  expect,
  it
} from 'vitest';

import {
  ExfMarkerParseError,
  parseExfMarker,
  serializeExfMarker
} from './marker.ts';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('.exf marker contract', () => {
  it('serializes with a trailing newline', () => {
    expect(serializeExfMarker(VALID_UUID)).toBe(`${VALID_UUID}\n`);
  });

  it('parses a single UUID line', () => {
    expect(parseExfMarker(VALID_UUID)).toBe(VALID_UUID);
  });

  it('accepts one optional trailing newline', () => {
    expect(parseExfMarker(`${VALID_UUID}\n`)).toBe(VALID_UUID);
  });

  it('rejects a BOM', () => {
    expect(() => parseExfMarker(`\uFEFF${VALID_UUID}`)).toThrow(ExfMarkerParseError);
  });

  it('rejects CRLF line endings', () => {
    expect(() => parseExfMarker(`${VALID_UUID}\r\n`)).toThrow(ExfMarkerParseError);
  });

  it('rejects extra lines', () => {
    expect(() => parseExfMarker(`${VALID_UUID}\n${VALID_UUID}`)).toThrow(ExfMarkerParseError);
  });

  it('rejects non-canonical UUID values', () => {
    expect(() => parseExfMarker(VALID_UUID.toUpperCase())).toThrow(ExfMarkerParseError);
  });
});
