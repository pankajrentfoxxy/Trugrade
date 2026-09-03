export { cn } from './lib/cn';
export { Mark, Wordmark, Logo } from './brand/Mark';
export { ToleranceBand, type ToleranceBandProps } from './components/ToleranceBand';
export { Evidence, type EvidenceProps } from './components/Evidence';
export {
  Button,
  type ButtonProps,
  Input,
  type InputProps,
  type VerifyState,
  StatusPill,
  type StatusPillProps,
  GradeBadge,
  type GradeBadgeProps,
  ScoreRing,
  type ScoreRingProps,
  SealChip,
  type SealStatus,
  EmptyState,
  RateLimitNotice,
  type RateLimitNoticeProps,
  Skeleton,
  RepresentativeImage,
  type RepresentativeImageProps,
} from './components/primitives';
export { CommissionReadout, type CommissionReadoutProps } from './components/CommissionReadout';

export {
  DataTable,
  /**
   * The same component under the name the backlog uses. Density (60/46/34 row
   * heights) comes from `data-density` on the app root, never from a prop.
   */
  DataBoard,
  type DataTableProps,
  type Column,
  type SortDirection,
  Pagination,
  type PaginationProps,
  pageWindow,
} from './components/data';

export {
  Breadcrumb,
  type Crumb,
  Tabs,
  type TabsProps,
  type TabItem,
  Stepper,
  type Step,
  type StepStatus,
} from './components/navigation';

export {
  Modal,
  type ModalProps,
  ToastProvider,
  useToast,
  type ToastInput,
  type ToastTone,
} from './components/overlays';

export {
  Chip,
  type ChipProps,
  SelectTile,
  type SelectTileProps,
  type SelectTileIndicator,
  Checkbox,
  type CheckboxProps,
  Uploader,
  type UploaderProps,
  type UploadedFile,
  type UploadStatus,
  formatFileSize,
  OtpInput,
  type OtpInputProps,
} from './components/forms';

export { MfaChallenge, type MfaChallengeProps } from './components/mfa';

/* Archetype D — flow. */
export {
  StepRail,
  type StepRailProps,
  FormSection,
  type FormSectionProps,
  WhyRail,
  type WhyRailProps,
  type WhyRailItem,
} from './components/flow';

/* Archetype C — record. */
export {
  RecordHeader,
  type RecordHeaderProps,
  type RecordIdentifier,
  SidePanel,
  type SidePanelProps,
  Timeline,
  type TimelineProps,
  type TimelineEvent,
  AddressCard,
  type AddressCardProps,
  type Address,
} from './components/record';

/* Archetype E — workspace. */
export {
  KpiRow,
  type KpiRowProps,
  type Kpi,
  type KpiCount,
  type KpiPercentage,
  QueueList,
  type QueueListProps,
  type QueueItem,
  byBreach,
} from './components/workspace';

export {
  DocumentViewer,
  type DocumentViewerProps,
  type DocumentPage,
} from './components/DocumentViewer';

export {
  PriceBreakup,
  type PriceBreakupProps,
  type PriceLine,
  type ValuationMethod,
  landedPriceLines,
  OfferRow,
  OfferCard,
  type OfferRowProps,
  OfferGrid,
  type OfferGridProps,
  type SupplyPointOffer,
  assertSupplyPointOnly,
} from './components/commerce';

export {
  ThemeToggle,
  type ThemeToggleProps,
  type Theme,
  THEMES,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  THEME_PREPAINT_SCRIPT,
  THEME_STOREFRONT_PREPAINT_SCRIPT,
  isTheme,
  nextTheme,
  readTheme,
  applyTheme,
} from './components/theme';

export {
  QcChip,
  type QcChipProps,
  BatteryBar,
  type BatteryBarProps,
  ViewfinderFrame,
  type ViewfinderFrameProps,
  ScanBox,
  Barcode,
  LiveBlip,
  QrBlock,
  GridGround,
} from './components/measure';
