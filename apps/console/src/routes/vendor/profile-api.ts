/** Browser types for GET /api/account/profile — copied from the API allow-list. */

export const API = '/api';

export interface RegisteredAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface OrgProfile {
  fullName: string;
  email: string | null;
  mobile: string | null;
  jobTitle: string | null;
  orgType: 'BUYER' | 'VENDOR';
  legalName: string;
  tradeName: string | null;
  constitution: string | null;
  status: string;
  website: string | null;
  employeeCountBand: string | null;
  annualTurnoverBand: string | null;
  industry: string | null;
  businessCategory: string | null;
  gstin: string | null;
  gstLegalName: string | null;
  pan: string | null;
  panName: string | null;
  panVerified: boolean;
  registeredAddress: RegisteredAddress | null;
}
