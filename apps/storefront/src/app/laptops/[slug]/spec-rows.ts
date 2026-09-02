import type { SkuDetail } from '../../../lib/api';

export function specLine(sku: SkuDetail): string {
  return [
    sku.cpuModel,
    `${sku.ramGb} GB`,
    `${sku.storageGb} GB ${sku.storageType.replace('_', ' ')}`,
    `${sku.screenSizeIn}"`,
  ].join(' · ');
}

export function specRows(sku: SkuDetail): Array<[string, string]> {
  return [
    ['Processor', `${sku.cpuBrand} ${sku.cpuModel} · ${sku.cpuGeneration} gen`],
    ['Memory', `${sku.ramGb} GB`],
    ['Storage', `${sku.storageGb} GB ${sku.storageType.replace('_', ' ')}`],
    ['Graphics', sku.gpuModel ? `${sku.gpuType} · ${sku.gpuModel}` : sku.gpuType],
    [
      'Screen',
      `${sku.screenSizeIn}" ${sku.resolution}${sku.isTouch ? ' · touch' : ''}`,
    ],
    ['Operating system', sku.osSupported],
    ['Series', `${sku.brandName} ${sku.seriesName}`],
    ['SKU code', sku.skuCode],
    ['HSN', sku.hsnCode],
  ];
}
