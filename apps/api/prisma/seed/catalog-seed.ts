import type { PrismaClient } from '@prisma/client';
import {
  CONDITION_VIEW_CODES,
  GRADES,
  REQUIRED_VIEWS,
  coverageGaps,
  isPublishable,
  parseSkuCsv,
  type ConditionImage,
  type ConditionViewCode,
  type Grade,
  type SkuImportColumn,
  type SkuImportRow,
  SKU_IMPORT_COLUMNS,
} from '@trugrade/contracts';

/**
 * The 200-SKU catalog and its condition-image library (Phase 2, exit criteria 1
 * and 2).
 *
 * Two decisions are load-bearing here and neither is obvious from the output.
 *
 * **The rows go through the importer.** They are rendered to CSV and handed to
 * `parseSkuCsv` — the same function ops' spreadsheet goes through — rather than
 * being INSERTed from the table below directly. That costs a serialise/parse
 * round trip nobody sees, and it buys the one guarantee the phase is about: the
 * seeded catalog and an imported catalog cannot diverge, because there is no
 * second path to diverge on. A generator that emits a row the importer would
 * reject fails the seed loudly instead of putting a row in the database that
 * ops could never have produced.
 *
 * **The images are anchored at MODEL level.** `chk_condition_one_anchor` allows
 * exactly one of sku/model/series, and a SKU-level set would need 200 × 19
 * photographs where the configuration makes no visual difference — a 16 GB
 * Latitude 5420 and a 32 GB one are the same machine to a camera. Model level is
 * where the resolution order finds them (step 2) and where a real photo shoot
 * happens.
 */

interface Cpu {
  family: string;
  gen: string;
  cores: number;
  threads: number;
  brand?: string;
}

/**
 * Keyed by the exact `cpu_model` string, so a model row names a chip once and
 * the core counts the QC spec-match compares against come from one place.
 */
const CPUS: Record<string, Cpu> = {
  'i3-1115G4': { family: 'Core i3', gen: '11th', cores: 2, threads: 4 },
  'i5-1035G1': { family: 'Core i5', gen: '10th', cores: 4, threads: 8 },
  'i5-1035G4': { family: 'Core i5', gen: '10th', cores: 4, threads: 8 },
  'i5-10210U': { family: 'Core i5', gen: '10th', cores: 4, threads: 8 },
  'i5-1135G7': { family: 'Core i5', gen: '11th', cores: 4, threads: 8 },
  'i5-1145G7': { family: 'Core i5', gen: '11th', cores: 4, threads: 8 },
  'i5-1155G7': { family: 'Core i5', gen: '11th', cores: 4, threads: 8 },
  'i5-11400H': { family: 'Core i5', gen: '11th', cores: 6, threads: 12 },
  'i7-10510U': { family: 'Core i7', gen: '10th', cores: 4, threads: 8 },
  'i7-1065G7': { family: 'Core i7', gen: '10th', cores: 4, threads: 8 },
  'i7-1165G7': { family: 'Core i7', gen: '11th', cores: 4, threads: 8 },
  'i7-1185G7': { family: 'Core i7', gen: '11th', cores: 4, threads: 8 },
  'i7-1195G7': { family: 'Core i7', gen: '11th', cores: 4, threads: 8 },
  'i7-11800H': { family: 'Core i7', gen: '11th', cores: 8, threads: 16 },
  'Ryzen 5 5500U': { brand: 'AMD', family: 'Ryzen 5', gen: '5000', cores: 6, threads: 12 },
  'Ryzen 7 5700U': { brand: 'AMD', family: 'Ryzen 7', gen: '5000', cores: 8, threads: 16 },
  'Ryzen 7 5800HS': { brand: 'AMD', family: 'Ryzen 7', gen: '5000', cores: 8, threads: 16 },
  'Ryzen 9 5900HS': { brand: 'AMD', family: 'Ryzen 9', gen: '5000', cores: 8, threads: 16 },
  M1: { brand: 'Apple', family: 'Apple M1', gen: 'M1', cores: 8, threads: 8 },
  'M1 Pro': { brand: 'Apple', family: 'Apple M1 Pro', gen: 'M1', cores: 8, threads: 8 },
  'M1 Max': { brand: 'Apple', family: 'Apple M1 Max', gen: 'M1', cores: 10, threads: 10 },
};

/** `[ram_gb, storage_gb, storage_type?]` — the override carries the eMMC entries. */
type Config = [number, number, string?];

interface ModelRow {
  brand: string;
  series: string;
  name: string;
  /** The middle segment of `sku_code`. Short, stable, and what ops types. */
  code: string;
  year: number;
  form: string;
  screen: number;
  res: string;
  msrp: number;
  cpus: string[];
  configs: Config[];
  touch?: boolean;
  os?: string;
  panel?: string;
  gpuType?: string;
  gpuModel?: string;
  storageType?: string;
  ramType?: string;
  ramSlots?: number;
  ramMax?: number;
  storageSlots?: number;
  weightKg?: number;
  batteryWh?: number;
  chargerW?: number;
  wifi?: string;
  bt?: string;
  backlit?: boolean;
  fingerprint?: boolean;
  webcamMp?: number;
  ports?: string[];
}

/**
 * The defaults are the mid-range Intel business laptop, because two thirds of
 * the table is one. A row names only what makes it a different machine, which
 * is what keeps 32 real models readable as a table rather than a wall.
 */
