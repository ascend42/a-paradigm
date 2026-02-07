/**
 * paradigm scan --auto - Auto-generate .purpose files from code analysis
 * 
 * Scans the codebase for patterns and generates .purpose files:
 * - React/Vue/Angular components → #components
 * - Route definitions → $flows
 * - Auth middleware → ^gates
 * - Error handlers → !signals
 * - JSDoc @feature/@component tags → features/components
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import * as yaml from 'js-yaml';

interface AutoScanOptions {
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
}

interface DetectedSymbol {
  id: string;
  type: 'feature' | 'component' | 'flow' | 'gate' | 'signal';
  description: string;
  source: string;  // File where detected
  line?: number;
  confidence: 'high' | 'medium' | 'low';
}

interface GeneratedPurpose {
  path: string;
  content: string;
  symbols: DetectedSymbol[];
  isNew: boolean;
}

// File patterns to scan
const SCAN_PATTERNS = {
  components: [
    '**/*.tsx',
    '**/*.jsx',
    '**/*.vue',
    '**/components/**/*.ts',
    '**/components/**/*.js',
  ],
  routes: [
    '**/routes.ts',
    '**/routes.tsx',
    '**/router.ts',
    '**/app.ts',
    '**/server.ts',
    '**/api/**/*.ts',
    '**/pages/**/*.tsx',
    '**/app/**/page.tsx',  // Next.js app router
  ],
  auth: [
    '**/middleware/**/*.ts',
    '**/auth/**/*.ts',
    '**/guards/**/*.ts',
  ],
};

// Patterns to ignore
const IGNORE_PATTERNS = [
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '__tests__',
  '*.test.*',
  '*.spec.*',
];

/**
 * Simple glob-like pattern matching
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\*\*/g, '{{DOUBLE}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLE}}/g, '.*')
    .replace(/\//g, '\\/');
  
  return new RegExp(regexPattern).test(filePath);
}

/**
 * Check if path should be ignored
 */
function shouldIgnore(filePath: string): boolean {
  return IGNORE_PATTERNS.some(pattern => {
    if (pattern.includes('*')) {
      return matchesPattern(filePath, pattern);
    }
    return filePath.includes(pattern);
  });
}

/**
 * Recursively find files matching patterns
 */
function findFiles(dir: string, patterns: string[]): string[] {
  const results: string[] = [];
  
  function walk(currentDir: string) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(dir, fullPath);
        
        if (shouldIgnore(relativePath)) continue;
        
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          for (const pattern of patterns) {
            if (matchesPattern(relativePath, pattern)) {
              results.push(fullPath);
              break;
            }
          }
        }
      }
    } catch {
      // Ignore permission errors
    }
  }
  
  walk(dir);
  return results;
}

/**
 * Extract component name from file content
 */
function extractComponentName(content: string, filePath: string): string | null {
  // React: export default function ComponentName or export const ComponentName
  const reactMatch = content.match(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][a-zA-Z0-9]*)/);
  if (reactMatch) return reactMatch[1];
  
  // Vue: name: 'ComponentName' or export default { name: 'ComponentName' }
  const vueMatch = content.match(/name:\s*['"]([A-Z][a-zA-Z0-9]*)['"]/);
  if (vueMatch) return vueMatch[1];
  
  // Fall back to filename
  const basename = path.basename(filePath, path.extname(filePath));
  if (/^[A-Z]/.test(basename)) return basename;
  
  return null;
}

/**
 * Detect components from source files
 */
function detectComponents(rootDir: string): DetectedSymbol[] {
  const symbols: DetectedSymbol[] = [];
  const files = findFiles(rootDir, SCAN_PATTERNS.components);
  
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(rootDir, filePath);
      
      // Check for JSDoc @component tag
      const jsdocMatch = content.match(/@component\s+([^\n]+)/);
      if (jsdocMatch) {
        symbols.push({
          id: jsdocMatch[1].trim().replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase(),
          type: 'component',
          description: jsdocMatch[1].trim(),
          source: relativePath,
          confidence: 'high',
        });
        continue;
      }
      
      // Detect React/Vue components
      const componentName = extractComponentName(content, filePath);
      if (componentName) {
        // Skip index files and common utility names
        if (['Index', 'App', 'Main', 'Root'].includes(componentName)) continue;
        
        const id = componentName
          .replace(/([a-z])([A-Z])/g, '$1-$2')
          .toLowerCase();
        
        symbols.push({
          id,
          type: 'component',
          description: `${componentName} component`,
          source: relativePath,
          confidence: 'medium',
        });
      }
    } catch {
      // Skip files we can't read
    }
  }
  
  return symbols;
}

