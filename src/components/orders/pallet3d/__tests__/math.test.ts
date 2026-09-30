import { describe, expect, it } from 'vitest';
import { lookAt, multiply, perspective, project, rayBox } from '../math';

describe('pallet3d math', () => {
  it('el punto al que mira la cámara cae en el centro de la pantalla', () => {
    const vp = multiply(perspective(0.9, 1, 1, 1000), lookAt([100, 50, 100], [0, 20, 0]));
    const p = project(vp, [0, 20, 0], 400, 400)!;
    expect(p.x).toBeCloseTo(200, 3);
    expect(p.y).toBeCloseTo(200, 3);
  });

  it('lo que está detrás de la cámara no se proyecta', () => {
    const vp = multiply(perspective(0.9, 1, 1, 1000), lookAt([0, 0, 100], [0, 0, 0]));
    expect(project(vp, [0, 0, 200], 400, 400)).toBeNull();
  });

  it('un rayo acierta la caja que atraviesa y falla la que no', () => {
    expect(rayBox([0, 0, 10], [0, 0, -1], [-1, -1, -1], [1, 1, 1])).toBeCloseTo(9);
    expect(rayBox([5, 0, 10], [0, 0, -1], [-1, -1, -1], [1, 1, 1])).toBeNull();
  });
});
