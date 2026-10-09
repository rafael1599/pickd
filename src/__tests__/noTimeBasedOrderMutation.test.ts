import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Decisión de Rafael (8 oct 2026):
 * «Necesitamos desaparecer este tipo de comportamiento y dejar documentado o poniendo un guard…
 * que cuando se intente hacer algo similar de nuevo nos pare y advierta sobre la decisión de hoy.»
 *
 * Ver .claude/rules/picking.md («Nada se cancela ni se revierte por reloj»).
 */
export const RAFAEL_DECISION_MESSAGE =
  'Rafael, 8 oct 2026: PickD no cancela ni revierte órdenes por tiempo; lo abandonado lo resuelve una persona. Ver .claude/rules/picking.md (“Nada se cancela ni se revierte por reloj”).';

export const TODAY_SIN_AUTOCANCEL_MIGRATION = '20261009035900_sin_autocancel_por_tiempo.sql';

export interface MigrationViolation {
  filename: string;
  line: number;
  rule: 'a' | 'b' | 'c';
  message: string;
}

/**
 * Reemplaza comentarios SQL (-- y /* ... *\/) por espacios preservando los saltos
 * de línea e índices de caracteres para cálculo exacto de número de línea.
 */
export function stripSqlComments(sql: string): string {
  let result = sql.replace(/--[^\r\n]*/g, (match) => ' '.repeat(match.length));
  result = result.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\r\n]/g, ' '));
  return result;
}

export function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/**
 * Regla (a):
 * La última definición de `auto_cancel_stale_orders` (la de esta migración o una posterior)
 * no debe contener UPDATE, INSERT, DELETE o PERFORM en su cuerpo.
 */
export function checkLastAutoCancelStaleOrdersDef(
  migrations: Array<{ filename: string; content: string }>
): MigrationViolation[] {
  const fnRegex =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?auto_cancel_stale_orders\b[\s\S]*?AS\s+(\$[a-zA-Z0-9_]*\$)([\s\S]*?)\1/gi;

  let lastDef: { filename: string; content: string; body: string; index: number } | null = null;

  for (const m of migrations) {
    fnRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = fnRegex.exec(m.content)) !== null) {
      lastDef = {
        filename: m.filename,
        content: m.content,
        body: match[2],
        index: match.index,
      };
    }
  }

  if (!lastDef) {
    return [];
  }

  const strippedBody = stripSqlComments(lastDef.body);
  const mutatingMatch = /\b(UPDATE|INSERT|DELETE|PERFORM)\b/i.exec(strippedBody);
  if (mutatingMatch) {
    const line = getLineNumber(lastDef.content, lastDef.index);
    return [
      {
        filename: lastDef.filename,
        line,
        rule: 'a',
        message: `${RAFAEL_DECISION_MESSAGE} (${lastDef.filename}:${line})`,
      },
    ];
  }

  return [];
}

/**
 * Regla (b):
 * Una migración posterior a la de hoy no debe contener `cron.schedule(` cuyo comando
 * mencione `cancel`, `auto_cancel`, `revert`, `picking_lists` o `status`.
 */
