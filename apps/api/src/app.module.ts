import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { ConfigModule } from './shared/config';
import { ClockModule } from './shared/clock';
import { PrismaModule } from './shared/db/prisma.service';
import { ContextModule } from './shared/db/org-scope';
import { RedisModule } from './shared/redis/redis.service';
import { EventBusModule } from './shared/events/event-bus';
import { AdaptersModule } from './shared/adapters/adapters.module';
import { AuthGuard, PermissionsGuard } from './shared/auth/guards';
import { AuthModule } from './shared/auth/auth.module';
import { DomainExceptionFilter, HttpModule, RequestContextInterceptor } from './shared/http/http';

import { HealthModule } from './platform/health/health.service';
import { JobsModule } from './platform/jobs/integrity.jobs';
import { ObjectsModule } from './platform/objects/objects.controller';

import { IdentityModule } from './modules/identity';
import { KycModule } from './modules/kyc';
import { CustomerModule } from './modules/customer';
import { VendorModule } from './modules/vendor';
import { CatalogModule } from './modules/catalog';
import { ListingModule } from './modules/listing';
import { QcModule } from './modules/qc';
import { OrderingModule } from './modules/ordering';
import { ProcurementModule } from './modules/procurement';
import { PaymentModule } from './modules/payment';
import { LogisticsModule } from './modules/logistics';
import { PlatformModule } from './modules/platform';

@Module({
  imports: [
    // Shared infrastructure. All @Global, so a module never imports them itself.
    ConfigModule,
    ClockModule,
    PrismaModule,
    ContextModule,
    RedisModule,
    EventBusModule,
    AdaptersModule,
    AuthModule,
    HttpModule,

    // Platform plumbing
    HealthModule,
    JobsModule,
    ObjectsModule,

    // The twelve business modules, one per Postgres schema.
    IdentityModule,
    KycModule,
    CustomerModule,
    VendorModule,
    CatalogModule,
    ListingModule,
    QcModule,
    OrderingModule,
    ProcurementModule,
    PaymentModule,
    LogisticsModule,
    PlatformModule,
  ],
  providers: [
    // Order matters: context first (so the filter can report a requestId),
    // then authentication, then permissions.
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
