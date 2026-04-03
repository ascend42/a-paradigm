/**
 * Captain (Cid) MCP Tools
 *
 * Tools:
 * - paradigm_captain_brief: Pre-task context discovery pipeline
 * - paradigm_captain_debrief: Post-task coverage audit and maintenance
 *
 * Cid runs before and after all orchestration. He consolidates all pre-task
 * symbol navigation into one structured phase and ensures .purpose coverage
 * is maintained after every session.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProjectContext } from '../utils/index-loader.js';
import { searchSymbols, getSymbolsByType, getAllSymbols } from '@a-company/premise-core';
import { trackToolCall } from './context.js';
import { handleNavigateTool } from './navigate.js';
import { handleRippleTool } from './ripple.js';
import { handleWisdomTool } from './wisdom.js';
import { handleProtocolsTool } from './protocols.js';
import { handleLoreTool } from './lore.js';
import type { ToolDefinition } from '../utils/tool-registry.js';
import type {
  ContextBrief,
  ContextBriefSymbol,
  ContextBriefBlastRadius,
  DebriefReport,
  SessionInsights,
  SessionInsightsAgentContribution,
  CidSessionMarker,
  CidBriefedMarker,
} from '../types/captain.js';

// ────────────────────────────────────────────────────────
// Tool Definitions
// ────────────────────────────────────────────────────────

export function getCaptainToolsList(): ToolDefinition[] {
  return [
    {
      name: 'paradigm_captain_brief',
      description:
        'Cid\'s pre-task context discovery pipeline. Searches symbols, maps blast radius, checks gates, finds protocols, surfaces warnings, and produces a Context Brief injected into every subsequent agent. Call before starting any multi-file task. ~400 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          taskDescription: {
            type: 'string',
            description: 'The task to produce a context brief for',
          },
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional pre-known symbols to anchor the search (e.g., ["#auth", "^authenticated"])',
          },
          depth: {
            type: 'string',
            enum: ['quick', 'standard', 'deep'],
            description: 'Brief depth. quick=search+navigate only (<800 tokens). standard=+ripple top 3+wisdom. deep=+ripple top 5+full lore scan. Default: standard',
          },
        },
        required: ['taskDescription'],
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: 'paradigm_captain_debrief',
      description:
        'Cid\'s post-task maintenance pass. Audits .purpose coverage for touched directories, creates stubs for gaps, queues rich doc areas to Documentor, records lore, and writes the .cid-briefed marker that clears the stop hook. Call after all agents complete. ~200 tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          orchestrationId: {
            type: 'string',
            description: 'The orchestration run ID (from paradigm_orchestrate_inline)',
          },
          sessionSummary: {
            type: 'string',
            description: 'What was accomplished in this session',
          },
          touchedFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files modified during this session',
          },
          newSymbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'New symbols registered during this session',
          },
          notes: {
            type: 'string',
            description: 'Optional additional notes from the orchestrating session',
          },
        },
        required: ['orchestrationId', 'sessionSummary', 'touchedFiles'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];
}

// ────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────

export async function handleCaptainTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  if (name === 'paradigm_captain_brief') {
    return handleCaptainBrief(args, ctx);
  }
  if (name === 'paradigm_captain_debrief') {
    return handleCaptainDebrief(args, ctx);
  }
  return { handled: false, text: '' };
}

// ────────────────────────────────────────────────────────
// Brief Handler
// ────────────────────────────────────────────────────────

async function handleCaptainBrief(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const taskDescription = args.taskDescription as string;
  const anchorSymbols = (args.symbols as string[] | undefined) || [];
  const depth = (args.depth as 'quick' | 'standard' | 'deep' | undefined) || 'standard';

  // Clear previous session markers and start fresh
  const paradigmDir = path.join(ctx.rootDir, '.paradigm');
  const sessionMarkerPath = path.join(paradigmDir, '.cid-session');
  const briefedMarkerPath = path.join(paradigmDir, '.cid-briefed');

  try {
    // Clear .cid-briefed marker — new session starts fresh
    if (fs.existsSync(briefedMarkerPath)) {
      fs.unlinkSync(briefedMarkerPath);
    }
    // Write .cid-session marker
    const sessionMarker: CidSessionMarker = {
      timestamp: new Date().toISOString(),
      taskDescription: taskDescription.slice(0, 200),
      depth,
    };
    fs.mkdirSync(paradigmDir, { recursive: true });
    fs.writeFileSync(sessionMarkerPath, JSON.stringify(sessionMarker, null, 2), 'utf8');
  } catch {
    // Session marker write is non-fatal
  }

  // ── Step 1: Extract keyword clusters from task ───────
  const keywords = extractKeywords(taskDescription);

  // ── Step 2: Search symbols for each keyword cluster ──
  const foundSymbols: ContextBriefSymbol[] = [];
  const seenSymbolIds = new Set<string>();

  // Add any pre-known anchor symbols
  for (const sym of anchorSymbols) {
    if (!seenSymbolIds.has(sym)) {
      seenSymbolIds.add(sym);
      const type = inferSymbolType(sym);
      foundSymbols.push({ id: sym, type, description: 'Provided as anchor symbol' });
    }
  }

  // Search for each keyword cluster
  const searchResults: string[] = [];
  try {
    for (const cluster of keywords.slice(0, 3)) {
      const results = searchSymbols(ctx.index, cluster);
      const top = results.slice(0, 5);
      for (const r of top) {
        if (!seenSymbolIds.has(r.symbol)) {
          seenSymbolIds.add(r.symbol);
          const symType = mapSymbolType(r.type);
          foundSymbols.push({
            id: r.symbol,
            type: symType,
            description: r.description || '',
            file: r.file,
          });
          searchResults.push(r.symbol);
        }
      }
    }
  } catch {
    // Search is non-fatal
  }

  // ── Step 3: Navigate with full task context ──────────
  const navigateResult: { directories: string[]; files: string[] } = { directories: [], files: [] };
  try {
    const navResponse = await handleNavigateTool(
      'paradigm_navigate',
      { intent: 'context', task: taskDescription, response_format: 'concise' },
      ctx,
    );
    if (navResponse.handled) {
      const navData = JSON.parse(navResponse.text);
      // Extract directories and files from navigate result
      if (navData.files) {
        for (const f of navData.files) {
          const fileStr = typeof f === 'string' ? f : (f.path || f.file || '');
          if (fileStr) navigateResult.files.push(fileStr);
        }
      }
      if (navData.directories) {
        for (const d of navData.directories) {
          const dirStr = typeof d === 'string' ? d : (d.path || d.directory || '');
          if (dirStr) navigateResult.directories.push(dirStr);
        }
      }
      // Also pull symbols from nav results
      if (navData.symbols) {
        for (const s of navData.symbols) {
          const symId = typeof s === 'string' ? s : s.id;
          if (symId && !seenSymbolIds.has(symId)) {
            seenSymbolIds.add(symId);
            foundSymbols.push({
              id: symId,
              type: inferSymbolType(symId),
              description: typeof s === 'object' ? (s.description || '') : '',
            });
          }
        }
      }
    }
  } catch {
    // Navigate is non-fatal
  }

  // Derive directories from found files
  const dirSet = new Set<string>(navigateResult.directories);
  for (const f of navigateResult.files) {
    const d = path.dirname(f);
    if (d && d !== '.') dirSet.add(d);
  }

  // Determine ripple depth by brief depth setting
  const symbolsToRipple = foundSymbols.slice(0, depth === 'deep' ? 5 : 3);
  const blastRadius: ContextBriefBlastRadius = {
    affectedFiles: [],
    affectedSymbols: [],
    affectedFlows: [],
    affectedGates: [],
    fragileSymbols: [],
  };

  // ── Step 4: Ripple on top symbols ───────────────────
  if (depth !== 'quick' && symbolsToRipple.length > 0) {
    for (const sym of symbolsToRipple) {
      try {
        const rippleResponse = await handleRippleTool(
          'paradigm_ripple',
          { symbol: sym.id, depth: 2, response_format: 'concise' },
          ctx,
        );
        if (rippleResponse.handled) {
          const rd = JSON.parse(rippleResponse.text);
          if (rd.analysis) {
            // Collect affected symbols
            for (const ds of (rd.analysis.directlyAffected || [])) {
              const dsId = ds.symbol || ds;
              if (dsId && !blastRadius.affectedSymbols.includes(dsId)) {
                blastRadius.affectedSymbols.push(dsId);
              }
            }
            for (const is of (rd.analysis.indirectlyAffected || [])) {
              if (is && !blastRadius.affectedSymbols.includes(is)) {
                blastRadius.affectedSymbols.push(is);
              }
            }
          }
          // Flows
          if (rd.affectedFlows?.affectedFlows) {
            for (const f of rd.affectedFlows.affectedFlows) {
              const fId = f.flowId || f;
              if (fId && !blastRadius.affectedFlows.includes(fId)) {
                blastRadius.affectedFlows.push(fId);
              }
            }
          }
          // Gates
          if (rd.affectedGates) {
            for (const g of rd.affectedGates) {
              const gId = g.gate || g;
              if (gId && !blastRadius.affectedGates.includes(gId)) {
                blastRadius.affectedGates.push(gId);
              }
            }
          }
          // High-impact symbols are "fragile"
          if (rd.impact === 'high') {
            if (!blastRadius.fragileSymbols.includes(sym.id)) {
              blastRadius.fragileSymbols.push(sym.id);
            }
          }
        }
      } catch {
        // Ripple is non-fatal per symbol
      }
    }
  }

  // ── Step 5: Check gates for any route patterns ───────
  const detectedGates: Array<{ route: string; gate: string; declared: boolean }> = [];
  const routePatterns = extractRoutePatterns(taskDescription);
  if (routePatterns.length > 0) {
    try {
      const { handleGatesForRoute } = await import('./index.js').catch(() => ({ handleGatesForRoute: null }));
      // We can't easily call gates_for_route without the inline handler,
      // so we check portal.yaml directly
      const portalPath = path.join(ctx.rootDir, 'portal.yaml');
      if (fs.existsSync(portalPath)) {
        const portalContent = fs.readFileSync(portalPath, 'utf8');
        for (const route of routePatterns) {
          const declared = portalContent.includes(route);
          detectedGates.push({ route, gate: '^authenticated', declared });
        }
      } else {
        for (const route of routePatterns) {
          detectedGates.push({ route, gate: '(unknown — no portal.yaml)', declared: false });
        }
      }
    } catch {
      // Gate detection is non-fatal
    }
  }

  // ── Step 6: Wisdom context for warnings ─────────────
  const warnings: string[] = [];
  if (depth !== 'quick' && foundSymbols.length > 0) {
    try {
      const wisdomSymbols = foundSymbols.slice(0, 5).map(s => s.id);
      const wisdomResponse = await handleWisdomTool(
        'paradigm_wisdom_context',
        { symbols: wisdomSymbols, include_global: true },
        ctx,
      );
      if (wisdomResponse.handled) {
        const wd = JSON.parse(wisdomResponse.text);
        // Extract antipattern warnings
        if (wd.antipatterns) {
          for (const ap of wd.antipatterns.slice(0, 3)) {
            const msg = ap.pattern || ap.description || ap.text || String(ap);
            if (msg && !warnings.includes(msg)) {
              warnings.push(msg);
            }
          }
        }
        if (wd.wisdom?.antipatterns) {
          for (const ap of wd.wisdom.antipatterns.slice(0, 3)) {
            const msg = ap.pattern || ap.description || String(ap);
            if (msg && !warnings.includes(msg)) {
              warnings.push(msg);
            }
          }
        }
      }
    } catch {
      // Wisdom is non-fatal
    }
  }

  // ── Step 7: Protocol search ──────────────────────────
  let protocol: ContextBrief['protocol'] = { matched: false };
  try {
    const protocolResponse = await handleProtocolsTool(
      'paradigm_protocol_search',
      { task: taskDescription, limit: 1 },
      ctx,
    );
    if (protocolResponse.handled) {
      const pd = JSON.parse(protocolResponse.text);
      const matches = pd.matches || pd.protocols || pd.results || [];
      if (matches.length > 0) {
        const top = matches[0];
        protocol = {
          matched: true,
          id: top.id,
          name: top.name || top.title,
          steps: (top.steps || []).slice(0, 5).map((s: { description?: string } | string) =>
            typeof s === 'string' ? s : (s.description || String(s)),
          ),
        };
      }
    }
  } catch {
    // Protocol search is non-fatal
  }

  // ── Step 8: Lore search for recent sessions ──────────
  const loreRefs: ContextBrief['loreRefs'] = [];
  if (depth !== 'quick') {
    try {
      const loreSymbol = foundSymbols[0]?.id;
      const loreArgs: Record<string, unknown> = { limit: depth === 'deep' ? 5 : 3 };
      if (loreSymbol) loreArgs.symbol = loreSymbol;
      const loreResponse = await handleLoreTool('paradigm_lore_search', loreArgs, ctx);
      if (loreResponse.handled) {
        const ld = JSON.parse(loreResponse.text);
        const entries = ld.entries || [];
        for (const e of entries.slice(0, 3)) {
          loreRefs.push({
            id: e.id,
            summary: (e.summary || e.title || '').slice(0, 100),
            relevance: loreSymbol ? `Related to ${loreSymbol}` : 'Recent project history',
          });
        }
      }
    } catch {
      // Lore search is non-fatal
    }
  }

  // ── Step 9: Compute coverage confidence score ────────
  const allDirs = Array.from(dirSet);
  let coveredCount = 0;
  for (const dir of allDirs) {
    const purposePath = path.join(ctx.rootDir, dir, '.purpose');
    if (fs.existsSync(purposePath)) {
      try {
        const content = fs.readFileSync(purposePath, 'utf8').trim();
        if (content.length > 50) coveredCount++;
      } catch {
        // Non-fatal
      }
    }
  }

  const coverageScore = allDirs.length > 0 ? coveredCount / allDirs.length : 0.5;
  const coverageLabel = computeCoverageLabel(coverageScore);
  const coverageNote = buildCoverageNote(coverageScore, coverageLabel, allDirs.length);

  // ── Step 10: Determine scope ─────────────────────────
  const totalAffected = blastRadius.affectedSymbols.length + navigateResult.files.length;
  const estimatedScope: ContextBrief['territory']['estimatedScope'] =
    totalAffected > 20 ? 'large' :
    totalAffected > 8 ? 'medium' :
    totalAffected > 2 ? 'small' : 'tiny';

  // ── Assemble brief ────────────────────────────────────
  const brief: ContextBrief = {
    territory: {
      directories: allDirs.slice(0, 10),
      files: navigateResult.files.slice(0, 10),
      estimatedScope,
    },
    symbols: foundSymbols.slice(0, 10),
    blastRadius,
    gates: detectedGates,
    protocol,
    warnings,
    coverage: {
      score: coverageScore,
      label: coverageLabel,
      note: coverageNote,
    },
    loreRefs,
    renderedBrief: '',
  };

  // Render brief text block
  brief.renderedBrief = renderContextBrief(brief);

  // Update session marker with coverage score
  try {
    const sessionMarker: CidSessionMarker = {
      timestamp: new Date().toISOString(),
      taskDescription: taskDescription.slice(0, 200),
      depth,
      coverageScore,
    };
    fs.writeFileSync(sessionMarkerPath, JSON.stringify(sessionMarker, null, 2), 'utf8');
  } catch {
    // Non-fatal
  }

  const text = JSON.stringify(brief, null, 2);
  trackToolCall(text.length, 'paradigm_captain_brief');
  return { handled: true, text };
}

// ────────────────────────────────────────────────────────
// Debrief Handler
// ────────────────────────────────────────────────────────

async function handleCaptainDebrief(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const orchestrationId = args.orchestrationId as string;
  const sessionSummary = args.sessionSummary as string;
  const touchedFiles = (args.touchedFiles as string[]) || [];
  const newSymbols = (args.newSymbols as string[] | undefined) || [];
  const notes = args.notes as string | undefined;

  const paradigmDir = path.join(ctx.rootDir, '.paradigm');
  const briefedMarkerPath = path.join(paradigmDir, '.cid-briefed');
  const pendingReviewPath = path.join(paradigmDir, '.pending-review');

  // ── Step 1: Check .purpose coverage for touched dirs ─
  const touchedDirs = new Set<string>();
  for (const f of touchedFiles) {
    const d = path.dirname(f);
    if (d && d !== '.') touchedDirs.add(d);
  }

  // Compute coverage before
  let coveredBefore = 0;
  const totalDirs = touchedDirs.size;
  for (const dir of touchedDirs) {
    const purposePath = path.join(ctx.rootDir, dir, '.purpose');
    if (fs.existsSync(purposePath)) {
      try {
        const content = fs.readFileSync(purposePath, 'utf8').trim();
        if (content.length > 50) coveredBefore++;
      } catch {}
    }
  }
  const scoreBefore = totalDirs > 0 ? coveredBefore / totalDirs : 1.0;

  // ── Step 2: Create stubs for uncovered directories ───
  const coverageAdded: string[] = [];
  const delegatedToDocumentor: string[] = [];

  for (const dir of touchedDirs) {
    const purposePath = path.join(ctx.rootDir, dir, '.purpose');
    const absoluteDir = path.join(ctx.rootDir, dir);

    let hasCoverage = false;
    if (fs.existsSync(purposePath)) {
      try {
        const content = fs.readFileSync(purposePath, 'utf8').trim();
        hasCoverage = content.length > 50;
      } catch {}
    }

    if (!hasCoverage) {
      // Create stub .purpose file
      try {
        if (!fs.existsSync(absoluteDir)) continue;
        const dirBasename = path.basename(dir);
        const stubContent = buildPurposeStub(dirBasename, dir, touchedFiles);
        fs.writeFileSync(purposePath, stubContent, 'utf8');
        coverageAdded.push(dir);

        // Queue for rich documentation by Documentor
        delegatedToDocumentor.push(dir);
        try {
          const pendingEntry = JSON.stringify({
            path: dir,
            reason: 'captain-debrief',
            priority: 'high',
            context: `Touched during orchestration ${orchestrationId}. Files: ${touchedFiles.filter(f => path.dirname(f) === dir).join(', ')}`,
            timestamp: new Date().toISOString(),
          });
          fs.appendFileSync(pendingReviewPath, pendingEntry + '\n', 'utf8');
        } catch {
          // Pending review append is non-fatal
        }
      } catch {
        // Stub creation is non-fatal
      }
    } else {
      // Has coverage but may need rich docs if it's a new area
      const isNewArea = touchedFiles.some(f => path.dirname(f) === dir && newSymbols.length > 0);
      if (isNewArea) {
        delegatedToDocumentor.push(dir);
        try {
          const pendingEntry = JSON.stringify({
            path: dir,
            reason: 'captain-debrief-new-symbols',
            priority: 'medium',
            context: `New symbols added during orchestration ${orchestrationId}: ${newSymbols.join(', ')}`,
            timestamp: new Date().toISOString(),
          });
          fs.appendFileSync(pendingReviewPath, pendingEntry + '\n', 'utf8');
        } catch {}
      }
    }
  }

  // Compute coverage after
  let coveredAfter = 0;
  for (const dir of touchedDirs) {
    const purposePath = path.join(ctx.rootDir, dir, '.purpose');
    if (fs.existsSync(purposePath)) {
      try {
        const content = fs.readFileSync(purposePath, 'utf8').trim();
        if (content.length > 50) coveredAfter++;
      } catch {}
    }
  }
  const scoreAfter = totalDirs > 0 ? coveredAfter / totalDirs : 1.0;

  // ── Step 4: Record lore entry ────────────────────────
  let loreEntryId = '';
  try {
    const loreResponse = await handleLoreTool(
      'paradigm_lore_record',
      {
        type: 'agent-session',
        title: `Cid Debrief: ${sessionSummary.slice(0, 80)}`,
        summary: sessionSummary,
        symbols_touched: newSymbols,
        files_modified: touchedFiles,
        tags: ['arc:cid-debrief', `orch:${orchestrationId}`],
        meta: {
          orchestrationId,
          coverageScore: { before: scoreBefore, after: scoreAfter },
          coverageAdded,
          ...(notes ? { notes } : {}),
        },
      },
      ctx,
    );
    if (loreResponse.handled) {
      const ld = JSON.parse(loreResponse.text);
      loreEntryId = ld.id || ld.entry?.id || '';
    }
  } catch {
    // Lore recording is non-fatal
  }

  // ── Step 5: Write .cid-briefed marker ───────────────
  let stopHookCleared = false;
  try {
    const marker: CidBriefedMarker = {
      timestamp: new Date().toISOString(),
      sessionId: orchestrationId,
      touchedFiles,
      coverageScore: scoreAfter,
    };
    fs.mkdirSync(paradigmDir, { recursive: true });
    fs.writeFileSync(briefedMarkerPath, JSON.stringify(marker, null, 2), 'utf8');
    stopHookCleared = true;
  } catch {
    // Marker write is non-fatal
  }

  // ── Step 6: Build sessionInsights for Loid ──────────
  const sessionInsights: SessionInsights = {
    taskDescription: sessionSummary,
    orchestrationId,
    agentContributions: [] as SessionInsightsAgentContribution[],
    coverageDelta: {
      before: scoreBefore,
      after: scoreAfter,
    },
    newSymbols: newSymbols,
    touchedFiles: touchedFiles,
    notes: notes || '',
  };

  // Parse the session work log for per-agent contributions (fault-tolerant)
  try {
    const sessionLogPath = path.join(paradigmDir, 'events', 'session-log.jsonl');
    if (fs.existsSync(sessionLogPath)) {
      const logContent = fs.readFileSync(sessionLogPath, 'utf8');
      const lines = logContent.split('\n').filter(l => l.trim().length > 0);
      // Take the last 50 lines to avoid processing unbounded history
      const recentLines = lines.slice(-50);

      const byAgent = new Map<string, {
        contributions: string[];
        symbolsTouched: Set<string>;
        patternsObserved: string[];
      }>();

      for (const line of recentLines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          const agentId = (entry.agentId || entry.agent || entry.role || '') as string;
          if (!agentId) continue;

          if (!byAgent.has(agentId)) {
            byAgent.set(agentId, { contributions: [], symbolsTouched: new Set(), patternsObserved: [] });
          }
          const bucket = byAgent.get(agentId)!;

          const action = (entry.action || entry.event || entry.message || '') as string;
          if (action) bucket.contributions.push(String(action).slice(0, 120));

          // Collect symbols mentioned in the log entry
          if (Array.isArray(entry.symbols)) {
            for (const sym of entry.symbols as string[]) {
              bucket.symbolsTouched.add(String(sym));
            }
          }
          const entrySymbol = (entry.symbol || '') as string;
          if (entrySymbol) bucket.symbolsTouched.add(entrySymbol);

          // Collect patterns if recorded
          if (Array.isArray(entry.patterns)) {
            for (const p of entry.patterns as string[]) {
              if (!bucket.patternsObserved.includes(String(p))) {
                bucket.patternsObserved.push(String(p));
              }
            }
          }
        } catch {
          // Malformed log line — skip silently
        }
      }

      // Convert grouped contributions into the sessionInsights array
      for (const [agentId, data] of byAgent.entries()) {
        sessionInsights.agentContributions.push({
          agentId,
          contribution: data.contributions.slice(-3).join(' | '),
          symbolsTouched: Array.from(data.symbolsTouched).slice(0, 10),
          patternsObserved: data.patternsObserved.slice(0, 5),
        });
      }
    }
  } catch {
    // Session log parsing is non-fatal
  }

  // Fallback: if no contributions were parsed, create one from the session summary
  if (sessionInsights.agentContributions.length === 0) {
    sessionInsights.agentContributions.push({
      agentId: 'session',
      contribution: sessionSummary.slice(0, 200),
      symbolsTouched: newSymbols.slice(0, 10),
      patternsObserved: [],
    });
  }

  // ── Assemble debrief report ───────────────────────────
  const report: DebriefReport = {
    coverageAdded,
    delegatedToDocumentor,
    loreEntryId,
    coverageScore: {
      before: scoreBefore,
      after: scoreAfter,
      delta: scoreAfter - scoreBefore,
    },
    stopHookCleared,
    sessionInsights,
  };

  const learningHandoff = [
    '',
    '━━━ LEARNING HANDOFF (→ Loid) ━━━━━━━━━━━━━━━━━━━━━',
    '',
    "Cid has prepared session insights for Loid's learning pass.",
    'Call paradigm_ambient_learn_postflight with the sessionInsights',
    'from this debrief to complete the session.',
    '',
    'sessionInsights available in: debrief.sessionInsights',
  ].join('\n');

  const reportJson = JSON.stringify(report, null, 2);
  const text = reportJson + '\n' + learningHandoff;
  trackToolCall(text.length, 'paradigm_captain_debrief');
  return { handled: true, text };
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function extractKeywords(task: string): string[] {
  // Tokenize and extract meaningful clusters, filtering stop words
  const stopWords = new Set([
    'the', 'a', 'an', 'to', 'of', 'in', 'and', 'or', 'for', 'with',
    'that', 'this', 'is', 'it', 'be', 'as', 'at', 'by', 'from',
    'add', 'create', 'update', 'fix', 'implement', 'make', 'build',
    'change', 'modify', 'new', 'old', 'get', 'set', 'use', 'using',
  ]);

  // Extract symbol-like tokens first (prefixed)
  const symbolTokens = task.match(/[#$^!~@&%?][a-z][a-z0-9-]*/g) || [];

  // Extract camelCase or kebab-case words
  const words = task
    .replace(/[#$^!~@&%?]/g, ' ')
    .split(/[\s\-_\/.,;:'"()\[\]{}!?]+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Combine and deduplicate
  const combined = [...new Set([...symbolTokens, ...words])];
  return combined.slice(0, 6);
}

function extractRoutePatterns(task: string): string[] {
  // Look for REST-like route patterns in the task description
  const patterns: string[] = [];
  const routeRe = /(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[a-z0-9\-\/:_{}]+)/gi;
  let match;
  while ((match = routeRe.exec(task)) !== null) {
    patterns.push(match[1]);
  }
  // Also look for path-like strings
  const pathRe = /\/api\/[a-z0-9\-\/:_{}]+/g;
  while ((match = pathRe.exec(task)) !== null) {
    if (!patterns.includes(match[0])) patterns.push(match[0]);
  }
  return patterns;
}

function inferSymbolType(sym: string): ContextBriefSymbol['type'] {
  if (sym.startsWith('#')) return 'component';
  if (sym.startsWith('$')) return 'flow';
  if (sym.startsWith('^')) return 'gate';
  if (sym.startsWith('!')) return 'signal';
  if (sym.startsWith('~')) return 'aspect';
  return 'component';
}

function mapSymbolType(indexType: string): ContextBriefSymbol['type'] {
  switch (indexType) {
    case 'component': return 'component';
    case 'flow': return 'flow';
    case 'gate': return 'gate';
    case 'signal': return 'signal';
    case 'aspect': return 'aspect';
    default: return 'component';
  }
}

function computeCoverageLabel(score: number): ContextBrief['coverage']['label'] {
  if (score >= 0.85) return 'comprehensive';
  if (score >= 0.6) return 'reliable';
  if (score >= 0.3) return 'partial';
  return 'sparse';
}

function buildCoverageNote(score: number, label: ContextBrief['coverage']['label'], dirCount: number): string {
  const pct = Math.round(score * 100);
  switch (label) {
    case 'sparse':
      return `${pct}% of ${dirCount} director(ies) covered. Brief may be significantly incomplete. Builder should explore directly.`;
    case 'partial':
      return `${pct}% of ${dirCount} director(ies) covered. Brief covers key symbols. Some areas uncharted.`;
    case 'reliable':
      return `${pct}% of ${dirCount} director(ies) covered. Brief is reliable for this task.`;
    case 'comprehensive':
      return `${pct}% of ${dirCount} director(ies) covered. Area is fully mapped.`;
  }
}

function renderContextBrief(brief: ContextBrief): string {
  const lines: string[] = [];
  const divider = '━'.repeat(52);

  lines.push(`${divider}`);
  lines.push('');

  // Territory
  const dirs = brief.territory.directories.slice(0, 3).join(', ') || '(none detected)';
  lines.push(`Territory:     ${dirs}`);

  // Symbols
  const symList = brief.symbols.slice(0, 5).map(s => s.id).join(', ') || '(none found)';
  lines.push(`Symbols:       ${symList}`);

  // Blast radius
  const fileCount = brief.blastRadius.affectedFiles.length + brief.territory.files.length;
  const flowCount = brief.blastRadius.affectedFlows.length;
  const gateCount = brief.blastRadius.affectedGates.length;
  const fragile = brief.blastRadius.fragileSymbols.length > 0
    ? ` · ⚠ ${brief.blastRadius.fragileSymbols.slice(0, 2).join(', ')} (fragile)`
    : '';
  lines.push(`Blast Radius:  ${fileCount} files · ${flowCount} flows · ${gateCount} gates${fragile}`);

  // Gates
  if (brief.gates.length > 0) {
    const gateLines = brief.gates.slice(0, 2).map(g =>
      `${g.route} → ${g.gate} (${g.declared ? 'declared ✓' : 'UNDECLARED ✗'})`,
    );
    lines.push(`Gates:         ${gateLines.join('; ')}`);
  }

  // Protocol
  if (brief.protocol.matched) {
    const steps = brief.protocol.steps?.length ? ` (${brief.protocol.steps.length} steps)` : '';
    lines.push(`Protocol:      ${brief.protocol.name || brief.protocol.id}${steps} — matched`);
  } else {
    lines.push(`Protocol:      (none matched)`);
  }

  // Warnings
  if (brief.warnings.length > 0) {
    lines.push(`Warnings:      "${brief.warnings[0].slice(0, 80)}"`);
  }

  // Coverage
  const pct = Math.round(brief.coverage.score * 100);
  lines.push(`Coverage:      ${pct}% — brief is ${brief.coverage.label}`);

  lines.push('');
  lines.push(`${divider}`);

  return lines.join('\n');
}

function buildPurposeStub(dirBasename: string, dirPath: string, touchedFiles: string[]): string {
  const relevant = touchedFiles.filter(f => path.dirname(f) === dirPath);
  const fileList = relevant.slice(0, 3).map(f => `# - ${path.basename(f)}`).join('\n');

  return `# Auto-generated .purpose stub — created by Cid (captain debrief)
# Delegate to Scribe (Documentor) for rich documentation
name: ${dirBasename}
description: "TODO: describe what this directory/module does"
context:
  - "Stub created by Cid during coverage audit — update with real context"
${fileList ? `# Key files touched:\n${fileList}` : ''}
components:
  ${dirBasename}:
    description: "TODO: describe this component"
    tags: []
`;
}