/**
 * Detect routes/flows from source files
 */
function detectRoutes(rootDir: string): DetectedSymbol[] {
  const symbols: DetectedSymbol[] = [];
  const files = findFiles(rootDir, SCAN_PATTERNS.routes);
  
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(rootDir, filePath);
      
      // Next.js app router pages
      if (relativePath.includes('/app/') && relativePath.endsWith('page.tsx')) {
        const routePath = relativePath
          .replace(/^.*\/app/, '')
          .replace(/\/page\.tsx$/, '')
          .replace(/\[([^\]]+)\]/g, ':$1') || '/';
        
        const id = routePath
          .replace(/^\//, '')
          .replace(/\//g, '-')
          .replace(/:/g, '')
          .toLowerCase() || 'home';
        
        symbols.push({
          id: `${id}-page`,
          type: 'flow',
          description: `Page route: ${routePath}`,
          source: relativePath,
          confidence: 'high',
        });
        continue;
      }
      
      // Express-style routes: app.get('/path', ...)
      const expressMatches = content.matchAll(/(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi);
      for (const match of expressMatches) {
        const [, method, route] = match;
        const id = route
          .replace(/^\//, '')
          .replace(/\//g, '-')
          .replace(/:/g, '')
          .toLowerCase() || 'root';
        
        symbols.push({
          id: `${method.toLowerCase()}-${id}`,
          type: 'flow',
          description: `${method.toUpperCase()} ${route}`,
          source: relativePath,
          confidence: 'high',
        });
      }
      
      // React Router routes: <Route path="/..." />
      const reactRouterMatches = content.matchAll(/<Route[^>]+path=["']([^"']+)["']/gi);
      for (const match of reactRouterMatches) {
        const route = match[1];
        const id = route
          .replace(/^\//, '')
          .replace(/\//g, '-')
          .replace(/:/g, '')
          .toLowerCase() || 'home';
        
        symbols.push({
          id: `${id}-route`,
          type: 'flow',
          description: `Route: ${route}`,
          source: relativePath,
          confidence: 'medium',
        });
      }
    } catch {
      // Skip files we can't read
    }
  }
  
  return symbols;
}

/**
 * Detect auth patterns (gates)
 */
function detectAuth(rootDir: string): DetectedSymbol[] {
  const symbols: DetectedSymbol[] = [];
  
  // Scan both dedicated auth files AND all source files for auth patterns
  const authFiles = findFiles(rootDir, SCAN_PATTERNS.auth);
  const allFiles = findFiles(rootDir, ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']);
  const files = [...new Set([...authFiles, ...allFiles.slice(0, 100)])]; // Dedupe and limit
  
  // Auth middleware patterns - expanded list
  const authPatterns = [
    { pattern: /isAuthenticated|requireAuth|authMiddleware|withAuth|useAuth/i, id: 'authenticated', desc: 'User must be authenticated' },
    { pattern: /isAdmin|requireAdmin|adminOnly|adminRequired/i, id: 'admin-only', desc: 'Admin access required' },
    { pattern: /hasRole|requireRole|checkRole|roleGuard/i, id: 'role-required', desc: 'Specific role required' },
    { pattern: /hasPermission|requirePermission|checkPermission|canAccess/i, id: 'permission-required', desc: 'Specific permission required' },
    { pattern: /isSubscribed|requireSubscription|premiumOnly|subscriptionRequired|isPremium/i, id: 'subscription-required', desc: 'Subscription required' },
    { pattern: /isOwner|requireOwner|ownerOnly/i, id: 'owner-only', desc: 'Resource owner access required' },
    { pattern: /isVerified|requireVerification|verifiedOnly/i, id: 'verified-required', desc: 'Email verification required' },
    { pattern: /rateLimit|rateLimiter|throttle/i, id: 'rate-limited', desc: 'Rate limiting applied' },
    { pattern: /csrf|csrfProtection|xsrf/i, id: 'csrf-protected', desc: 'CSRF protection required' },
  ];
  
  // RLS (Row Level Security) patterns for Supabase/Postgres
  const rlsPatterns = [
    { pattern: /\.rls\s*\(|enableRLS|row.*level.*security/i, id: 'rls-enabled', desc: 'Row-level security enabled' },
    { pattern: /auth\.uid\(\)|current_user|session_user/i, id: 'user-scoped', desc: 'Data scoped to current user' },
  ];
  
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(rootDir, filePath);
      
      // Check standard auth patterns
      for (const { pattern, id, desc } of [...authPatterns, ...rlsPatterns]) {
        if (pattern.test(content)) {
          if (!symbols.find(s => s.id === id)) {
            symbols.push({
              id,
              type: 'gate',
              description: desc,
              source: relativePath,
              confidence: 'high',
            });
          }
        }
      }
      
      // Look for ProtectedRoute components
      if (/ProtectedRoute|PrivateRoute|AuthRoute|GuardedRoute/i.test(content)) {
        if (!symbols.find(s => s.id === 'route-protected')) {
          symbols.push({
            id: 'route-protected',
            type: 'gate',
            description: 'Route requires authentication',
            source: relativePath,
            confidence: 'high',
          });
        }
      }
    } catch {
      // Skip files we can't read
    }
  }
  
  return symbols;
}

/**
 * Detect error/event patterns (signals)
 */
function detectSignals(rootDir: string): DetectedSymbol[] {
  const symbols: DetectedSymbol[] = [];
  
  // Look for common error/event patterns in all JS/TS files
  const allFiles = findFiles(rootDir, ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']);
  
  // Signal patterns to detect
  const signalPatterns = [
    // Event emitters
    { pattern: /emit\s*\(\s*['"]([^'"]+)['"]/, type: 'event', category: 'emit' },
    { pattern: /dispatch\s*\(\s*\{?\s*type:\s*['"]([^'"]+)['"]/, type: 'event', category: 'redux' },
    { pattern: /dispatchEvent\s*\(\s*new\s+\w+\s*\(\s*['"]([^'"]+)['"]/, type: 'event', category: 'dom' },
    
    // Error types
    { pattern: /throw\s+new\s+(\w+Error)/, type: 'error', category: 'exception' },
    { pattern: /new\s+(ApiError|HttpError|ValidationError|AuthError)\s*\(/, type: 'error', category: 'api' },
    
    // Logging
    { pattern: /log\.(error|warn)\s*\(\s*['"]([^'"]+)['"]/, type: 'log', category: 'logging' },
    { pattern: /console\.(error|warn)\s*\(\s*['"]([^'"]+)['"]/, type: 'log', category: 'console' },
    
    // Toast/Notifications
    { pattern: /toast\.(success|error|warning|info)\s*\(\s*['"]([^'"]+)['"]/, type: 'notification', category: 'toast' },
    { pattern: /notify\s*\(\s*\{[^}]*message:\s*['"]([^'"]+)['"]/, type: 'notification', category: 'notify' },
    { pattern: /showNotification\s*\(\s*['"]([^'"]+)['"]/, type: 'notification', category: 'notification' },
    
    // Analytics
    { pattern: /track\s*\(\s*['"]([^'"]+)['"]/, type: 'analytics', category: 'tracking' },
    { pattern: /analytics\.(track|page|identify)\s*\(\s*['"]([^'"]+)['"]/, type: 'analytics', category: 'analytics' },
    { pattern: /gtag\s*\(\s*['"]event['"]\s*,\s*['"]([^'"]+)['"]/, type: 'analytics', category: 'ga' },
    
    // Paradigm signals (if already using)
    { pattern: /log\.signal\s*\(\s*['"]!?([^'"]+)['"]/, type: 'signal', category: 'paradigm' },
  ];
  
  const seen = new Set<string>();
  
  for (const filePath of allFiles.slice(0, 100)) {  // Increased limit
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relativePath = path.relative(rootDir, filePath);
      
      for (const { pattern, type, category } of signalPatterns) {
        const matches = content.matchAll(new RegExp(pattern, 'gi'));
        for (const match of matches) {
          const name = match[1] || match[2];
          if (!name || seen.has(name)) continue;
          
          // Skip common false positives
          if (name.length < 3 || name.length > 50) continue;
          if (/^[a-z]$|^%s|^\$\{/.test(name)) continue; // Template strings, format specifiers
          
          seen.add(name);
          
          const id = name
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/Error$/, '')
            .replace(/[^a-zA-Z0-9-]/g, '-')
            .toLowerCase();
          
          // Determine confidence based on pattern type
          const confidence = category === 'paradigm' ? 'high' : 
                            (type === 'error' || type === 'event') ? 'medium' : 'low';
          
          symbols.push({
            id,
            type: 'signal',
            description: `${type === 'error' ? 'Error: ' : type === 'analytics' ? 'Event: ' : ''}${name}`,
            source: relativePath,
            confidence,
          });
        }
      }
    } catch {
      // Skip files we can't read
    }
  }
  
  return symbols;
}

/**
 * Group symbols by directory for .purpose file generation
 */
function groupSymbolsByDirectory(symbols: DetectedSymbol[], _rootDir: string): Map<string, DetectedSymbol[]> {
  const groups = new Map<string, DetectedSymbol[]>();
  
  for (const symbol of symbols) {
    // Get the directory of the source file
    const sourceDir = path.dirname(symbol.source);
    
    // Determine the best directory for this symbol's .purpose file
    let targetDir = sourceDir;
    
    // If it's deeply nested, use a parent directory
    const parts = sourceDir.split(path.sep);
    if (parts.length > 3) {
      targetDir = parts.slice(0, 3).join(path.sep);
    }
    
    // Use root for top-level
    if (targetDir === '.' || targetDir === '') {
      targetDir = '.';
    }
    
    if (!groups.has(targetDir)) {
      groups.set(targetDir, []);
    }
    groups.get(targetDir)!.push(symbol);
  }
  
  return groups;
}

/**
 * Generate .purpose file content from symbols
 */
function generatePurposeContent(symbols: DetectedSymbol[], dirPath: string): string {
  const features = symbols.filter(s => s.type === 'feature');
  const components = symbols.filter(s => s.type === 'component');
  const flows = symbols.filter(s => s.type === 'flow');
  const gates = symbols.filter(s => s.type === 'gate');
  const signals = symbols.filter(s => s.type === 'signal');
  
  const data: Record<string, unknown> = {
    description: `Auto-generated purpose file for ${dirPath || 'project root'}`,
  };
  
  if (features.length > 0) {
    data.features = Object.fromEntries(
      features.map(f => [f.id, { description: f.description }])
    );
  }
  
  if (components.length > 0) {
    data.components = Object.fromEntries(
      components.map(c => [c.id, { description: c.description }])
    );
  }
  
  if (flows.length > 0) {
    data.flows = Object.fromEntries(
      flows.map(f => [f.id, { description: f.description }])
    );
  }
  
  if (gates.length > 0) {
    data.gates = Object.fromEntries(
      gates.map(g => [g.id, { description: g.description }])
    );
  }
  
  if (signals.length > 0) {
    data.signals = Object.fromEntries(
      signals.map(s => [s.id, { description: s.description, category: 'auto-detected' }])
    );
  }
  
  return yaml.dump(data, { lineWidth: -1, noRefs: true });
}

/**
 * Main auto-scan command
 */
export async function autoScanCommand(targetPath: string | undefined, options: AutoScanOptions) {
  const rootDir = targetPath ? path.resolve(targetPath) : process.cwd();
  const spinner = ora();
  
  if (!options.json) {
    console.log(chalk.blue('\n🔍 Paradigm Auto-Scan\n'));
    console.log(chalk.gray('Analyzing codebase for symbols...\n'));
  }
  
  // Detect symbols
  spinner.start('Detecting components...');
  const components = detectComponents(rootDir);
  spinner.text = `Found ${components.length} components`;
  
  spinner.text = 'Detecting routes/flows...';
  const routes = detectRoutes(rootDir);
  spinner.text = `Found ${routes.length} routes`;
  
  spinner.text = 'Detecting auth patterns...';
  const gates = detectAuth(rootDir);
  spinner.text = `Found ${gates.length} gates`;
  
  spinner.text = 'Detecting signals...';
  const signals = detectSignals(rootDir);
  spinner.stop();
  
  // Combine all symbols
  const allSymbols = [...components, ...routes, ...gates, ...signals];
  
  if (!options.json) {
    console.log(chalk.cyan('Detected symbols:'));
    console.log(`  Components: ${chalk.yellow(components.length.toString())}`);
    console.log(`  Flows:      ${chalk.yellow(routes.length.toString())}`);
    console.log(`  Gates:      ${chalk.yellow(gates.length.toString())}`);
    console.log(`  Signals:    ${chalk.yellow(signals.length.toString())}`);
    console.log(`  Total:      ${chalk.yellow(allSymbols.length.toString())}`);
    console.log();
  }
  
  if (allSymbols.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ symbols: [], generated: [], skipped: [] }));
    } else {
      console.log(chalk.yellow('No symbols detected. This might be a non-standard project structure.\n'));
    }
    return;
  }
  
  // Group by directory
  const groups = groupSymbolsByDirectory(allSymbols, rootDir);
  
  // Generate .purpose files
  const generated: GeneratedPurpose[] = [];
  const skipped: string[] = [];
  
  for (const [dir, symbols] of groups) {
    const purposePath = path.join(rootDir, dir, '.purpose');
    const exists = fs.existsSync(purposePath);
    
    if (exists && !options.force) {
      skipped.push(purposePath);
      continue;
    }
    
    const content = generatePurposeContent(symbols, dir);
    
    generated.push({
      path: purposePath,
      content,
      symbols,
      isNew: !exists,
    });
  }
  
  // JSON output
  if (options.json) {
    console.log(JSON.stringify({
      symbols: allSymbols,
      generated: generated.map(g => ({
        path: path.relative(rootDir, g.path),
        symbolCount: g.symbols.length,
        isNew: g.isNew,
      })),
      skipped: skipped.map(s => path.relative(rootDir, s)),
    }, null, 2));
    return;
  }
  
  // Show what will be generated
  if (generated.length === 0) {
    console.log(chalk.yellow('All .purpose files already exist. Use --force to overwrite.\n'));
    return;
  }
  
  console.log(chalk.cyan('Will generate:'));
  for (const g of generated) {
    const relativePath = path.relative(rootDir, g.path);
    const badge = g.isNew ? chalk.green('[new]') : chalk.yellow('[update]');
    console.log(`  ${badge} ${relativePath} (${g.symbols.length} symbols)`);
  }
  
  if (skipped.length > 0) {
    console.log(chalk.gray(`\nSkipped ${skipped.length} existing file(s). Use --force to overwrite.`));
  }
  
  // Dry run stops here
  if (options.dryRun) {
    console.log(chalk.gray('\n[Dry run] No files written.\n'));
    return;
  }
  
  // Write files
  console.log();
  spinner.start('Writing .purpose files...');
  
  for (const g of generated) {
    const dir = path.dirname(g.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(g.path, g.content);
  }
  
  spinner.succeed(chalk.green(`Generated ${generated.length} .purpose file(s)`));
  
  console.log(chalk.gray('\nNext steps:'));
  console.log(chalk.gray('  1. Review generated files and adjust descriptions'));
  console.log(chalk.gray('  2. Run `paradigm lint` to validate'));
  console.log(chalk.gray('  3. Run `paradigm index` to build scan index\n'));
}
