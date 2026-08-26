import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfig } from './shared/config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(AppConfig);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());

  // The storefront and console are separate origins; nothing else may call us
  // with credentials. The admin console must not be reachable from the public
  // origin (02_ARCHITECTURE.md §1.2).
  app.enableCors({
    origin: [config.get('STOREFRONT_URL'), config.get('CONSOLE_URL')],
    credentials: true,
    maxAge: 600,
  });

  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  // No global class-validator pipe. Validation is the shared Zod schema out of
  // @trugrade/contracts, applied per endpoint with ZodValidationPipe — VR-META-01
  // requires the client schema and the DTO validator to be the identical
  // constant, and two validation systems cannot satisfy that.
  app.enableShutdownHooks();

  const port = config.get('API_PORT');
  await app.listen(port);
  new Logger('Bootstrap').log(`Trugrade API listening on :${port} (${config.get('NODE_ENV')})`);
}

void bootstrap();
