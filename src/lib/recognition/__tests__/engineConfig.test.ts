// @vitest-environment node
/**
 * La huella del motor tiene que decir la verdad sin que nadie se acuerde de
 * actualizarla: si cambia una librería, un modelo o una línea del motor, esto
 * falla y dice el valor nuevo que poner en `ENGINE_CONFIG`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ENGINE_CONFIG,
  ENGINE_SOURCE_FILES,
  engineConfigHash,
  engineSourceDigestInput,
  stableStringify,
} from '../engineConfig';

const root = resolve(__dirname, '../../../..');
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

describe('ENGINE_CONFIG matches what actually runs', () => {
  it('pins the installed library versions', () => {
    for (const [name, version] of Object.entries(ENGINE_CONFIG.libraries)) {
      const pkg = JSON.parse(
        readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')
      );
      expect(pkg.version, `${name}: poner '${pkg.version}' en ENGINE_CONFIG.libraries`).toBe(
        version
      );
    }
  });

  it('pins the SHA-256 of every model file', () => {
    for (const [file, digest] of Object.entries(ENGINE_CONFIG.models)) {
      const actual = sha256(readFileSync(resolve(root, 'public/models', file)));
      expect(actual, `${file}: poner '${actual}' en ENGINE_CONFIG.models`).toBe(digest);
    }
  });

  it('pins the SHA-256 of the engine source', () => {
    const input = engineSourceDigestInput(
      ENGINE_SOURCE_FILES.map((path) => ({ path, text: readFileSync(resolve(root, path), 'utf8') }))
    );
    const actual = sha256(input);
    expect(
      actual,
      `El motor cambió: poner sourceSha256: '${actual}' en ENGINE_CONFIG. ` +
        'Es otro motor — las corridas nuevas no se mezclan con las viejas.'
    ).toBe(ENGINE_CONFIG.sourceSha256);
  });
});

describe('engineConfigHash', () => {
  it('is 16 hex and deterministic', async () => {
    const a = await engineConfigHash();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await engineConfigHash()).toBe(a);
  });

  it('does not depend on key order', async () => {
    const reordered = JSON.parse(
      stableStringify({ ...ENGINE_CONFIG, libraries: { ...ENGINE_CONFIG.libraries } })
    );
    expect(await engineConfigHash(reordered)).toBe(await engineConfigHash());
  });

  it('changes when any field changes', async () => {
    const base = await engineConfigHash();
    expect(
      await engineConfigHash({ ...ENGINE_CONFIG, targetMaxPixels: 3_000_000 } as never)
    ).not.toBe(base);
    expect(await engineConfigHash({ ...ENGINE_CONFIG, catalog: true } as never)).not.toBe(base);
  });

  it('matches the SHA-256 of the stable JSON', async () => {
    expect(await engineConfigHash()).toBe(sha256(stableStringify(ENGINE_CONFIG)).slice(0, 16));
  });
});

describe('stableStringify', () => {
  it('sorts keys at every depth and drops undefined', () => {
    expect(stableStringify({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}'
    );
  });
});
