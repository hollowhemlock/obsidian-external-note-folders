import {
  describe,
  expect,
  it
} from 'vitest';

import {
  buildExnfMarkerFileName,
  classifyExnfMarkerFileName,
  ExnfMarkerParseError,
  parseExnfMarker,
  parseExnfMarkerFile,
  serializeExnfMarker
} from './marker.ts';

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('EXNF marker contract', () => {
  it('builds UUID-named marker filenames', () => {
    expect(buildExnfMarkerFileName(VALID_UUID)).toBe(`${VALID_UUID}.exnf`);
  });

  it('classifies legacy, UUID-named, and non-marker filenames', () => {
    expect(classifyExnfMarkerFileName('.exnf')).toEqual({ kind: 'legacy' });
    expect(classifyExnfMarkerFileName(`${VALID_UUID}.exnf`)).toEqual({
      kind: 'uuid-named',
      uuid: VALID_UUID
    });
    expect(classifyExnfMarkerFileName('notes.txt')).toEqual({ kind: 'not-marker' });
  });

  it('rejects malformed marker filenames', () => {
    expect(() => classifyExnfMarkerFileName('not-a-uuid.exnf')).toThrow(ExnfMarkerParseError);
  });

  it('requires UUID-named marker filenames to match their payload', () => {
    expect(parseExnfMarkerFile(`${VALID_UUID}.exnf`, `${VALID_UUID}\n`)).toEqual({
      format: 'uuid-named',
      uuid: VALID_UUID
    });
    expect(() => parseExnfMarkerFile(`${VALID_UUID}.exnf`, '123e4567-e89b-42d3-a456-426614174001\n')).toThrow(ExnfMarkerParseError);
  });

  it('parses legacy marker filenames as deprecated marker evidence', () => {
    expect(parseExnfMarkerFile('.exnf', `${VALID_UUID}\n`)).toEqual({
      format: 'legacy',
      uuid: VALID_UUID
    });
  });

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
