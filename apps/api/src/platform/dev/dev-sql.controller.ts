import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import { devSqlBodySchema, type DevSqlBodyDto } from './dev-sql.dto';
import { DevSqlService, type DevSqlResult } from './dev-sql.service';

/**
 * Local SQL console — **development only**.
 *
 * Sends raw SQL to Postgres and returns rows or an affected-row count. The route
 * is not registered when `NODE_ENV=production`.
 */
@Controller('dev/sql')
export class DevSqlController {
  constructor(private readonly devSql: DevSqlService) {}

  @Public()
  @Post()
  @HttpCode(200)
  query(@Body(new ZodValidationPipe(devSqlBodySchema)) body: DevSqlBodyDto): Promise<DevSqlResult> {
    return this.devSql.run(body.query);
  }
}
