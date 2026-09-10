import { Injectable } from '@nestjs/common';
import { normalisePincode } from '@trugrade/contracts';
import { PincodeLookupPort, type PincodeLookupData } from '../../../shared/adapters/ports';
import { NotFoundError, ProviderError, ValidationError } from '../../../shared/errors/domain-errors';

export type PincodeLookupView = PincodeLookupData;

@Injectable()
export class PincodeLookupService {
  constructor(private readonly lookup: PincodeLookupPort) {}

  async resolve(rawPincode: string): Promise<PincodeLookupView> {
    const pincode = normalisePincode(rawPincode);
    if (!pincode) {
      throw new ValidationError('Enter a valid 6-digit PIN code.', {
        pincode: 'Enter a valid 6-digit PIN code.',
      });
    }

    const result = await this.lookup.lookup(pincode);

    if (result.outcome === 'PROVIDER_ERROR') {
      throw new ProviderError(result.provider, { pincode }, false);
    }

    if (result.outcome === 'NOT_FOUND' || !result.data) {
      throw new NotFoundError(
        result.message ?? 'That pincode is not in the India Post directory. Check the six digits.',
      );
    }

    return result.data;
  }
}