const DEFAULTS = {
  os: 'Windows 11 Pro',
  panel: 'IPS',
  gpuType: 'INTEGRATED',
  gpuModel: 'Intel Iris Xe',
  storageType: 'NVME_SSD',
  ramType: 'DDR4',
  ramSlots: 2,
  ramMax: 64,
  storageSlots: 1,
  weightKg: 1.4,
  batteryWh: 53,
  chargerW: 65,
  wifi: 'Wi-Fi 6 (802.11ax)',
  bt: '5.1',
  backlit: true,
  fingerprint: true,
  webcamMp: 0.9,
  touch: false,
  ports: ['USB-A 3.2 Gen 1 x2', 'Thunderbolt 4 x2', 'HDMI 2.0', '3.5 mm combo'],
} as const;

export const MODELS: ModelRow[] = [
  // --- Dell ---------------------------------------------------------------
  {
    brand: 'Dell',
    series: 'Latitude',
    name: 'Latitude 5420',
    code: 'LAT5420',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 98000,
    cpus: ['i5-1135G7', 'i5-1145G7', 'i7-1185G7'],
    configs: [
      [8, 256],
      [16, 256],
      [16, 512],
      [32, 512],
    ],
  },
  {
    brand: 'Dell',
    series: 'Latitude',
    name: 'Latitude 7420',
    code: 'LAT7420',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 132000,
    weightKg: 1.3,
    batteryWh: 63,
    cpus: ['i5-1145G7', 'i7-1185G7'],
    configs: [
      [16, 256],
      [16, 512],
      [32, 512],
    ],
  },
  {
    brand: 'Dell',
    series: 'Latitude',
    name: 'Latitude 3420',
    code: 'LAT3420',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 62000,
    backlit: false,
    fingerprint: false,
    batteryWh: 42,
    gpuModel: 'Intel UHD Graphics',
    cpus: ['i3-1115G4', 'i5-1135G7'],
    configs: [
      [8, 256],
      [8, 512],
      [16, 512],
    ],
  },
  {
    brand: 'Dell',
    series: 'XPS',
    name: 'XPS 13 9310',
    code: 'XPS139310',
    year: 2020,
    form: 'BUSINESS_ULTRABOOK',
    screen: 13.3,
    res: 'FHD',
    msrp: 154000,
    weightKg: 1.2,
    batteryWh: 52,
    chargerW: 45,
    ports: ['Thunderbolt 4 x2', 'microSD', '3.5 mm combo'],
    cpus: ['i5-1135G7', 'i7-1185G7'],
    configs: [
      [8, 256],
      [16, 512],
      [32, 1024],
    ],
  },
  {
    brand: 'Dell',
    series: 'Precision',
    name: 'Precision 3560',
    code: 'PRE3560',
    year: 2021,
    form: 'WORKSTATION',
    screen: 15.6,
    res: 'FHD',
    msrp: 168000,
    weightKg: 1.8,
    batteryWh: 68,
    chargerW: 90,
    gpuType: 'DISCRETE',
    gpuModel: 'NVIDIA T500 4GB',
    ramMax: 64,
    storageSlots: 2,
    cpus: ['i5-1145G7', 'i7-1185G7'],
    configs: [
      [16, 512],
      [32, 512],
      [32, 1024],
    ],
  },

  // --- Lenovo -------------------------------------------------------------
  {
    brand: 'Lenovo',
    series: 'ThinkPad',
    name: 'ThinkPad T14 Gen 2',
    code: 'T14G2',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 124000,
    batteryWh: 50,
    cpus: ['i5-1135G7', 'i5-1145G7', 'i7-1165G7'],
    configs: [
      [8, 256],
      [16, 256],
      [16, 512],
      [32, 1024],
    ],
  },
  {
    brand: 'Lenovo',
    series: 'ThinkPad',
    name: 'ThinkPad X1 Carbon Gen 9',
    code: 'X1C9',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 186000,
    weightKg: 1.13,
    batteryWh: 57,
    ramSlots: 0,
    ramMax: 32,
    ramType: 'LPDDR4X',
    cpus: ['i5-1135G7', 'i7-1165G7'],
    configs: [
      [8, 256],
      [16, 512],
      [16, 1024],
    ],
  },
  {
    brand: 'Lenovo',
    series: 'ThinkPad',
    name: 'ThinkPad L14 Gen 2',
    code: 'L14G2',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 86000,
    batteryWh: 45,
    gpuModel: 'Intel UHD Graphics',
    cpus: ['i5-1135G7', 'i7-1165G7'],
    configs: [
      [8, 256],
      [16, 256],
      [16, 512],
    ],
  },
  {
    brand: 'Lenovo',
    series: 'ThinkPad',
    name: 'ThinkPad E14 Gen 3',
    code: 'E14G3',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 74000,
    batteryWh: 45,
    gpuModel: 'AMD Radeon Graphics',
    ports: ['USB-A 3.2 Gen 1 x2', 'USB-C 3.2 Gen 2 x2', 'HDMI 2.0', '3.5 mm combo'],
    cpus: ['Ryzen 5 5500U', 'Ryzen 7 5700U'],
    configs: [
      [8, 256],
      [8, 512],
      [16, 512],
    ],
  },
  {
    brand: 'Lenovo',
    series: 'ThinkBook',
    name: 'ThinkBook 14 G3 ACL',
    code: 'TB14G3',
    year: 2021,
    form: 'CONSUMER',
    screen: 14,
    res: 'FHD',
    msrp: 68000,
    batteryWh: 45,
    fingerprint: true,
    gpuModel: 'AMD Radeon Graphics',
    ports: ['USB-A 3.2 Gen 1 x2', 'USB-C 3.2 Gen 1', 'HDMI 1.4b', '3.5 mm combo'],
    cpus: ['Ryzen 5 5500U', 'Ryzen 7 5700U'],
    configs: [
      [8, 512],
      [16, 512],
    ],
  },

  // --- HP -----------------------------------------------------------------
  {
    brand: 'HP',
    series: 'EliteBook',
    name: 'EliteBook 840 G8',
    code: 'EB840G8',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 118000,
    weightKg: 1.32,
    batteryWh: 53,
    cpus: ['i5-1135G7', 'i5-1145G7', 'i7-1165G7'],
    configs: [
      [8, 256],
      [16, 256],
      [16, 512],
      [32, 512],
    ],
  },
  {
    brand: 'HP',
    series: 'EliteBook',
    name: 'EliteBook x360 1040 G8',
    code: 'EB1040G8',
    year: 2021,
    form: '2_IN_1',
    screen: 14,
    res: 'FHD',
    msrp: 178000,
    touch: true,
    weightKg: 1.35,
    batteryWh: 56,
    ramSlots: 0,
    ramMax: 32,
    ramType: 'LPDDR4X',
    cpus: ['i5-1145G7', 'i7-1185G7'],
    configs: [
      [16, 256],
      [16, 512],
      [32, 1024],
    ],
  },
  {
    brand: 'HP',
    series: 'ProBook',
    name: 'ProBook 450 G8',
    code: 'PB450G8',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 15.6,
    res: 'FHD',
    msrp: 76000,
    weightKg: 1.74,
    batteryWh: 45,
    fingerprint: false,
    cpus: ['i3-1115G4', 'i5-1135G7', 'i7-1165G7'],
    configs: [
      [8, 256],
      [8, 512],
      [16, 512],
    ],
  },
  {
    brand: 'HP',
    series: 'ProBook',
    name: 'ProBook 440 G8',
    code: 'PB440G8',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 70000,
    batteryWh: 45,
    fingerprint: false,
    cpus: ['i3-1115G4', 'i5-1135G7', 'i7-1165G7'],
    configs: [
      [8, 256],
      [8, 512],
      [16, 512],
    ],
  },
  {
    brand: 'HP',
    series: 'ZBook',
    name: 'ZBook Firefly 14 G8',
    code: 'ZBFF14G8',
    year: 2021,
    form: 'WORKSTATION',
    screen: 14,
    res: 'FHD',
    msrp: 192000,
    weightKg: 1.35,
    batteryWh: 53,
    chargerW: 65,
    gpuType: 'DISCRETE',
    gpuModel: 'NVIDIA T500 4GB',
    cpus: ['i5-1145G7', 'i7-1185G7'],
    configs: [
      [16, 512],
      [32, 1024],
    ],
  },

  // --- Apple --------------------------------------------------------------
  {
    brand: 'Apple',
    series: 'MacBook Air',
    name: 'MacBook Air M1',
    code: 'MBAM1',
    year: 2020,
    form: 'CONSUMER',
    screen: 13.3,
    res: 'RETINA',
    msrp: 99900,
    os: 'macOS Sonoma',
    panel: 'Retina IPS',
    gpuModel: 'Apple M1 7-core GPU',
    ramType: 'LPDDR4X unified',
    ramSlots: 0,
    ramMax: 16,
    storageSlots: 0,
    weightKg: 1.29,
    batteryWh: 49,
    chargerW: 30,
    wifi: 'Wi-Fi 6 (802.11ax)',
    fingerprint: true,
    webcamMp: 0.9,
    ports: ['Thunderbolt / USB 4 x2', '3.5 mm headphone'],
    cpus: ['M1'],
    configs: [
      [8, 256],
      [8, 512],
      [16, 256],
      [16, 512],
    ],
  },
  {
    brand: 'Apple',
    series: 'MacBook Pro',
    name: 'MacBook Pro 13 M1',
    code: 'MBP13M1',
    year: 2020,
    form: 'CONSUMER',
    screen: 13.3,
    res: 'RETINA',
    msrp: 122900,
    os: 'macOS Sonoma',
    panel: 'Retina IPS',
    gpuModel: 'Apple M1 8-core GPU',
    ramType: 'LPDDR4X unified',
    ramSlots: 0,
    ramMax: 16,
    storageSlots: 0,
    weightKg: 1.4,
    batteryWh: 58,
    chargerW: 61,
    ports: ['Thunderbolt / USB 4 x2', '3.5 mm headphone'],
    cpus: ['M1'],
    configs: [
      [8, 256],
      [8, 512],
      [16, 512],
      [16, 1024],
    ],
  },
  {
    brand: 'Apple',
    series: 'MacBook Pro',
    name: 'MacBook Pro 14 M1 Pro',
    code: 'MBP14M1P',
    year: 2021,
    form: 'CONSUMER',
    screen: 14.2,
    res: 'RETINA',
    msrp: 194900,
    os: 'macOS Sonoma',
    panel: 'Liquid Retina XDR mini-LED',
    gpuType: 'DISCRETE',
    gpuModel: 'Apple 16-core GPU',
    ramType: 'LPDDR5 unified',
    ramSlots: 0,
    ramMax: 64,
    storageSlots: 0,
    weightKg: 1.6,
    batteryWh: 70,
    chargerW: 96,
    webcamMp: 1.2,
    ports: ['Thunderbolt 4 x3', 'HDMI 2.0', 'SDXC', 'MagSafe 3', '3.5 mm headphone'],
    cpus: ['M1 Pro', 'M1 Max'],
    configs: [
      [16, 512],
      [16, 1024],
      [32, 1024],
    ],
  },

  // --- Asus ---------------------------------------------------------------
  {
    brand: 'Asus',
    series: 'ZenBook',
    name: 'ZenBook 14 UX425EA',
    code: 'UX425EA',
    year: 2020,
    form: 'CONSUMER',
    screen: 14,
    res: 'FHD',
    msrp: 89990,
    weightKg: 1.17,
    batteryWh: 67,
    ramSlots: 0,
    ramMax: 16,
    ramType: 'LPDDR4X',
    fingerprint: false,
    ports: ['Thunderbolt 4 x2', 'USB-A 3.2 Gen 1', 'HDMI 1.4', 'microSD'],
    cpus: ['i5-1135G7', 'i7-1165G7'],
    configs: [
      [8, 512],
      [16, 512],
      [16, 1024],
    ],
  },
  {
    brand: 'Asus',
    series: 'VivoBook',
    name: 'VivoBook 15 X515EA',
    code: 'X515EA',
    year: 2021,
    form: 'CONSUMER',
    screen: 15.6,
    res: 'FHD',
    msrp: 52990,
    weightKg: 1.8,
    batteryWh: 37,
    chargerW: 45,
    backlit: false,
    fingerprint: false,
    gpuModel: 'Intel UHD Graphics',
    ports: ['USB-A 3.2 Gen 1 x2', 'USB-A 2.0', 'USB-C 3.2 Gen 1', 'HDMI 1.4', '3.5 mm combo'],
    cpus: ['i3-1115G4', 'i5-1135G7'],
    configs: [
      [8, 256],
      [8, 512],
      [16, 512],
    ],
  },
  {
    brand: 'Asus',
    series: 'ExpertBook',
    name: 'ExpertBook B9450FA',
    code: 'B9450FA',
    year: 2020,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 142990,
    weightKg: 0.99,
    batteryWh: 66,
    ramSlots: 0,
    ramMax: 16,
    ramType: 'LPDDR3',
    gpuModel: 'Intel UHD Graphics',
    wifi: 'Wi-Fi 6 (802.11ax)',
    cpus: ['i5-10210U', 'i7-10510U'],
    configs: [
      [8, 512],
      [16, 512],
      [16, 1024],
    ],
  },
  {
    brand: 'Asus',
    series: 'ROG',
    name: 'ROG Zephyrus G14 GA401',
    code: 'GA401',
    year: 2021,
    form: 'GAMING',
    screen: 14,
    res: 'QHD',
    msrp: 164990,
    weightKg: 1.7,
    batteryWh: 76,
    chargerW: 180,
    gpuType: 'DISCRETE',
    gpuModel: 'NVIDIA GeForce RTX 3060 6GB',
    ramSlots: 1,
    ramMax: 40,
    fingerprint: false,
    webcamMp: 0,
    ports: ['USB-A 3.2 Gen 2 x2', 'USB-C 3.2 Gen 2 x2', 'HDMI 2.0b', '3.5 mm combo'],
    cpus: ['Ryzen 7 5800HS', 'Ryzen 9 5900HS'],
    configs: [
      [16, 512],
      [16, 1024],
      [32, 1024],
    ],
  },

  // --- Acer ---------------------------------------------------------------
  {
    brand: 'Acer',
    series: 'Swift',
    name: 'Swift 3 SF314-511',
    code: 'SF314511',
    year: 2021,
    form: 'CONSUMER',
    screen: 14,
    res: 'FHD',
    msrp: 62990,
    weightKg: 1.2,
    batteryWh: 56,
    ramSlots: 0,
    ramMax: 16,
    ramType: 'LPDDR4X',
    ports: ['USB-A 3.2 Gen 1 x2', 'Thunderbolt 4', 'HDMI 2.0', '3.5 mm combo'],
    cpus: ['i5-1135G7', 'i7-1165G7'],
    configs: [
      [8, 512],
      [16, 512],
    ],
  },
  {
    brand: 'Acer',
    series: 'Aspire',
    name: 'Aspire 5 A515-56',
    code: 'A51556',
    year: 2021,
    form: 'CONSUMER',
    screen: 15.6,
    res: 'FHD',
    msrp: 54990,
    weightKg: 1.76,
    batteryWh: 48,
    chargerW: 45,
    fingerprint: false,
    gpuModel: 'Intel UHD Graphics',
    ports: ['USB-A 3.2 Gen 1 x2', 'USB-A 2.0', 'USB-C 3.2 Gen 1', 'HDMI 2.0', 'RJ-45'],
    cpus: ['i3-1115G4', 'i5-1135G7', 'i7-1165G7'],
    configs: [
      [8, 256],
      [8, 512],
      [16, 512],
    ],
  },
  {
    brand: 'Acer',
    series: 'TravelMate',
    name: 'TravelMate P2 TMP214-53',
    code: 'TMP21453',
    year: 2021,
    form: 'BUSINESS_ULTRABOOK',
    screen: 14,
    res: 'FHD',
    msrp: 66990,
    weightKg: 1.6,
    batteryWh: 48,
    gpuModel: 'Intel UHD Graphics',
    ports: ['USB-A 3.2 Gen 1 x2', 'USB-C 3.2 Gen 2', 'HDMI 2.0', 'RJ-45', '3.5 mm combo'],
    cpus: ['i5-1135G7', 'i7-1165G7'],
    configs: [
      [8, 256],
      [16, 512],
    ],
  },
  {
    brand: 'Acer',
    series: 'Nitro',
    name: 'Nitro 5 AN515-57',
    code: 'AN51557',
    year: 2021,
    form: 'GAMING',
    screen: 15.6,
    res: 'FHD',
    msrp: 89990,
    weightKg: 2.2,
    batteryWh: 57,
    chargerW: 180,
    gpuType: 'DISCRETE',
    gpuModel: 'NVIDIA GeForce RTX 3050 4GB',
    storageSlots: 2,
    fingerprint: false,
    ports: ['USB-A 3.2 Gen 1 x3', 'USB-C 3.2 Gen 2', 'HDMI 2.1', 'RJ-45', '3.5 mm combo'],
    cpus: ['i5-11400H', 'i7-11800H'],
    configs: [
      [8, 512],
      [16, 512],
      [16, 1024],
    ],
  },

  // --- Microsoft ----------------------------------------------------------
  {
    brand: 'Microsoft',
    series: 'Surface Laptop',
    name: 'Surface Laptop 4 13.5',
    code: 'SL4135',
    year: 2021,
    form: '2_IN_1',
    screen: 13.5,
    res: 'QHD',
    msrp: 118999,
    touch: true,
    panel: 'PixelSense',
    weightKg: 1.27,
    batteryWh: 47,
    chargerW: 65,
    ramSlots: 0,
    ramMax: 32,
    ramType: 'LPDDR4X',
    storageSlots: 0,
    fingerprint: false,
    webcamMp: 1.2,
    ports: ['USB-A 3.1', 'USB-C 3.1', 'Surface Connect', '3.5 mm combo'],
    cpus: ['i5-1135G7', 'i7-1185G7'],
    configs: [
      [8, 256],
      [8, 512],
      [16, 512],
    ],
  },
  {
    brand: 'Microsoft',
    series: 'Surface Pro',
    name: 'Surface Pro 7',
    code: 'SP7',
    year: 2019,
    form: '2_IN_1',
    screen: 12.3,
    res: 'QHD',
    msrp: 89999,
    touch: true,
    panel: 'PixelSense',
    weightKg: 0.79,
    batteryWh: 43,
    chargerW: 65,
    ramSlots: 0,
    ramMax: 16,
    ramType: 'LPDDR4X',
    storageSlots: 0,
    backlit: false,
    fingerprint: false,
    webcamMp: 8,
    gpuModel: 'Intel Iris Plus',
    wifi: 'Wi-Fi 6 (802.11ax)',
    ports: ['USB-A 3.0', 'USB-C 3.1', 'Surface Connect', 'microSDXC', '3.5 mm combo'],
    cpus: ['i5-1035G4', 'i7-1065G7'],
    configs: [
      [8, 128],
      [8, 256],
      [16, 256],
    ],
  },
  {
    brand: 'Microsoft',
    series: 'Surface Laptop Go',
    name: 'Surface Laptop Go',
    code: 'SLGO',
    year: 2020,
    form: 'CONSUMER',
    screen: 12.4,
    res: 'HD',
    msrp: 62999,
    touch: true,
    panel: 'PixelSense',
    weightKg: 1.11,
    batteryWh: 40,
    chargerW: 39,
    ramSlots: 0,
    ramMax: 16,
    ramType: 'LPDDR4X',
    storageSlots: 0,
    backlit: false,
    webcamMp: 0.9,
    gpuModel: 'Intel UHD Graphics',
    ports: ['USB-A 3.1', 'USB-C 3.1', 'Surface Connect', '3.5 mm combo'],
    cpus: ['i5-1035G1'],
    // The 64 GB entry really is eMMC, and it is the exact row that proves the
    // storage_type override earns its place: calling it an SSD would put a spec
    // on the listing that QC would then flag as a mismatch on every unit.
    configs: [
      [4, 64, 'EMMC'],
      [8, 128],
      [8, 256],
    ],
  },

  // --- MSI ----------------------------------------------------------------
  {
    brand: 'MSI',
    series: 'Modern',
    name: 'Modern 14 B11M',
    code: 'MOD14B11M',
    year: 2021,
    form: 'CONSUMER',
    screen: 14,
    res: 'FHD',
    msrp: 58990,
    weightKg: 1.3,
    batteryWh: 39,
    chargerW: 65,
    fingerprint: false,
    ports: ['USB-A 3.2 Gen 1 x2', 'USB-C 3.2 Gen 1', 'HDMI 1.4', '3.5 mm combo'],
    cpus: ['i5-1155G7', 'i7-1195G7'],
    configs: [
      [8, 512],
      [16, 512],
    ],
  },
  {
    brand: 'MSI',
    series: 'Prestige',
    name: 'Prestige 15 A11SC',
    code: 'PRE15A11SC',
    year: 2021,
    form: 'CONSUMER',
    screen: 15.6,
    res: 'FHD',
    msrp: 124990,
    weightKg: 1.69,
    batteryWh: 82,
    chargerW: 90,
    gpuType: 'DISCRETE',
    gpuModel: 'NVIDIA GeForce GTX 1650 Max-Q 4GB',
    ports: ['Thunderbolt 4 x2', 'USB-A 3.2 Gen 1 x2', 'HDMI 2.0', 'microSD'],
    cpus: ['i5-1155G7', 'i7-1185G7'],
    configs: [
      [16, 512],
      [16, 1024],
    ],
  },
  {
    brand: 'MSI',
    series: 'Katana',
    name: 'Katana GF66 11UC',
    code: 'GF6611UC',
    year: 2021,
    form: 'GAMING',
    screen: 15.6,
    res: 'FHD',
    msrp: 94990,
    weightKg: 2.25,
    batteryWh: 53,
    chargerW: 180,
    gpuType: 'DISCRETE',
    gpuModel: 'NVIDIA GeForce RTX 3050 4GB',
    storageSlots: 2,
    fingerprint: false,
    ports: ['USB-A 3.2 Gen 1 x3', 'USB-C 3.2 Gen 1', 'HDMI 2.0b', 'RJ-45', '3.5 mm combo'],
    cpus: ['i5-11400H', 'i7-11800H'],
    configs: [
      [8, 512],
      [16, 512],
      [16, 1024],
    ],
  },
];

