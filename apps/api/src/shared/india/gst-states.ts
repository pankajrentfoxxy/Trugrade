/**
 * GST state code to state name.
 *
 * `identity.org_address.state` is `TEXT NOT NULL` and the registration screens
 * only ever collect the **code** — it is the first two characters of a GSTIN and
 * the thing every cross-check compares. So something has to turn "06" into
 * "Haryana" before a row can be written, and that something must not guess: a
 * wrong state name on an address is a wrong place of supply, which is the wrong
 * tax split on every invoice raised against it.
 *
 * Reported gap, not fixed here: this list also lives in
 * `apps/storefront/src/app/register/picklists.ts` and as an eight-entry private
 * lookup inside `VerificationService`. It belongs in `@trugrade/contracts`
 * beside `stateCodeFromGstin`, which is another package's file.
 *
 * 25 (Daman and Diu) and 28 (undivided Andhra Pradesh) are absent deliberately.
 * Both were withdrawn and merged, and nobody can hold a live registration in
 * either — an address claiming one is a data-entry error worth refusing rather
 * than a state worth naming.
 */
const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other territory',
};

/** The state's name, or `undefined` for a code no live registration can carry. */
export const gstStateName = (code: string): string | undefined =>
  GST_STATE_NAMES[code.trim()];
