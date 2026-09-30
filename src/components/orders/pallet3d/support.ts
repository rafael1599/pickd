/**
 * ¿Puede este teléfono dibujar el 3D? Vive aparte de `scene.ts` para que
 * preguntarlo no arrastre el motor entero al trozo de Ship: el 3D se descarga
 * sólo al abrir «How to stack».
 */
export function webgl2Supported(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}