/**
 * The platform's own actor. `condition_image.created_by` is NOT NULL against
 * identity.user_account, so a seeded image needs a real user row — and the
 * honest answer to "who uploaded this" for seed data is the platform, named,
 * rather than whichever human happened to run the script.
 *
 * The org id matches the test factories' PLATFORM_ORG_ID so `ensurePlatformOrg`
 * finds it rather than racing to insert a second internal organisation.
 */
const PLATFORM_ORG_ID = '00000000-0000-4000-8000-00000000dead';
const CATALOG_ACTOR_ID = '00000000-0000-4000-8000-0000000ca7a1';

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A row names only what makes it a different machine; the rest is DEFAULTS. */
const withDefaults = (m: ModelRow) => ({ ...DEFAULTS, ...m });

const csvEscape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const BRAND_CODES: Record<string, string> = {
  Dell: 'DEL',
  Lenovo: 'LEN',
  HP: 'HP',
  Apple: 'APL',
  Asus: 'ASU',
  Acer: 'ACR',
  Microsoft: 'MSF',
  MSI: 'MSI',
};

const brandCode = (brand: string): string => BRAND_CODES[brand] ?? brand.slice(0, 3).toUpperCase();

/**
 * The model name is the join key between the rows the importer hands back and
 * the table entry carrying everything the CSV has no column for, so a repeated
 * name is a SKU silently given another machine's weight, battery and ports.
 */
