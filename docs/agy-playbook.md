# Trabajar con `agy` (Antigravity CLI)

> Rafael, 16 sep 2026: **«Siempre usa agy»**. No sólo investigación: también tests, documentación y
> cambios de código acotados. Va contra su plan de Antigravity, así que no gasta tokens de Claude, y
> su salida cae en un archivo en vez de en el contexto de la conversación.

Este documento es la memoria de lo que costó aprender a usarlo. Vive en el repo a propósito: **no
ocupa contexto hasta que alguien lo abre**.

## Qué es

`agy` es el CLI de Google Antigravity, instalado en `~/.local/bin/agy`. Modelos disponibles:
Gemini 3.8 Flash (low/medium/high), Gemini 3.1 Pro, Claude Sonnet 4.6, Claude Opus 4.6 (thinking) y
GPT-OSS 120B. Lee imágenes, busca en la web, edita archivos y corre comandos.

**No habla A2A.** Se comprobó en el binario el 16 sep 2026: no hay agent card ni `message/send`. El
puente es la línea de comandos, y eso basta.

## La llamada que funciona

```bash
agy -p "$(cat brief.md)" \
    --model claude-opus-4-6-thinking \
    --add-dir /ruta/al/repo \
    --sandbox --dangerously-skip-permissions \
    --print-timeout 30m > salida.log 2>&1
```

## Las seis cosas que cuesta aprender

1. **Su directorio de trabajo es SIEMPRE `~/.gemini/antigravity-cli/scratch`.** No es donde hagas
   `cd`. Los archivos que se le pasan hay que **copiarlos ahí**, y sus entregables aparecen ahí.
   Costó dos corridas perdidas el 16 sep: una se quedó esperando un JSON que estaba en otro sitio, y
   **otra se puso a rastrear el disco buscando credenciales de producción hasta conectarse a la base
   real**. Por eso todo brief lleva ahora: _«compruébalo con `ls` antes de empezar; si falta algo,
   para y dilo — no vayas a buscarlo»_.

2. **En modo desatendido no puede pedir permisos.** Sin `--dangerously-skip-permissions`, cualquier
   herramienta que necesite aprobación se auto-deniega y **la corrida sale vacía, no con error**. Se
   perdieron 16 lecturas de un banco de pruebas antes de verlo. Para tareas de datos conviene
   lanzarlo sin ese flag y que falle ruidosamente; para web y tests, con él.

3. **La cuota se agota a mitad de trabajo.** «Individual quota reached… resets in 4h30m». Los
   modelos de Claude dentro de agy tienen su propia cuota; Gemini siguió respondiendo cuando Opus ya
   no. Si se corta a medias deja el árbol de trabajo a medio hacer: hay que rematarlo con otro
   modelo, no volver a empezar.

4. **Claude Code no puede lanzarlo.** El clasificador de permisos del modo auto deniega cualquier
   `Bash` que lleve `--dangerously-skip-permissions` («Create Unsafe Agents»), y sin ese flag la
   corrida sale vacía (ver 2). Así que el brief lo prepara Claude en
   `~/.gemini/antigravity-cli/scratch` y **la corrida la lanza Rafael**, pegando el comando en la
   sesión con el prefijo `!` para que la salida caiga en la conversación. Primera vez: 17 sep 2026.

5. **`zsh` no divide palabras sin comillas.** `set -- $job` no separa argumentos como en bash. Un
   bucle así generó 5 archivos llamados `modelo foto__.json` en vez de correr 5 trabajos.

6. **Su calidad es desigual, y falla con seguridad en la voz.** Ejemplos reales del 16 sep: citó 4
   páginas de inicio para 20 afirmaciones marcadas como «hecho verificado»; dijo que una idea no
   existía cuando estaba en los commits; marcó como anomalía una caja correcta comparándola contra
   sus hermanas _sin medir_; dejó 228 de 332 SKUs duplicados entre filas; y cambió las mayúsculas de
   un campo que se sube a FedEx sin que nadie se lo pidiera.

