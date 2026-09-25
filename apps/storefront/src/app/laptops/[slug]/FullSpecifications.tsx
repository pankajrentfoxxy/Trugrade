/**
 * "Full specifications" on the product page — the long, grouped spec table
 * a buyer expects below the reviews summary, the way a marketplace listing
 * carries it.
 *
 * **PLACEHOLDER CONTENT — frontend only, not read from the catalogue.** The
 * real declared specification for a SKU comes from `SkuDetail` via `specRows`
 * in `spec-rows.ts`. This table is a fixed, hardcoded set of rows for ONE
 * reference configuration (an ASUS TUF Gaming A15), built so the design can
 * be seen and reviewed before the catalogue carries this level of detail for
 * every SKU. It renders the same fixed rows under every grade and every
 * model until it is replaced.
 *
 * When the catalogue gains these fields, this becomes a function of `sku`
 * like `specRows`, and this notice — and the fixed data below — come out.
 *
 * Grouped, not one long list: a buyer scanning for "does it have a fingerprint
 * reader" reads group headings, not forty ungrouped rows top to bottom.
 *
 * Two columns of small, individually-collapsible group cards — the
 * marketplace "Product information" layout a buyer already knows — rather
 * than one long column of groups. Splitting the nine groups across two
 * columns roughly halves the section's height on a wide screen, which is
 * what actually made "all nine groups, one column" look wrong there.
 *
 * Every group loads closed. The "More" chip beside the title (`page.tsx`)
 * scrolls straight to this section without also dumping the full,
 * nine-group table open in the same motion — a buyer opens the groups they
 * actually want.
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

function SpecGroupCard({ group }: { group: SpecGroup }): React.JSX.Element {
  return (
    <details className="fullspec-group">
      <summary>
        {group.title}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <dl className="fullspec-dl">
        {group.rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/**
 * Greedily assigns each group to whichever column currently holds fewer
 * rows, so the two columns land close in height instead of splitting nine
 * groups 5/4 by count and leaving one column visibly taller.
 */
function splitIntoColumns(groups: readonly SpecGroup[]): [SpecGroup[], SpecGroup[]] {
  const left: SpecGroup[] = [];
  const right: SpecGroup[] = [];
  let leftRows = 0;
  let rightRows = 0;
  for (const group of groups) {
    if (leftRows <= rightRows) {
      left.push(group);
      leftRows += group.rows.length;
    } else {
      right.push(group);
      rightRows += group.rows.length;
    }
  }
  return [left, right];
}

export function FullSpecifications(): React.JSX.Element {
  const [left, right] = splitIntoColumns(SPEC_GROUPS);

  return (
    <section className="fullspec" aria-labelledby="fullspec-h">
      <h2 className="sec-t" id="fullspec-h">
        Full specifications
      </h2>
      <div className="fullspec-cols">
        <div className="fullspec-col">
          {left.map((group) => (
            <SpecGroupCard group={group} key={group.title} />
          ))}
        </div>
        <div className="fullspec-col">
          {right.map((group) => (
            <SpecGroupCard group={group} key={group.title} />
          ))}
        </div>
      </div>
    </section>
  );
}