const BY_NAME = new Map<string, ModelRow>(MODELS.map((m) => [m.name, m]));
if (BY_NAME.size !== MODELS.length) throw new Error('two MODELS rows share a name');

/**
 * Render the table to the importer's own CSV.
 *
 * `sku_code` carries the full chip designation rather than the family — the
 * phase doc's `DEL-LAT5420-I5-16-512` example collides the moment a model ships
 * both an i5-1135G7 and an i5-1145G7, which the Latitude 5420 does, and a
 * collision on `sku_code UNIQUE` fails the seed with no way to tell which of the
 * two machines was meant.
 */
export function catalogCsv(): string {
  const lines = [SKU_IMPORT_COLUMNS.join(',')];

  for (const raw of MODELS) {
    const m = withDefaults(raw);
    for (const cpuModel of m.cpus) {
      const cpu = CPUS[cpuModel];
      if (!cpu) throw new Error(`${m.name} names an unknown CPU "${cpuModel}"`);
      for (const [ramGb, storageGb, storageType] of m.configs) {
        const cpuCode = cpuModel.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const row: Record<SkuImportColumn, string> = {
          brand: m.brand,
          series: m.series,
          model: m.name,
          cpu_brand: cpu.brand ?? 'Intel',
          cpu_family: cpu.family,
          cpu_model: cpuModel,
          cpu_generation: cpu.gen,
          ram_gb: String(ramGb),
          storage_gb: String(storageGb),
          storage_type: storageType ?? m.storageType,
          gpu_type: m.gpuType,
          gpu_model: m.gpuModel,
          screen_size_in: String(m.screen),
          resolution: m.res,
          is_touch: String(m.touch),
          os: m.os,
          hsn_code: '84713010',
          sku_code: `${brandCode(m.brand)}-${m.code}-${cpuCode}-${ramGb}-${storageGb}`,
        };
        lines.push(SKU_IMPORT_COLUMNS.map((c) => csvEscape(row[c])).join(','));
      }
    }
  }

  return lines.join('\n') + '\n';
}

