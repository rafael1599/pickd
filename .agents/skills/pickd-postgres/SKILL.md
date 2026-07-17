---
name: pickd-postgres
description: Reglas críticas y arquitectónicas de manejo de datos, búsqueda y Supabase/Postgres específicamente para el proyecto Pickd.
---

# Pickd Postgres & Data Fetching Guidelines

Esta skill documenta las decisiones arquitectónicas clave sobre cómo Pickd maneja la búsqueda y carga de datos en Supabase, con el objetivo de proteger el **Egress (Ancho de Banda)** y mantener el rendimiento O(1) de la aplicación a medida que la base de datos crece.

## 1. Anti-Patrón Crítico: Client-Side Filtering (Overfetching)
**NUNCA utilices un `.limit(3000)` seguido de un `.filter()` en JavaScript.**

En Pickd, descargar miles de filas (las cuales contienen JSON pesados en la columna `items` y JOINs con tablas como `customers`) genera un impacto enorme de Egress y destruye el rendimiento en dispositivos móviles.

**❌ Incorrecto:**
```typescript
const { data } = await supabase.from('picking_lists').select('*, customer:customers(*)').limit(3000);
const result = data.filter(o => o.order_number.includes(searchQuery));
```

## 2. Búsqueda Cruzada Dinámica (Server-Side Dual Search)
Para buscar en tablas unidas (ej. buscar texto tanto en `order_number` de `picking_lists` como en `name` de `customers`), utiliza el patrón de **búsqueda en dos pasos** desde el cliente, apoyándote en `.or()` e `.in()`.

**✅ Correcto:**
```typescript
let customerIds: string[] = [];

// 1. Si la búsqueda es de texto, encontrar clientes primero (muy rápido)
if (sq && !/^\d+$/.test(sq)) {
  const { data } = await supabase.from('customers').select('id').ilike('name', `%${sq}%`).limit(20);
  customerIds = data?.map(c => c.id) || [];
}

// 2. Ejecutar la búsqueda principal usando el operador OR combinado con IN
let query = supabase.from('picking_lists').select('...');

if (customerIds.length > 0) {
  query = query.or(`order_number.ilike.%${sq}%,customer_id.in.(${customerIds.join(',')})`);
} else {
  query = query.ilike('order_number', `%${sq}%`);
}

// Mantén siempre un límite bajo (ej. 100 resultados es suficiente para búsquedas)
query = query.limit(100);
```
Este enfoque nos ha permitido **reducir el Egress en un 96%** en `OrdersBoard` aumentando la velocidad 4x.

## 3. Optimización de SELECTs
Evita hacer `SELECT *` cuando no es necesario. Aunque en Pickd varios componentes usan tipados `OrderRow` enteros, siempre que crees una vista nueva de tipo tabla, solicita solo lo estrictamente necesario:
```typescript
// En lugar de select('*')
.select('id, order_number, status, created_at, customer:customers(name)')
```

## 4. Canales Realtime
- Evita suscripciones globales `*` en tablas de alto tráfico si solo necesitas escuchar una porción de la data.
- Si usas `postgres_changes`, asegúrate de limpiar el canal al desmontar el componente (`supabase.removeChannel(channel)`).

## 5. Pruebas y Simulaciones Locales (Local Egress Testing)
Si vas a realizar un cambio en la forma de consultar la base de datos, **valida el Payload de descarga**. 
Existe un script `test-search-perf.ts` en la raíz de Pickd. 
Puedes ejecutarlo con `npx tsx test-search-perf.ts` para comparar la cantidad de MBs transferidos y los milisegundos de ejecución.

Si necesitas probarlo contra data real de producción (replicada localmente), corre el workflow `/sync-local-db` (o `npx supabase db reset` si la base local ya fue "linkeada" correctamente con el dump).
