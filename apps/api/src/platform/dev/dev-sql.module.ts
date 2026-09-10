import { type DynamicModule, Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/db/prisma.service';
import { DevSqlController } from './dev-sql.controller';
import { DevSqlService } from './dev-sql.service';

@Module({})
export class DevSqlModule {
  /** Omitted in production — raw SQL must never be reachable outside local dev. */
  static register(): DynamicModule {
    const enabled = process.env.NODE_ENV !== 'production';
    return {
      module: DevSqlModule,
      imports: [PrismaModule],
      controllers: enabled ? [DevSqlController] : [],
      providers: enabled ? [DevSqlService] : [],
    };
  }
}
