# Recipients de FedEx Ship Manager vs. customers de Pickd

Análisis del 24 ago 2026 sobre un export de la base **Recipient** (Address Book) de FedEx Ship
Manager v3313, la misma máquina y el mismo software al que se importan las dimensiones desde
Pickd (`docs/` → `FedexDimensionsExportCard`, manual `fedex-dimensions-import`).

Motivación: el operador pidió el sentido inverso al de Dimensions — que los clientes que capta
Pickd se puedan exportar a FedEx. Este documento mide si eso tiene sentido, en qué dirección
fluye el valor y qué llave comparten los sistemas. El plan de integración derivado está en
[`fedex-customer-id-integration.md`](./fedex-customer-id-integration.md).

**El archivo analizado (`recipiennts1`, 1,4 MB) no está en el repo a propósito:** contiene
direcciones residenciales, teléfonos y emails de 5.206 destinatarios. Los cruces derivados,
sin teléfonos, están en `reports/fedex/`.

## Qué es el archivo

Export de FSM: **5.206 destinatarios, 56 campos**, sin fila de encabezado, todo entre comillas
dobles, CRLF, UTF-8 sin BOM — la misma convención que el template `DIMENTIONS1`. Los campos
salen en **orden alfabético por nombre de campo** (igual que `Description, ID, Height, Length,
Width` en Dimensions), lo que permite deducir la mayoría por posición. Solo ~20 llevan datos.

| col    | campo (nombre en FSM)                                                                                        | largo  | relleno            | observación                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------ | ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 0–2    | Address 1 / 2 / 3                                                                                            | 35     | 5.206 / 416 / 0    |                                                                                                                              |
| 3      | Address Check Date                                                                                           | 10     | 51                 | fecha del Address Checker, `MM/DD/YYYY`                                                                                      |
| 4      | Address Override Flag                                                                                        | 1      | todos `N`          |                                                                                                                              |
| 5      | Batch Status Code                                                                                            | 1      | todos `N`          |                                                                                                                              |
| 6      | Bill Account                                                                                                 | 9      | 9                  | cuenta FedEx del destinatario                                                                                                |
| 7      | Bill Code                                                                                                    | 1      | 5.197 `4`, 9 `2`   | a quién se factura                                                                                                           |
| 8      | City                                                                                                         | 35     | 5.206              |                                                                                                                              |
| 9      | Company                                                                                                      | 35     | 4.471              |                                                                                                                              |
| 10     | Contact                                                                                                      | 35     | 4.475              |                                                                                                                              |
| 11     | Country Code                                                                                                 | 2      | 5.206              | 4.993 `US`, 54 países                                                                                                        |
| 12–23  | Domestic Pref … (referencias, alcohol, pago, dimensiones, tipo de paquete, servicio), FedEx 3rd Party Acct # |        | 0                  | preferencias por destinatario, sin usar                                                                                      |
| 24     | FedEx Acct #                                                                                                 | 9      | 9                  | repite la col 6                                                                                                              |
| 25–37  | FedEx Bill D/T/F 3rd Party, FILLER, Intl Pref …                                                              |        | 0                  | sin usar                                                                                                                     |
| 38, 39 | Other 1 / 2 Notification Language                                                                            | 4      | 433 / 280          | `en`                                                                                                                         |
| 40     | Phone Extension                                                                                              | 6      | 14                 | `103`, `219`                                                                                                                 |
| 41     | Phone Number                                                                                                 | 10     | 4.192              | solo dígitos, 10; **364 son `0000000000` y 253 el teléfono de Jamis** (2017689050); 3.575 reales                             |
| 42     | Recipient Brazilian Resident Indicator                                                                       | 1      | 4.859 `Y`          | un default, no significa nada aquí                                                                                           |
| **43** | **Recipient Code**                                                                                           | **25** | **5.206, único**   | el Recipient ID — la llave                                                                                                   |
| 44     | Recipient Loc ID                                                                                             | 10     | 108                | **94 son cuenta AS400 + ship-to**; en 25 casos el Code es texto y el Loc ID guarda el número — alguien ya lo usaba de puente |
| 45     | Recipient Notification Language                                                                              | 4      | todos `en`         |                                                                                                                              |
| 46     | Residential/Commercial Ind                                                                                   | 1      | 524 `R`, 4.682 `C` |                                                                                                                              |
| 47–49  | Shipment Notify Email Address / Other 1 / Other 2                                                            | 120    | 319 / 210 / 57     | los dos primeros son emails de personal de Jamis; el tercero, 45 externos                                                    |
| 50     | Shipment Notify Fax Number                                                                                   | 18     | 1                  |                                                                                                                              |
| 51     | Shipper/Recipient Related                                                                                    | 1      | todos `N`          |                                                                                                                              |
| 52     | State Tax ID                                                                                                 | 12     | 0                  |                                                                                                                              |
| 53     | State/Province                                                                                               | 2      | 5.018              |                                                                                                                              |
| 54     | Tax ID/EIN                                                                                                   | 18     | 9                  |                                                                                                                              |
| 55     | Zip/Postal Code                                                                                              | 15     | 5.189              |                                                                                                                              |