// --- the condition image library ------------------------------------------

/** What the shot actually shows, so `alt_text` describes a photograph. */
const VIEW_PHRASE: Record<ConditionViewCode, string> = {
  LID_TOP: 'the closed lid shot straight down',
  PALMREST: 'the palmrest and trackpad',
  KEYBOARD: 'the keyboard from above',
  SCREEN_ON: 'the screen powered on at full brightness',
  PORTS_LEFT: 'the left-hand port bank',
  PORTS_RIGHT: 'the right-hand port bank',
  BASE: 'the underside, vents and rubber feet',
  HINGE: 'the hinge with the lid half open',
  CORNER_WEAR: 'the front-left corner in close-up',
  SCREEN_DEFECT: 'the panel against a white field',
};

const GRADE_LABEL: Record<Grade, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };

/**
 * The wear the frame is there to show. This is the honest half of the
 * representative-image bargain: a Grade B set photographed like a Grade A+ set
 * is technically true and still misleads, which is a Rule 7(2) exposure.
 */
const WEAR_PHRASE: Record<Grade, string> = {
  A_PLUS: 'showing no visible marks under direct light',
  A: 'showing faint surface marks under 10 mm, visible only in raking light',
  B: 'showing light scratches and edge wear a buyer will notice',
};

const SEVERITY: Record<Grade, string> = { A_PLUS: 'NONE', A: 'FAINT', B: 'MINOR' };

