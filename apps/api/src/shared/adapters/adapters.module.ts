import { Global, Logger, Module, type Provider } from '@nestjs/common';
import { AppConfig, ConfigModule } from '../config';
import {
  BankVerificationPort,
  CarrierPort,
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
import { FakeBankVerification, FakeGstinVerification, FakePanVerification } from './fakes/kyc.fakes';
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
  { provide: GstinVerificationPort, useClass: FakeGstinVerification },
  { provide: PanVerificationPort, useClass: FakePanVerification },
  { provide: BankVerificationPort, useClass: FakeBankVerification },
  { provide: NotificationPort, useClass: FakeNotification },
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
  imports: [ConfigModule],
  providers: [
    ...fakeProviders,
    {
      // Announce the mode at boot. An engineer who cannot tell whether they are
      // talking to a fake will eventually assume the wrong one.
      provide: 'ADAPTER_MODE_BANNER',
      inject: [AppConfig],
      useFactory: (config: AppConfig): string => {
        const mode = config.get('INTEGRATION_MODE');
        new Logger('Adapters').log(
          `INTEGRATION_MODE=${mode}${mode === 'mock' ? ' — every external call is a fake' : ''}`,
        );
        return mode;
      },
    },
  ],
  exports: [
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