**Confirmado el 26 ago 2026 con fotos del template** `RECIEVERS1` (tipo Export, base Recipient,
delimitador `"`, separador `,`, fecha `MMDDYYYY`, sin encabezados): son los 56 campos de la base
Recipient en orden alfabético, y coinciden uno a uno con las 56 columnas del archivo. Los largos
son los máximos de FSM y valen también para el import: **Recipient Code 25, Company / Contact /
Address 35, Phone 10 dígitos sin formato, State 2, Country 2, Residential 1 (`C`/`R`)**.

## El Recipient ID es la cuenta del AS400

951 de los 5.206 IDs son numéricos y siguen un patrón que no es casualidad:

| forma                     | filas | ejemplo                                       |
| ------------------------- | ----- | --------------------------------------------- |
| 6 dígitos                 | 658   | `879000`, `702908`                            |
| 7 dígitos                 | 132   | `1035000`, `1253200`                          |
| otros (1–5, 8–10 dígitos) | 161   | `8692`, `55079`                               |
| texto                     | 4.255 | `OC BICYCLE CENTER`, `SB 202`, `THE SPORTS B` |

De los 658 de 6 dígitos, **527 terminan en `00`, 102 en `01`, 13 en `02`, 5 en `03`**. Eso es
exactamente el encabezado que el watchdog ya lee del AS400 — `Account Number: 0007099 00` —
con los ceros a la izquierda quitados y el sufijo de ship-to pegado: `709900`. Los de 7 dígitos
son cuentas ≥ 10000 (`10350` + `00`). Los 589 prefijos distintos entre los de 6 dígitos son
589 cuentas del ERP.

**Los tres sistemas ya comparten una llave y Pickd es el único que la tira**:
`watchdog-pickd/parser.py` tiene `parse_account_number`, pero su resultado no se persiste en
ninguna tabla de Pickd.

Los otros 4.255 IDs son texto tecleado a mano por quien despachaba: 1.429 son el nombre de la
empresa tal cual; el resto son abreviaturas (`SPORTS BASE 100`, `WEST O`, `ISLE PO BOX 54`) o
nombres de persona. 507 empresas existen a la vez con un ID numérico y con uno de texto.

## FSM tiene más volumen, no más calidad

- **825 empresas con más de un recipient** (2.234 filas) y **904 direcciones repetidas**
  (2.340 filas). Sports Basement tiene 12 entradas para ~6 locales reales.
- 617 de los 4.192 teléfonos son falsos (ceros o el de Jamis).
- 51 filas con fecha (2018–2023) y 9 con número de cuenta FedEx: es la acumulación de años de
  entradas puntuales, no un maestro mantenido.

Cada vez que alguien no encontró al cliente en FSM, creó otro. Sin una llave que teclear, el
libro solo puede crecer así.

