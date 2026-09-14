import { type DynamicModule, Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { DevSqlController } from './dev-sql.controller';
import { DevSqlService } from './dev-sql.service';

/**
 * The exact value that turns the raw-SQL console on. A sentence, not `true`,
 * so it can only be set by someone who read what it does.
 */
export const DEV_SQL_CONSOLE_OPT_IN = 'i-understand-this-runs-arbitrary-sql';

/**
 * Fail closed. This used to be `NODE_ENV !== 'production'`, which made an unset
 * or mistyped NODE_ENV enough to publish an unauthenticated INSERT/UPDATE/DROP
 * endpoint — and on 2026-09 the live API ran with NODE_ENV=development, so it
 * did. An unset variable must never enable raw SQL.
 */
export function isDevSqlConsoleEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.DEV_SQL_CONSOLE === DEV_SQL_CONSOLE_OPT_IN && env.NODE_ENV !== 'production';
}

@Module({})
export class DevSqlModule {
  static register(env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const enabled = isDevSqlConsoleEnabled(env);
    return {
      module: DevSqlModule,
      imports: [PrismaModule],
      controllers: enabled ? [DevSqlController] : [],
      providers: enabled ? [DevSqlService] : [],
    };
  }
}