export function checkCronScheduleViolations(
  filename: string,
  content: string
): MigrationViolation[] {
  const stripped = stripSqlComments(content);
  const cronRegex = /cron\.schedule\s*\(/gi;
  const violations: MigrationViolation[] = [];
  let match: RegExpExecArray | null;

  while ((match = cronRegex.exec(stripped)) !== null) {
    const startIndex = match.index;
    const semicolonIndex = stripped.indexOf(';', startIndex);
    const statement =
      semicolonIndex !== -1
        ? stripped.slice(startIndex, semicolonIndex)
        : stripped.slice(startIndex, startIndex + 500);

    if (/(cancel|auto_cancel|revert|picking_lists|status)/i.test(statement)) {
      const line = getLineNumber(content, startIndex);
      violations.push({
        filename,
        line,
        rule: 'b',
        message: `${RAFAEL_DECISION_MESSAGE} (${filename}:${line})`,
      });
    }
  }

  return violations;
}

/**
 * Regla (c):
 * Una migración posterior a la de hoy no debe contener, dentro del mismo statement o
 * bloque plpgsql, un cambio de status en picking_lists y una condición de tiempo.
 *
 * Límites documentados de la heurística:
 * 1. Análisis léxico por regex sobre statements delimitados por ';' y bloques de código plpgsql
 *    delimitados por '$$' / '$tag$'.
 * 2. No construye un Abstract Syntax Tree (AST) completo de PostgreSQL: consultas complejas
 *    con strings concatenados dinámicamente en múltiples variables plpgsql escapan al regex estático.
 * 3. Diseñada para interceptar cambios directos de estado basados en expiración de tiempo (now() - interval,
 *    < now(), updated_at/reopened_at < now()).
 */
export function checkTimeBasedStatusMutationViolations(
  filename: string,
  content: string
): MigrationViolation[] {
  const stripped = stripSqlComments(content);
  const violations: MigrationViolation[] = [];

  const timeConditionRegex =
    /\bnow\(\)\s*-\s*interval\b|<\s*now\(\)|>\s*now\(\)|\bcurrent_timestamp\s*-\s*interval\b|\b(?:updated_at|created_at|reopened_at|last_activity_at)\s*<\s*/i;

  const statusMutationRegex =
    /\bUPDATE\s+(?:public\.)?picking_lists\b[\s\S]*?\bSET\b[\s\S]*?\bstatus\s*=|(?:\bUPDATE\s+(?:public\.)?picking_lists\b[\s\S]*?\bstatus\s*=\s*'(?:cancelled|completed|needs_correction|active)')/i;

  // 1. Extraer bloques $$...$$ o $func$...$func$
  const blockRegex = /\$([a-zA-Z0-9_]*)\$([\s\S]*?)\$\1/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRegex.exec(stripped)) !== null) {
    const blockContent = blockMatch[2];
    if (statusMutationRegex.test(blockContent) && timeConditionRegex.test(blockContent)) {
      const line = getLineNumber(content, blockMatch.index);
      violations.push({
        filename,
        line,
        rule: 'c',
        message: `${RAFAEL_DECISION_MESSAGE} (${filename}:${line})`,
      });
    }
  }

  // 2. Extraer statements individuales delimitados por ';'
  const statements = stripped.split(';');
  let offset = 0;
  for (const stmt of statements) {
    if (statusMutationRegex.test(stmt) && timeConditionRegex.test(stmt)) {
      const line = getLineNumber(content, offset);
      // Evitar duplicar si el bloque entero ya lo reportó en la misma línea
      if (!violations.some((v) => v.line === line && v.rule === 'c')) {
        violations.push({
          filename,
          line,
          rule: 'c',
          message: `${RAFAEL_DECISION_MESSAGE} (${filename}:${line})`,
        });
      }
    }
    offset += stmt.length + 1;
  }

  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests del detector
// ─────────────────────────────────────────────────────────────────────────────