## Pickd: 614 clientes, sin teléfono ni email

Al 24 ago 2026 en prod: **614 `customers`**, 590 con al menos una orden, 407 activos en los
últimos 90 días; 471 con calle, 456 con ciudad/estado/zip; **0 con teléfono, 0 con email**
(las columnas existen y la UI las pinta — `OrderRowCard`, `PublicOrderView` — pero nadie las
llena). 598 filas en `customer_addresses`.

Dato malo conocido: 27 clientes tienen como calle una línea de SKU capturada por el parser
(`TENAFLY BICYCLE WORKSHOP` → `03 3738 BK N TRL X A1 15 2025 GLOSS BLACK 480.95`), y 143 no
tienen dirección.

## El cruce

Se cruzaron los 614 clientes de prod contra los 5.206 recipients por nombre normalizado, por
(calle, zip) y por zip + palabra del nombre.

|                                                                                 | clientes                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| ya están en FSM                                                                 | **519 (85 %)** — 490 por nombre, 23 por dirección, 6 por zip + palabra |
| … de los cuales apuntan a **más de un** recipient                               | 371 — sin la cuenta AS400 no se sabe cuál es el bueno                  |
| no están en FSM                                                                 | **95** — 92 con órdenes, 60 activos en 90 días                         |
| … con dirección usable                                                          | 58                                                                     |
| … con dirección rota o ausente                                                  | 34                                                                     |
| están, pero la dirección de Pickd tiene un zip que FSM no tiene (ship-to nuevo) | 28                                                                     |
| están, misma dirección con otra grafía (`332 US-1` vs `332 ROUTE 1`)            | 67                                                                     |

**Pickd → FSM:** ~58 recipients nuevos + ~28 ship-tos nuevos ≈ **86 registros, el 1,6 % del
libro.** Es un delta pequeño y de una vez; después es un goteo de unos pocos por semana.

**FSM → Pickd:** teléfono real para **496** de los 519 que coinciden; dirección para **113 de los
143** sin dirección y **25 de los 27** con basura.

## Conclusiones

1. El sentido con valor es **FSM → Pickd** (teléfono, dirección, y sobre todo la llave). El
   sentido pedido es viable y barato, pero es un goteo, no una sincronización.
2. **El import de Recipient de FSM admite Append**, a diferencia de Dimensions, donde solo
   Replace sirve. No hay que mandar el libro completo: basta "clientes creados desde la última
   corrida", con el mismo patrón de botón, log append-only y manual que Dimensions.
3. Si el Recipient ID que genera Pickd es la **cuenta AS400 + ship-to**, quien despacha lo
   encuentra tecleando el número que ya tiene en la hoja, y FSM deja de acumular `SB 202`.
4. Un watcher en la máquina de FedEx no hace falta para recipients. Donde sí valdría es en
   **envíos**: FSM puede exportar cada shipment al despachar (tracking, destinatario, peso,
   cargos); un watcher que lea ese archivo y marque la orden en Pickd cierra el ciclo.

## Archivos derivados

- `reports/fedex/recipients-match-2026-08-24-unmatched.csv` — los 95 clientes de Pickd que no
  están en FSM, con su dirección en Pickd y nº de órdenes.
- `reports/fedex/recipients-match-2026-08-24-new-shipto.csv` — los 28 clientes que están en FSM
  pero con una dirección que FSM no tiene.
- `reports/fedex/recipients-match-2026-08-24-ambiguous.csv` — los 371 que apuntan a más de un
  recipient, con los Recipient IDs candidatos (sin teléfonos).

Método: script Python ad hoc sobre el export y un volcado de `customers` +
`customer_addresses` (default) de prod; normalización de nombre (sin puntuación, sin
`INC/LLC/THE/&`) y de calle (sin sufijos USPS ni puntos cardinales). No se conservó el script:
los CSV son reproducibles con el mismo criterio a partir de un export nuevo.