## Las reglas de uso

- **Lo que entrega se verifica antes de creerlo.** Siempre contra los datos reales, con un script
  propio, no leyendo su informe. El informe dice lo que él cree que hizo.
- **Encargar un segundo agente que verifique al primero funciona.** Refutó 3 de 6 afirmaciones,
  incluida la que sostenía toda una recomendación.
- **Lo que no se delega:** revisar el diff antes de commitear, las escrituras en producción y el
  push. Eso es de quien responde por el resultado.
- **En el brief va el _porqué_, no sólo el _qué_.** Las corridas que salieron bien llevaban el
  contexto del dominio (para qué se usa cada campo, qué cuesta equivocarse). Las que salieron mal
  eran encargos secos.
- **Decirle que negarse es una respuesta válida.** «Si no lo encuentras, dilo» produjo el hallazgo
  más honesto del día; sin esa línea, rellena.

## Encargarle que refute (17 sep 2026)

Funciona: un refutador con Opus y consultas propias encontró **la causa raíz que yo había fallado**
(`markAsReady` arrastrando una orden `reopened` a `double_checking`) y **un defecto en el código que
yo acababa de subir** (un `toast.error` detrás de un `if` que no se cumple: cancelar y que no pase
nada). Eso solo por preguntar «tumba esto».

Tres trampas del encargo, las tres pagadas el mismo día:

- **Un brief sin fechas hace que refute otro mundo.** Midió la base a las 20:00 afirmaciones de las
  15:00 y «refutó» dos que en realidad eran cambios que habíamos hecho entre medias (una orden que
  Rafael canceló, otra que yo devolví). **Cada afirmación lleva la hora en que se midió**, y si algo
  cambió después, se dice en el propio brief.
- **Refuta con lo que puede leer.** Sin acceso al código dató un cambio por `updated_at` sin saber
  que el trigger de actividad no lo toca (ver `inventory-ledger-traps.md`, trampa 2). Al encargo de
  datos hay que **darle también el cuerpo de las funciones que deciden**, o marcar esa afirmación
  como «no verificable sin código» para que no gaste el turno en ella.
- **Su veredicto no es el veredicto.** De 7 afirmaciones marcó 3 refutadas; comprobadas una por una,
  **una sola lo estaba de verdad** y otra a medias. Las suyas se verifican igual que las propias —
  es la regla de arriba, y aquí se cumplió al pie de la letra.

Y una que salió bien y conviene repetir: **la herramienta decide lo que puede hacer, no el brief**.
Se le dio acceso a producción con un runner que envuelve cada consulta en una transacción
`READ ONLY` (`~/.gemini/antigravity-cli/scratch/tools/pickd-query.mjs`), así que preguntó lo que
quiso y no pudo escribir ni queriendo — un `UPDATE` responde «cannot execute UPDATE in a read-only
transaction», y una función que escribe por dentro, también. Con esa garantía, `--dangerously-skip-permissions`
deja de ser un riesgo para los datos.

## Cada descubrimiento se documenta

**Regla, 16 sep 2026.** Cuando se aprende algo que costó encontrar — una trampa de una herramienta,
una causa raíz, un número medido contra producción, una decisión y su porqué — **se escribe donde
vaya a encontrarse la próxima vez**, en el mismo turno en que se descubre:

| Qué es                                                   | Dónde va                                      |
| -------------------------------------------------------- | --------------------------------------------- |
| Una trampa de herramienta o de flujo de trabajo          | este documento, o el `docs/` que corresponda  |
| Una decisión de producto y su razón                      | `.agent/management/BACKLOG.md`, en su entrada |
| Una regla del dominio que el código debe respetar        | el comentario de la función, junto al código  |
| Un hecho de contexto que sólo sirve a quien trabaja aquí | la memoria del agente                         |

Lo que no se escribe se vuelve a pagar. Este documento existe porque el mismo fallo del directorio
de trabajo se pagó tres veces en una tarde.