/**
 * Every view a grade needs, plus the CORNER_WEAR frame Grade B cannot publish
 * without — `isPublishable` refuses a B set that shows only its good angles.
 */
function viewsFor(grade: Grade): ConditionViewCode[] {
  return grade === 'B' ? [...REQUIRED_VIEWS, 'CORNER_WEAR'] : [...REQUIRED_VIEWS];
}

interface ImageSpec {
  grade: Grade;
  viewCode: ConditionViewCode;
  s3Key: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
  defectType: string | null;
  severity: string;
}

export function imageSet(model: ModelRow): ImageSpec[] {
  const modelSlug = `${slug(model.brand)}-${slug(model.name)}`;
  const specs: ImageSpec[] = [];

  for (const grade of GRADES) {
    const views = viewsFor(grade);
    views.forEach((viewCode, i) => {
      // The corner frame exists to show the worst the grade permits, so it is
      // labelled as such rather than inheriting the set's general severity.
      const worstAllowed = grade === 'B' && viewCode === 'CORNER_WEAR';
      specs.push({
        grade,
        viewCode,
        s3Key: `catalog/${modelSlug}/${grade.toLowerCase()}/${viewCode.toLowerCase()}.avif`,
        altText:
          `Grade ${GRADE_LABEL[grade]} ${model.brand} ${model.name}: ` +
          `${VIEW_PHRASE[viewCode]}, ` +
          `${worstAllowed ? 'showing the deepest edge wear Grade B allows' : WEAR_PHRASE[grade]}.`,
        // LID_TOP is the hero frame on the listing card. One per (model, grade),
        // which is what uq_condition_primary_model enforces.
        isPrimary: viewCode === 'LID_TOP',
        sortOrder: i,
        defectType: worstAllowed ? 'EDGE_WEAR' : null,
        severity: worstAllowed ? 'WORST_ALLOWED' : SEVERITY[grade],
      });
    });
  }

  return specs;
}

