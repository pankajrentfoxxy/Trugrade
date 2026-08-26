import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config';
import { ClockModule } from '../clock';
import { RedisModule } from '../redis/redis.service';
import { ContextModule } from '../db/org-scope';
import { TokenService } from './token.service';
import { AuthGuard, PermissionsGuard } from './guards';

/**
 * Auth primitives, global because the guards are registered app-wide via
 * APP_GUARD and Nest resolves those in whichever module declares them — so the
 * dependencies have to be visible everywhere, not just where they were defined.
 */
@Global()
@Module({
  imports: [ConfigModule, ClockModule, RedisModule, ContextModule],
  providers: [TokenService, AuthGuard, PermissionsGuard],
  exports: [TokenService, AuthGuard, PermissionsGuard],
})
export class AuthModule {}
