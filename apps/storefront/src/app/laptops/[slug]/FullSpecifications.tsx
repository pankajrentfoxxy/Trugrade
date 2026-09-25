/**
 * "All details" — the declared specification, in the record column right
 * under the delivery check, the marketplace "All details" bottom-sheet a
 * buyer already knows: open panel, a "Specifications" tab (the only tab
 * there is data for), the first group's rows, and a "See more" that
 * reveals the rest.
 *
 * **PLACEHOLDER CONTENT — frontend only, not read from the catalogue.** The
 * real declared specification for a SKU comes from `SkuDetail` via `specRows`
 * in `spec-rows.ts`. This table is a fixed, hardcoded set of rows for ONE
 * reference configuration (an ASUS TUF Gaming A15), built so the design can
 * be seen and reviewed before the catalogue carries this level of detail for
 * every SKU. It renders the same fixed rows under every grade and every
 * model until it is replaced. The reference this was built from also showed
 * "Warranty" and "Manufacturer info" tabs beside "Specifications" — those are
 * left out rather than invented, since there is no warranty or manufacturer
 * data anywhere in this placeholder to put behind them.
 *
 * When the catalogue gains these fields, this becomes a function of `sku`
 * like `specRows`, and this notice — and the fixed data below — come out.
 *
 * Grouped, not one long list: a buyer scanning for "does it have a fingerprint
 * reader" reads group headings, not forty ungrouped rows top to bottom.
 *
 * Two levels of disclosure, both native `<details>` so neither needs
 * client-side state: the outer panel (chevron beside "All details") loads
 * open, since the declared spec is expected to be visible without an extra
 * click on this record; the inner one — the other eight groups, behind "See
 * more" — stays closed, so the panel opens to one group's worth of rows
 * rather than the whole forty-row table at once. The "More…" chip beside
 * the title (`page.tsx`) still links to this panel's id and works the same
 * way whether the outer `<details>` is open or closed.
 */

interface SpecGroup {
  title: string;
  rows: Array<[string, string]>;
}

/** Fixed reference data — see file header. Order and grouping as supplied. */
const SPEC_GROUPS: readonly [SpecGroup, ...SpecGroup[]] = [
  {
    title: 'Processor and Memory Features',
    rows: [
      ['Dedicated Graphic Memory Type', 'GDDR6'],
      ['Dedicated Graphic Memory Capacity', '4 GB'],
      ['Processor Brand', 'AMD'],
      ['Processor Name', 'Ryzen 7'],
      ['SSD', 'Yes'],
      ['SSD Capacity', '512 GB'],
      ['RAM', '16 GB'],
      ['RAM Type', 'DDR5'],
      ['Processor Variant', '170'],
      ['Clock Speed', 'up to 4.75 GHz'],
      ['Cache', '20 MB'],
      ['Graphic Processor', 'NVIDIA GeForce RTX 3050'],
      ['Number of Cores', '8'],
      ['Storage Type', 'SSD'],
      ['Operating System', 'Windows 11 Home'],
    ],
  },
  {
    title: 'In the Box',
    rows: [
      ['Sales Package', '1 x Laptop, 1 x Power Adaptor, 1 x User Guide, 1 x Warranty Documents'],
    ],
  },
  {
    title: 'General',
    rows: [
      ['Brand', 'ASUS'],
      ['Model Number', 'FA506NCQ-HN006W'],
      ['Part Number', '90NR0QE7-M00060'],
      ['Model Name', 'FA506NCQ-HN006W'],
      ['Series', 'TUF Gaming A15 (2026)'],
      ['Color', 'Black'],
      ['Type', 'Gaming Laptop'],
      ['Suitable For', 'Gaming'],
      ['Power Supply', '180W AC Adapter'],
      ['Battery Cell', '3-cell'],
      ['MS Office Provided', 'No'],
      ['Is Fragile', 'No'],
      ['Is Tablet', 'No'],
    ],
  },
  {
    title: 'Display and Audio Features',
    rows: [
      ['Touchscreen', 'No'],
      ['Screen Size', '39.62 cm (15.6 inch)'],
      ['Screen Resolution', '1920 x 1080 pixel'],
      [
        'Screen Type',
        'FHD (1920 x 1080) 16:9 aspect ratio, 250nits, 144Hz refresh rate, IPS-level Anti-glare display, 1000:1 Contrast Ratio, 45% NTSC color gamut',
      ],
      ['Speakers', '2-speaker system'],
      ['Internal Mic', 'Built-in array microphone'],
      ['Color Gamut', '45% NTSC'],
      ['Brightness', '250 Nits'],
      ['Screen Resolution Type', 'Full HD'],
    ],
  },
  {
    title: 'Dimensions',
    rows: [
      ['Dimensions', '35.9 x 25.6 x 2.28 cm'],
      ['Weight', '2.3 kg'],
    ],
  },
  {
    title: 'Additional Features',
    rows: [
      ['Disk Drive', 'Not Available'],
      ['Web Camera', '720P HD camera'],
      ['Finger Print Sensor', 'No'],
      ['Face Recognition', 'No'],
      ['Security Chip', 'Trusted Platform Module (Firmware TPM)'],
      ['Antivirus', 'McAfee 1 year'],
      ['Keyboard', 'Backlit Chiclet Keyboard, 1-Zone RGB, with Copilot key'],
      ['Pointer Device', 'Touchpad'],
      ['Included Software', 'McAfee 1 year'],
      ['Battery', '48WHrs, 3S1P, 3-cell Li-ion'],
    ],
  },
  {
    title: 'Operating System',
    rows: [['Operating System', 'Windows 11 Home']],
  },
  {
    title: 'Port and Slot Features',
    rows: [
      [
        'USB Port',
        '1 x USB 3.2 Gen 2 Type-C with support for DisplayPort (data speed up to 10Gbps), 3 x USB 3.2 Gen 1 Type-A (data speed up to 5Gbps), 1 x HDMI 2.1, 1 x 3.5 mm, 1 x RJ45',
      ],
      ['HDMI Port', '1x HDMI 2.1 TMDS'],
      ['Hardware Interface', 'M.2 NVMe PCIe 4.0 SSD'],
    ],
  },
  {
    title: 'Connectivity Features',
    rows: [['Bluetooth', 'v5.3']],
  },
];

function SpecGroupRows({ group }: { group: SpecGroup }): React.JSX.Element {
  return (
    <>
      <h3 className="adl-h">{group.title}</h3>
      <dl className="adl">
        {group.rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

const CHEVRON_PATH = 'm6 9 6 6 6-6';

export function FullSpecifications(): React.JSX.Element {
  const [first, ...rest] = SPEC_GROUPS;

  return (
    <details className="alldetails" id="fullspec-h" open>
      <summary className="alldetails-h">
        All details
        <span className="alldetails-toggle" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={CHEVRON_PATH} />
          </svg>
        </span>
      </summary>

      <div className="alldetails-b">
        <span className="alldetails-tab">Specifications</span>

        <SpecGroupRows group={first} />

        <details className="adl-more">
          <summary>
            <span className="more">See more</span>
            <span className="less">See less</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={CHEVRON_PATH} />
            </svg>
          </summary>
          <div>
            {rest.map((group) => (
              <SpecGroupRows group={group} key={group.title} />
            ))}
          </div>
        </details>
      </div>
    </details>
  );
}