/**
 * Exit criterion 2 is "the coverage grid shows zero gaps", and the grid is
 * `coverageGaps()`. Checking the generated set against the same function the
 * admin screen calls — before a single row is written — is what stops a seed
 * that looks complete from producing a placeholder on a live listing.
 */
function assertComplete(model: ModelRow, specs: ImageSpec[]): void {
  const asImages: ConditionImage[] = specs.map((s, i) => ({
    id: `${model.code}-${i}`,
    anchor: 'MODEL',
    anchorId: model.code,
    grade: s.grade,
    viewCode: s.viewCode,
    s3Key: s.s3Key,
    altText: s.altText,
    isPrimary: s.isPrimary,
    sortOrder: s.sortOrder,
  }));

  const gaps = coverageGaps(asImages);
  if (gaps.length > 0) {
    throw new Error(
      `${model.name}: ${gaps.map((g) => `${g.grade}/${g.viewCode}`).join(', ')} missing`,
    );
  }

  for (const grade of GRADES) {
    const check = isPublishable(grade, asImages);
    if (!check.publishable) throw new Error(`${model.name} grade ${grade}: ${check.reasons[0]}`);
  }

  for (const s of asImages) {
    if (s.altText.trim().length < 10) throw new Error(`${model.name}: alt_text too short`);
    if (!CONDITION_VIEW_CODES.includes(s.viewCode)) {
      throw new Error(`${model.name}: ${s.viewCode} is not a view code`);
    }
  }
}

// --- writing --------------------------------------------------------------

