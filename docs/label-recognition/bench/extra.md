# R6 · chequeos extra (extra_checks.py)

## Texto blanco sobre negro

| motor                   | modelo en caja negra (9) | SKU en caja negra (10) |
| ----------------------- | ------------------------ | ---------------------- |
| easyocr_en_1280         | 4/9                      | 8/10                   |
| rapidocr3_v5mobile_2000 | 7/9                      | 8/10                   |
| rapidocr3_v6medium_2000 | 8/9                      | 8/10                   |
| rapidocr3_v6small_2000  | 7/9                      | 8/10                   |
| rapidocr_v4_2000        | 8/9                      | 7/10                   |
| rapidocr_v4_4000        | 7/9                      | 7/10                   |

## Confusiones de glifo (sustituciones en lecturas a <=2 ediciones de igual longitud)

| verdad → lectura | veces (todas las corridas OCR) | ejemplos                                                                                                    |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `I` → `1`        | 10                             | 13:serial `M21I014353`→`M211014353`; 3a:frame_A `WMEI00065`→`WME100065`; 3b:frame_A `WMEI00065`→`VME100065` |
| `9` → `3`        | 5                              | 3a:sku `034149BR`→`034143BR`; 3a:sku `034149BR`→`034143FR`                                                  |
| `B` → `F`        | 4                              | 3a:sku `034149BR`→`034143FR`                                                                                |
| `8` → `9`        | 4                              | 12:gtin `00845436087757`→`00845436097757`; 12:upc `845436087757`→`845436097757`                             |
| `W` → `V`        | 2                              | 3b:frame_A `WMEI00065`→`VME100065`; 3b:frame_A `WMEI00065`→`VMEI00065`                                      |
| `0` → `O`        | 1                              | 5:frame_A `WMCJ00296`→`WMCJO0296`                                                                           |
| `9` → `5`        | 1                              | 6:gtin `00845436088099`→`00845436088059`                                                                    |
| `U` → `0`        | 1                              | 9:serial `U226U03952`→`U226003952`                                                                          |
| `5` → `0`        | 1                              | 12:upc `845436087757`→`840436007757`                                                                        |
| `8` → `0`        | 1                              | 12:upc `845436087757`→`840436007757`                                                                        |

Desplazamientos (misma longitud por casualidad, no son sustituciones de glifo): 1:upc `845436092959`→`845436109295`; 5:upc `845436089485`→`454361089485`; 7:upc `845436086545`→`454361086545`; 7:upc `845436086545`→`845436108654`

## Film plastico / cinta encima (3a, 3b, 8): aciertos exactos por campo

| motor                   | SKU | UPC | G.W. |
| ----------------------- | --- | --- | ---- |
| zxing_union             | 1/3 | 1/3 | 0/3  |
| easyocr_en_1280         | 1/3 | 1/3 | 2/3  |
| rapidocr3_v5mobile_2000 | 1/3 | 1/3 | 3/3  |
| rapidocr3_v6medium_2000 | 1/3 | 1/3 | 2/3  |
| rapidocr3_v6small_2000  | 1/3 | 1/3 | 2/3  |
| rapidocr_v4_2000        | 1/3 | 1/3 | 2/3  |
| rapidocr_v4_4000        | 1/3 | 1/3 | 2/3  |

## Regla G.W. − N.W. = 3,90 (tipo B) sobre lo que leyo cada OCR

- foto 6 (verdad GW 20.30): easyocr_en_1280: [16.4] · rapidocr3_v5mobile_2000: [16.1] · rapidocr3_v6medium_2000: [16.4, 20.2] · rapidocr3_v6small_2000: [16.1] · rapidocr_v4_2000: [16.4, 20.2] · rapidocr_v4_4000: [16.4, 20.2]
- foto 8 (verdad GW 17.80): easyocr_en_1280: [17.8] · rapidocr3_v5mobile_2000: [13.9, 17.8] · rapidocr3_v6medium_2000: [3.9, 17.8] · rapidocr3_v6small_2000: [17.8] · rapidocr_v4_2000: [17.8] · rapidocr_v4_4000: [3.9, 17.8]
- foto 12 (verdad GW 19.60): easyocr_en_1280: [15.8, 19.6] · rapidocr3_v5mobile_2000: [15.8, 19.6] · rapidocr3_v6medium_2000: [15.8, 19.6] · rapidocr3_v6small_2000: [15.8, 19.6] · rapidocr_v4_2000: [15.8, 19.6] · rapidocr_v4_4000: [15.8, 19.6]
