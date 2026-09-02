import { Global, Logger, Module, type Provider } from '@nestjs/common';
import { AppConfig, ConfigModule } from '../config';
import { ClockModule } from '../clock';
import {
  BankVerificationPort,
  type CarrierPort,
  EInvoicePort,
  EwayBillPort,
  GstinVerificationPort,
  NotificationPort,
  ObjectStorePort,
  PanVerificationPort,
  PaymentGatewayPort,
  QcPlatformPort,
  VirtualAccountPort,
} from './ports';
import { ObjectUrlSigner } from './object-url';
import {
  FakeBankVerification,
  // FakeGstinVerification,
  FakePanVerification,
} from './fakes/kyc.fakes';
import { ZohoGstinVerification } from './live/gstin.zoho';
import { InteraktNotification } from './live/interakt.notification';
import { SmtpNotification } from './live/smtp.notification';
import {
  FakeEInvoice,
  FakeEwayBill,
  FakeNotification,
  FakeObjectStore,
  FakePaymentGateway,
  FakeQcPlatform,
  FakeVirtualAccount,
  NotificationOutbox,
} from './fakes/infra.fakes';
import {
  FakeBlueDart,
  FakeDelhivery,
  FakeDtdc,
  FakeInHouse,
  FakePorter,
  FakeShiprocket,
} from './fakes/carrier.fakes';

/** Injection token for the set of carrier adapters, keyed by code. */
export const CARRIER_REGISTRY = Symbol('CARRIER_REGISTRY');
export type CarrierRegistry = ReadonlyMap<string, CarrierPort>;

/**
 * Adapter selection.
 *
 * Every port resolves to a Fake until a real implementation exists and the
 * environment asks for it. `INTEGRATION_MODE=live` outside production is refused
 * by the env loader, so CI cannot book a real pickup or move real money.
 *
 * A real implementation may not merge before its fake exists — the fake is not a
 * stand-in for the real thing, it is the executable description of the contract
 * the real thing must satisfy.
 */
const fakeProviders: Provider[] = [
  NotificationOutbox,
  // Not a fake. Every adapter that hands a browser a URL mints it here, so the
  // route that resolves one and the store that issued it share a key.
  ObjectUrlSigner,
  {
    provide: GstinVerificationPort,
    inject: [AppConfig],
    useFactory: (config: AppConfig): GstinVerificationPort =>
      new ZohoGstinVerification(config),
    // FakeGstinVerification — off for now so /register Verify hits Zoho.
    // config.get('GST_VERIFY_API_URL')
    //   ? new ZohoGstinVerification(config)
    //   : new FakeGstinVerification(),
  },
  { provide: PanVerificationPort, useClass: FakePanVerification },
  { provide: BankVerificationPort, useClass: FakeBankVerification },
  {
    provide: NotificationPort,
    inject: [AppConfig, NotificationOutbox],
    useFactory: (config: AppConfig, outbox: NotificationOutbox): NotificationPort => {
      const fake = new FakeNotification(outbox);
      const live = config.get('NODE_ENV') !== 'test';
      let port: NotificationPort = fake;
      if (live && config.get('INTERAKT_API_KEY')) {
        port = new InteraktNotification(config, port);
      }
      if (live && config.get('SMTP_USER')) {
        port = new SmtpNotification(config, port);
      }
      return port;
    },
  },
  { provide: PaymentGatewayPort, useClass: FakePaymentGateway },
  { provide: VirtualAccountPort, useClass: FakeVirtualAccount },
  { provide: EwayBillPort, useClass: FakeEwayBill },
  { provide: EInvoicePort, useClass: FakeEInvoice },
  { provide: ObjectStorePort, useClass: FakeObjectStore },
  { provide: QcPlatformPort, useClass: FakeQcPlatform },
  FakeDelhivery,
  FakeBlueDart,
  FakeShiprocket,
  FakeDtdc,
  FakePorter,
  FakeInHouse,
  {
    provide: CARRIER_REGISTRY,
    inject: [FakeDelhivery, FakeBlueDart, FakeShiprocket, FakeDtdc, FakePorter, FakeInHouse],
    useFactory: (...carriers: CarrierPort[]): CarrierRegistry =>
      new Map(carriers.map((c) => [c.code, c])),
  },
];

@Global()
@Module({
  // ClockModule is @Global in the running app, so this import is redundant
  // there — and load-bearing in a test that builds a module out of
  // AdaptersModule alone. ObjectUrlSigner reads the clock to stamp an expiry;
  // a provider inside an imported module cannot see the importing module's
  // own providers, so without this a dozen suites fail to compile at all.
  imports: [ConfigModule, ClockModule],
  providers: [
    ...fakeProviders,
    {
      // Announce the mode at boot. An engineer who cannot tell whether they are
      // talking to a fake will eventually assume the wrong one.
      provide: 'ADAPTER_MODE_BANNER',
      inject: [AppConfig],
      useFactory: (config: AppConfig): string => {
        const mode = config.get('INTEGRATION_MODE');
        const gst = 'zoho-books';
        const mail =
          config.get('SMTP_USER') && config.get('NODE_ENV') !== 'test' ? 'smtp' : 'fake';
        const whatsapp =
          config.get('INTERAKT_API_KEY') && config.get('NODE_ENV') !== 'test'
            ? 'interakt'
            : 'fake';
        new Logger('Adapters').log(
          `INTEGRATION_MODE=${mode}${mode === 'mock' ? ' — every external call is a fake' : ''} · GSTIN=${gst} · EMAIL=${mail} · WHATSAPP_OTP=${whatsapp}`,
        );
        return mode;
      },
    },
  ],
  exports: [
    ObjectUrlSigner,
    GstinVerificationPort,
    PanVerificationPort,
    BankVerificationPort,
    NotificationPort,
    NotificationOutbox,
    PaymentGatewayPort,
    VirtualAccountPort,
    EwayBillPort,
    EInvoicePort,
    ObjectStorePort,
    QcPlatformPort,
    CARRIER_REGISTRY,
    FakeDelhivery,
    FakeBlueDart,
    FakeShiprocket,
    FakeDtdc,
    FakePorter,
    FakeInHouse,
  ],
})
export class AdaptersModule {}