async function ensureActor(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO identity.organization (id, org_type, legal_name, trade_name, status)
    VALUES (${PLATFORM_ORG_ID}::uuid, 'INTERNAL'::org_type,
            'TrueTech Services Pvt. Ltd.', 'gorefurbo', 'VERIFIED'::org_status)
    ON CONFLICT (id) DO NOTHING`;

  await prisma.$executeRaw`
    INSERT INTO identity.user_account (id, org_id, full_name, email, status)
    VALUES (${CATALOG_ACTOR_ID}::uuid, ${PLATFORM_ORG_ID}::uuid,
            'Catalog Seed', 'catalog-seed@gorefurbo.internal', 'ACTIVE')
    ON CONFLICT (id) DO NOTHING`;
}

async function upsertId(
  prisma: PrismaClient,
  sql: Promise<Array<{ id: string }>>,
): Promise<string> {
  const rows = await sql;
  const id = rows[0]?.id;
  if (!id) throw new Error('upsert returned no id');
  return id;
}

export interface CatalogSeedCounts {
  brands: number;
  series: number;
  models: number;
  skus: number;
  images: number;
}

export async function seedCatalog(
  prisma: PrismaClient,
  log: (msg: string) => void = () => undefined,
): Promise<CatalogSeedCounts> {
  await ensureActor(prisma);

  // Straight through the importer, not around it. A row this generator emits
  // that ops could not have typed is a bug in the generator, and it surfaces
  // here rather than as a catalog row with no import path behind it.
  const parsed = parseSkuCsv(catalogCsv());
  if (parsed.fileErrors.length > 0) throw new Error(parsed.fileErrors.join(' '));

  const bad = parsed.rows.filter((r) => !r.value);
  if (bad.length > 0) {
    throw new Error(
      `seed CSV rejected by the importer: ` +
        bad.map((r) => `line ${r.lineNumber}: ${r.errors.join('; ')}`).join(' | '),
    );
  }

  const brandIds = new Map<string, string>();
  const seriesIds = new Map<string, string>();
  const modelIds = new Map<string, string>();
  let images = 0;

  for (const raw of MODELS) {
    const m = withDefaults(raw);

    let brandId = brandIds.get(m.brand);
    if (!brandId) {
      brandId = await upsertId(
        prisma,
        prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO catalog.brand (name, slug) VALUES (${m.brand}, ${slug(m.brand)})
          ON CONFLICT (name) DO UPDATE SET slug = EXCLUDED.slug, is_active = TRUE
          RETURNING id`,
      );
      brandIds.set(m.brand, brandId);
    }

    const seriesKey = `${m.brand}|${m.series}`;
    let seriesId = seriesIds.get(seriesKey);
    if (!seriesId) {
      seriesId = await upsertId(
        prisma,
        prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO catalog.series (brand_id, name, slug)
          VALUES (${brandId}::uuid, ${m.series}, ${slug(m.series)})
          ON CONFLICT (brand_id, name) DO UPDATE SET slug = EXCLUDED.slug, is_active = TRUE
          RETURNING id`,
      );
      seriesIds.set(seriesKey, seriesId);
    }

    const modelId = await upsertId(
      prisma,
      prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO catalog.model (series_id, name, model_year, form_factor, msrp_new_inr)
        VALUES (${seriesId}::uuid, ${m.name}, ${m.year}::int, ${m.form}, ${m.msrp}::numeric)
        ON CONFLICT (series_id, name) DO UPDATE
          SET model_year = EXCLUDED.model_year,
              form_factor = EXCLUDED.form_factor,
              msrp_new_inr = EXCLUDED.msrp_new_inr,
              is_active = TRUE
        RETURNING id`,
    );
    modelIds.set(m.name, modelId);

    const specs = imageSet(raw);
    assertComplete(raw, specs);

    for (const s of specs) {
      // The arbiter is the partial slot index, so its predicate is repeated
      // here — without it Postgres cannot infer which unique index to use and
      // the statement fails rather than upserting.
      await prisma.$executeRaw`
        INSERT INTO catalog.condition_image
          (model_id, grade, view_code, s3_key, alt_text, is_primary, sort_order,
           defect_type, severity, shot_angle, licence, created_by)
        VALUES (${modelId}::uuid, ${s.grade}::grade_type, ${s.viewCode}, ${s.s3Key}, ${s.altText},
                ${s.isPrimary}, ${s.sortOrder}::int, ${s.defectType}, ${s.severity},
                'STUDIO_45', 'PLATFORM_OWNED', ${CATALOG_ACTOR_ID}::uuid)
        ON CONFLICT (model_id, grade, view_code, sort_order)
          WHERE retired_at IS NULL AND model_id IS NOT NULL
        DO UPDATE SET s3_key      = EXCLUDED.s3_key,
                      alt_text    = EXCLUDED.alt_text,
                      is_primary  = EXCLUDED.is_primary,
                      defect_type = EXCLUDED.defect_type,
                      severity    = EXCLUDED.severity`;
      images++;
    }
  }

  for (const parsedRow of parsed.rows) {
    const r = parsedRow.value as SkuImportRow;
    const modelId = modelIds.get(r.model);
    const entry = BY_NAME.get(r.model);
    if (!modelId || !entry) throw new Error(`row for "${r.model}" has no model row`);
    const m = withDefaults(entry);
    const cpu = CPUS[r.cpuModel]!;
    // Soldered memory is not upgradable to the model's ceiling; it is fixed at
    // what shipped. Reporting the ceiling would make every QC RAM check on an
    // X1 Carbon look like an under-spec.
    const ramMax = m.ramSlots === 0 ? r.ramGb : m.ramMax;

    // Idempotent on normalized_key, the dedupe guarantee itself. sku_code is
    // also UNIQUE and is derived from the same tuple, so a re-run lands on the
    // same row by either constraint.
    await prisma.$executeRaw`
      INSERT INTO catalog.sku
        (model_id, sku_code, normalized_key, cpu_brand, cpu_family, cpu_model, cpu_generation,
         cores, threads, ram_gb, ram_type, ram_slots, ram_upgradable_to,
         storage_type, storage_gb, storage_slots, gpu_type, gpu_model,
         screen_size_inch, resolution, panel_type, is_touch, os_supported, os_licence_type,
         ports_json, weight_kg, battery_wh, charger_watt, wifi_standard, bluetooth_version,
         keyboard_layout, backlit_keyboard, fingerprint_reader, webcam_mp, year_released,
         hsn_code, created_by)
      VALUES
        (${modelId}::uuid, ${r.skuCode}, ${r.normalizedKey}, ${r.cpuBrand}, ${r.cpuFamily},
         ${r.cpuModel}, ${r.cpuGeneration}, ${cpu.cores}::int, ${cpu.threads}::int,
         ${r.ramGb}::int, ${m.ramType}, ${m.ramSlots}::int, ${ramMax}::int,
         ${r.storageType}, ${r.storageGb}::int, ${m.storageSlots}::int,
         ${r.gpuType}, ${r.gpuModel}, ${r.screenSizeIn}::numeric, ${r.resolution}, ${m.panel},
         ${r.isTouch}, ${r.os}, ${m.brand === 'Apple' ? 'NONE' : 'OEM'},
         ${JSON.stringify(m.ports)}::jsonb,
         ${m.weightKg}::numeric, ${m.batteryWh}::int, ${m.chargerW}::int, ${m.wifi}, ${m.bt},
         'US QWERTY', ${m.backlit}, ${m.fingerprint}, ${m.webcamMp}::numeric, ${m.year}::int,
         ${r.hsnCode}, ${CATALOG_ACTOR_ID}::uuid)
      -- sku_code is deliberately NOT refreshed here, matching SkuImportService.
      -- The code is printed on purchase orders and used in warehouse
      -- conversation, so rewriting it on a re-seed breaks the paper trail for a
      -- cosmetic gain. Two sibling write paths disagreeing on that is how a
      -- catalog starts telling two stories about the same machine.
      ON CONFLICT (normalized_key) DO UPDATE
        SET cores       = EXCLUDED.cores,
            threads     = EXCLUDED.threads,
            ram_type    = EXCLUDED.ram_type,
            panel_type  = EXCLUDED.panel_type,
            ports_json  = EXCLUDED.ports_json,
            weight_kg   = EXCLUDED.weight_kg,
            battery_wh  = EXCLUDED.battery_wh,
            hsn_code    = EXCLUDED.hsn_code,
            is_active   = TRUE`;
  }

  // Task 8's search and facet source is a materialised view, so a catalog it has
  // never seen is a catalog search returns nothing for. Not CONCURRENTLY: the
  // seed is the only writer and CONCURRENTLY cannot run inside a transaction,
  // which is where the integration harness calls this from.
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW catalog.mv_sku_search');

  const counts: CatalogSeedCounts = {
    brands: brandIds.size,
    series: seriesIds.size,
    models: modelIds.size,
    skus: parsed.rows.length,
    images,
  };

  log(
    `  catalog: ${counts.brands} brands, ${counts.series} series, ${counts.models} models, ` +
      `${counts.skus} SKUs, ${counts.images} condition images (0 coverage gaps)`,
  );

  return counts;
}