describe('Detector de mutaciones de órdenes por tiempo (pruebas unitarias)', () => {
  it('detecta caso (a): auto_cancel_stale_orders con cuerpo no vacío (UPDATE/INSERT/DELETE/PERFORM)', () => {
    const offendingSql = `
      CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders()
      RETURNS TABLE(id uuid, order_number text, status text)
      LANGUAGE plpgsql
      AS $$
      BEGIN
        UPDATE picking_lists SET status = 'cancelled' WHERE status = 'building';
        RETURN;
      END;
      $$;
    `;

    const violations = checkLastAutoCancelStaleOrdersDef([
      { filename: '20261010000000_bad_auto_cancel.sql', content: offendingSql },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('a');
    expect(violations[0].message).toContain('Rafael, 8 oct 2026');
    expect(violations[0].message).toContain('20261010000000_bad_auto_cancel.sql');
  });

  it('detecta caso (b): cron.schedule posterior que agenda cancelación o toque a picking_lists/status', () => {
    const offendingSql = `
      SELECT cron.schedule(
        'auto_cancel_orders_job',
        '*/1 * * * *',
        'SELECT auto_cancel_stale_orders()'
      );
    `;

    const violations = checkCronScheduleViolations(
      '20261010120000_schedule_cancel.sql',
      offendingSql
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('b');
    expect(violations[0].message).toContain('Rafael, 8 oct 2026');
    expect(violations[0].message).toContain('20261010120000_schedule_cancel.sql');
  });

  it('detecta caso (c): statement posterior con cambio de status en picking_lists y condición de tiempo', () => {
    const offendingSql = `
      UPDATE picking_lists
      SET status = 'cancelled', updated_at = now()
      WHERE status = 'ready_to_double_check'
        AND updated_at < now() - interval '24 hours';
    `;

    const violations = checkTimeBasedStatusMutationViolations(
      '20261010150000_cancel_stale.sql',
      offendingSql
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('c');
    expect(violations[0].message).toContain('Rafael, 8 oct 2026');
    expect(violations[0].message).toContain('20261010150000_cancel_stale.sql');
  });

  it('detecta caso (c) en bloque plpgsql DO $$ con condición de tiempo', () => {
    const offendingBlock = `
      DO $$
      BEGIN
        UPDATE picking_lists
        SET status = 'cancelled'
        WHERE reopened_at < NOW() - INTERVAL '2 hours';
      END;
      $$;
    `;

    const violations = checkTimeBasedStatusMutationViolations(
      '20261010160000_block_cancel.sql',
      offendingBlock
    );

    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].rule).toBe('c');
    expect(violations[0].message).toContain('Rafael, 8 oct 2026');
    expect(violations[0].message).toContain('20261010160000_block_cancel.sql');
  });

  it('permite SQL inocente: auto_cancel vacío, cron para reportes y updates normales', () => {
    const cleanDef = `
      CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders()
      RETURNS TABLE(id uuid, order_number text, status text)
      LANGUAGE plpgsql
      AS $$
      BEGIN
        -- Desactivada: vacía para compatibilidad
        RETURN;
      END;
      $$;
    `;
    const cleanCron = `
      SELECT cron.schedule('nightly-report', '0 2 * * *', 'SELECT generate_daily_snapshot()');
    `;
    const cleanUpdate = `
      UPDATE picking_lists SET status = 'completed' WHERE id = p_order_id;
    `;

    const violationsA = checkLastAutoCancelStaleOrdersDef([
      { filename: '20261009035900_sin_autocancel_por_tiempo.sql', content: cleanDef },
    ]);
    const violationsB = checkCronScheduleViolations('20261010120000_reports.sql', cleanCron);
    const violationsC = checkTimeBasedStatusMutationViolations(
      '20261010120000_finish_order.sql',
      cleanUpdate
    );

    expect(violationsA).toEqual([]);
    expect(violationsB).toEqual([]);
    expect(violationsC).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compuerta de migraciones del repositorio
// ─────────────────────────────────────────────────────────────────────────────

describe('Compuerta de repositorio: nada se cancela ni se revierte por reloj', () => {
  const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

  it('verifica que las migraciones del repositorio cumplan la decisión de Rafael', () => {
    const migrationFiles = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const allMigrations = migrationFiles.map((file) => ({
      filename: file,
      content: readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
    }));

    const allViolations: MigrationViolation[] = [];

    // Regla (a): la última definición de auto_cancel_stale_orders debe estar vacía
    const violationsA = checkLastAutoCancelStaleOrdersDef(allMigrations);
    allViolations.push(...violationsA);

    // Reglas (b) y (c): para migraciones posteriores a la de hoy
    for (const m of allMigrations) {
      if (m.filename > TODAY_SIN_AUTOCANCEL_MIGRATION) {
        allViolations.push(...checkCronScheduleViolations(m.filename, m.content));
        allViolations.push(...checkTimeBasedStatusMutationViolations(m.filename, m.content));
      }
    }

    expect(allViolations).toEqual([]);
  });
});
