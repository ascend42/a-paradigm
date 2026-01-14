/**
 * Scan Protocol Template
 * Generates the cursorrules section for horizon scan
 */

export interface ScanProtocolOptions {
  /** Project name */
  projectName?: string;
  /** Path to scan index */
  indexPath?: string;
  /** Enable all scan modes */
  enableAllModes?: boolean;
  /** Custom instructions */
  customInstructions?: string[];
}

/**
 * Get the scan protocol section for .cursorrules
 */
export function getScanProtocol(options: ScanProtocolOptions = {}): string {
  const {
    indexPath = '.horizon/scan-index.json or .horizon-scan-index.json',
    enableAllModes = true,
    customInstructions = [],
  } = options;

  const lines: string[] = [];

  lines.push('## Horizon Scan Protocol');
  lines.push('');
  lines.push('When the user says "**horizon scan**" with an image attached:');
  lines.push('');
  lines.push('### 1. Analyze the Image');
  lines.push('');
  lines.push('Identify visual elements in the image:');
  lines.push('- UI components (buttons, forms, cards, modals, etc.)');
  lines.push('- Data displays (lists, tables, charts)');
  lines.push('- Navigation elements (menus, tabs, breadcrumbs)');
  lines.push('- Layout regions (header, sidebar, main content, footer)');
  lines.push('- Interactive states (loading, errors, empty states)');
  lines.push('');
  lines.push(`### 2. Cross-Reference with Horizon Index`);
  lines.push('');
  lines.push(`Reference the scan index at \`${indexPath}\` to map visual elements to code:`);
  lines.push('');
  lines.push('```');
  lines.push('// Example index structure');
  lines.push('{');
  lines.push('  "components": { "Button": { "symbol": "#Button", "path": "...", "visualTags": ["button"] } },');
  lines.push('  "features": { "checkout": { "symbol": "@checkout", "path": "..." } },');
  lines.push('  "flows": { "checkout-flow": { "symbol": "$checkout-flow", "steps": [...] } },');
  lines.push('  "state": { "cartStore": { "symbol": "%cart", "slices": ["items", "total"] } },');
  lines.push('  "gates": { "auth-required": { "symbol": "^auth-required", "path": "..." } }');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('### 3. Return Structured Results');
  lines.push('');
  lines.push('Format your response as:');
  lines.push('');
  lines.push('```markdown');
  lines.push('## 🔭 Horizon Scan Results');
  lines.push('');
  lines.push('### Components');
  lines.push('| Element | Symbol | Path | Confidence |');
  lines.push('|---------|--------|------|------------|');
  lines.push('| Primary Button | `#Button` | `src/components/Button.tsx` | ●●●● |');
  lines.push('');
  lines.push('### Features');
  lines.push('- **`@checkout`** — Handles the checkout process shown');
  lines.push('');
  lines.push('### Flows');
  lines.push('- **`$checkout-flow`** — Steps: cart → shipping → **payment** ← (you are here) → confirmation');
  lines.push('');
  lines.push('### State');
  lines.push('- `%cart.items` — Powers the item list');
  lines.push('- `%cart.total` — Drives the price display');
  lines.push('');
  lines.push('### Gates');
  lines.push('- `^auth-required` — User must be logged in');
  lines.push('');
  lines.push('### ⚠️ Uncovered Elements');
  lines.push('- The "Apply Coupon" input doesn\'t have a mapped component');
  lines.push('```');
  lines.push('');

  // Scan modes
  if (enableAllModes) {
    lines.push('### Scan Modes');
    lines.push('');
    lines.push('| Mode | Trigger | Use Case |');
    lines.push('|------|---------|----------|');
    lines.push('| `horizon scan` | Default | Map any image to horizon elements |');
    lines.push('| `horizon scan ui` | Screenshot | Map running app screenshot to code |');
    lines.push('| `horizon scan design` | Mockup | Gap analysis vs. design files |');
    lines.push('| `horizon scan error` | Error screenshot | Find related error handlers |');
    lines.push('| `horizon scan arch` | Architecture diagram | Map diagram boxes to features |');
    lines.push('| `horizon scan flow` | Flow diagram | Match steps to `$flow` definitions |');
    lines.push('| `horizon scan diff` | Two images | Show what horizon elements changed |');
    lines.push('');
  }

  lines.push('### Confidence Levels');
  lines.push('');
  lines.push('- **●●●●** High — Visual element clearly matches component name/tags');
  lines.push('- **●●●○** Medium — Likely match based on context');
  lines.push('- **●●○○** Low — Possible match, needs verification');
  lines.push('- **●○○○** Tentative — Best guess, may be incorrect');
  lines.push('');

  lines.push('### After Scanning');
  lines.push('');
  lines.push('Once the user has the scan results, they can:');
  lines.push('');
  lines.push('1. **Reference specific items**: "I want to modify `#CheckoutButton`"');
  lines.push('2. **Ask about flows**: "Walk me through `$checkout-flow`"');
  lines.push('3. **Check gates**: "What permissions does `^premium-checkout` require?"');
  lines.push('4. **Explore state**: "What components use `%cart.items`?"');
  lines.push('');

  // Custom instructions
  if (customInstructions.length > 0) {
    lines.push('### Project-Specific Instructions');
    lines.push('');
    for (const instruction of customInstructions) {
      lines.push(`- ${instruction}`);
    }
    lines.push('');
  }

  lines.push('### Index Regeneration');
  lines.push('');
  lines.push('If the scan index is outdated, run:');
  lines.push('```bash');
  lines.push('horizon index');
  lines.push('```');

  return lines.join('\n');
}

/**
 * Get a minimal scan protocol for quick reference
 */
export function getMinimalScanProtocol(): string {
  return `## Horizon Scan

When user says "horizon scan" with an image:
1. Identify UI elements in the image
2. Map to horizon symbols using \`.horizon/scan-index.json\`
3. Return table of: Components, Features, Flows, State, Gates
4. Flag uncovered elements
5. User can then reference specific symbols for detailed work`;
}
