import { Injectable } from '@nestjs/common';
import { ValidationError } from '../../shared/errors/domain-errors';
import { PrismaService } from '../../shared/db/prisma.service';

export interface DevSqlResult {
  command: string;
  rowCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
  executedInMs: number;
}

const READ_COMMANDS = new Set(['SELECT', 'WITH', 'SHOW', 'EXPLAIN', 'TABLE']);

function serializeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === 'object') return serializeRow(value as Record<string, unknown>);
  return value;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = serializeValue(value);
  }
  return out;
}

@Injectable()
export class DevSqlService {
  constructor(private readonly prisma: PrismaService) {}

  async run(query: string): Promise<DevSqlResult> {
    const trimmed = query.trim();
    const command = (trimmed.match(/^([A-Za-z]+)/)?.[1] ?? '').toUpperCase();
    if (!command) {
      throw new ValidationError('Could not read a SQL command from that text.', {
        query: 'Start with SELECT, INSERT, UPDATE, or another SQL keyword.',
      });
    }

    const started = Date.now();
    const read = READ_COMMANDS.has(command);

    try {
      if (read) {
        const raw = await this.prisma.$queryRawUnsafe(trimmed);
        const rows = Array.isArray(raw)
          ? raw.map((row) => serializeRow(row as Record<string, unknown>))
          : [serializeRow({ result: raw } as Record<string, unknown>)];
        return {
          command,
          rowCount: rows.length,
          columns: rows[0] ? Object.keys(rows[0]) : [],
          rows,
          executedInMs: Date.now() - started,
        };
      }

      const affected = await this.prisma.$executeRawUnsafe(trimmed);
      return {
        command,
        rowCount: affected,
        columns: [],
        rows: [],
        executedInMs: Date.now() - started,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The database refused that query.';
      throw new ValidationError(message, { query: message });
    }
  }
}
