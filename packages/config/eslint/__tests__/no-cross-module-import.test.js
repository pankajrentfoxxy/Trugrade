'use strict';

const { RuleTester } = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const rule = require('../rules/no-cross-module-import');

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' },
});

const F = (mod, file = 'thing.service.ts') => `/repo/apps/api/src/modules/${mod}/${file}`;

ruleTester.run('no-cross-module-import', rule, {
  valid: [
    {
      name: 'the public barrel by alias path is the sanctioned route',
      filename: F('ordering'),
      code: "import { IListingService } from 'src/modules/listing';",
    },
    {
      name: 'the public barrel by relative path',
      filename: F('ordering'),
      code: "import { IQcService } from '../qc';",
    },
    {
      name: 'an explicit index file is still the barrel',
      filename: F('procurement'),
      code: "import { IPaymentService } from '../payment/index';",
    },
    {
      name: 'reaching into your own module is always fine',
      filename: F('qc', 'internal/qc.repository.ts'),
      code: "import { toleranceFor } from './tolerance';\nimport { QcReportRow } from '../entities/qc-report';",
    },
    {
      name: 'shared infrastructure is not a module',
      filename: F('payment'),
      code: "import { PrismaService } from '../../shared/db/prisma.service';\nimport { EventBus } from 'src/shared/events';",
    },
    {
      name: 'third-party packages are untouched',
      filename: F('logistics'),
      code: "import { Injectable } from '@nestjs/common';\nimport { z } from 'zod';",
    },
    {
      name: 'files outside modules/ are out of scope entirely',
      filename: '/repo/apps/api/src/shared/db/prisma.service.ts',
      code: "import { UnitRepository } from '../../modules/listing/internal/unit.repository';",
    },
  ],
  invalid: [
    {
      name: "reaching another module's repository layer",
      filename: F('ordering'),
      code: "import { UnitRepository } from '../listing/internal/unit.repository';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      name: "reaching another module's entities",
      filename: F('procurement'),
      code: "import type { Unit } from 'src/modules/listing/entities/unit';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      name: "reaching another module's private DTOs",
      filename: F('storefrontless', 'x.ts').replace('storefrontless', 'catalog'),
      code: "import { QcReportDto } from '../qc/dto/qc-report.dto';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      name: 'importing the service file directly instead of the barrel',
      filename: F('payment'),
      code: "import { ProcurementService } from '../procurement/procurement.service';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      name: 're-exporting across the seam is the same violation',
      filename: F('platform'),
      code: "export { Warranty } from '../listing/internal/warranty.repository';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      name: 'export * across the seam',
      filename: F('platform'),
      code: "export * from '../qc/internal/seal.repository';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      name: 'dynamic import does not launder the violation',
      filename: F('ordering'),
      code: "const r = () => import('../procurement/internal/po.repository');",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      name: 'require() does not launder it either',
      filename: F('qc'),
      code: "const repo = require('../listing/internal/unit.repository');",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      name: 'deep hop back up through modules/ is resolved, not fooled',
      filename: F('kyc', 'internal/deep/nested/file.ts'),
      code: "import x from '../../../../vendor/internal/vendor.repository';",
      errors: [{ messageId: 'deepImport' }],
    },
  ],
});

// RuleTester.run registers describe/it blocks itself; nothing further to assert.
