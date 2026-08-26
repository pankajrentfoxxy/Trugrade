'use strict';

const { RuleTester } = require('eslint');
const rule = require('../rules/no-cross-schema-join');

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

ruleTester.run('no-cross-schema-join', rule, {
  valid: [
    {
      name: 'single-schema query',
      code: "const q = `SELECT * FROM listing.unit u JOIN listing.listing l ON l.id = u.listing_id`;",
    },
    {
      name: 'quoted identifiers, still one schema',
      code: 'const q = \'SELECT 1 FROM "qc"."qc_report" r JOIN "qc"."qc_seal" s ON s.unit_id = r.unit_id\';',
    },
    {
      name: 'prose mentioning two schemas is not a join',
      code: "const note = 'procurement owns the PO; payment owns the ledger';",
    },
    {
      name: 'short strings are ignored',
      code: "const t = 'qc.x';",
    },
  ],
  invalid: [
    {
      name: 'listing joined to qc',
      code: "const q = `SELECT * FROM listing.unit u JOIN qc.qc_report r ON r.unit_id = u.id`;",
      errors: [{ messageId: 'crossSchema', data: { schemas: 'listing, qc' } }],
    },
    {
      name: 'ordering joined to procurement',
      code: "const q = 'SELECT o.id FROM ordering.order o LEFT JOIN procurement.purchase_order p ON p.order_id = o.id';",
      errors: [{ messageId: 'crossSchema' }],
    },
    {
      name: 'interpolated template still catches the static schemas',
      code: 'const q = `SELECT * FROM identity.organization o JOIN kyc.gst_profile g ON g.org_id = o.id WHERE o.id = ${id}`;',
      errors: [{ messageId: 'crossSchema' }],
    },
  ],
});
