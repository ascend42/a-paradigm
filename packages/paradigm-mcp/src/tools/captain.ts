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
import { loadArchMap } from '../utils/arch-loader.js';
import { log } from '../utils/mcp-logger.js';
import { trackToolCall } from './context.js';
import { handleNavigateTool } from './navigate.js';
import { handleRippleTool } from './ripple.js';
import { handleWisdomTool } from './wisdom.js';
import { handleProtocolsTool } from './protocols.js';
import { handleLoreTool } from './lore.js';
import { recordOrchestrationCompletion } from '../utils/orchestration-marker.js';
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
  CaptainBoard,
  BoardRun,
  BoardNode,
  BoardUnclaimed,
  RunStatus,
} from '../types/captain.js';
import type { Task, Claimant } from '../utils/task-loader.js';

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
    {
      name: 'paradigm_captain_board',
      description:
        "Cid's owned run-DAG board (#captain-board). action='read' (default, read-only) assembles the live orchestration DAG — each run's epic + ordered stage-children with status/claimant/dependsOn, plus ripple-ranked unclaimed open tasks and a summary. action='claim' writes a task's claimant (status stays open; human/peer claims override an archetype proposal). action='advance' records a blocked_on reason without changing status (orchestration owns in-progress/done). ~300 tokens.",
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'claim', 'advance'],
            description: "Board action. Default 'read'.",
          },
          taskId: {
            type: 'string',
            description: 'Target task id (required for claim/advance).',
          },
          claimant: {
            type: 'object',
            description: "For claim: the new owner { kind: 'archetype'|'human'|'peer', ref }.",
            properties: {
              kind: { type: 'string', enum: ['archetype', 'human', 'peer'] },
              ref: { type: 'string' },
            },
          },
          blockedOn: {
            type: 'string',
            description: 'For advance: the blocking reason recorded on the task.',
          },
        },
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
  if (name === 'paradigm_captain_board') {
    return handleCaptainBoard(args, ctx);
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
    archMap: loadArchMap(ctx.rootDir),
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

  // ── Step 4b: Postflight liveness check + self-heal (v7 §3) ──
  // Did the learning chain actually run for this session? Read the liveness probe
  // (.paradigm/events/settlement-liveness.jsonl). If postflight did NOT run, Cid
  // SELF-HEALS by running it himself, then clears the stop hook normally. If the
  // self-heal throws, Cid proposes an ADVISE block (never guard) — a learning-loop
  // gap must not deadlock the human. Hard refuse stays reserved for correctness
  // gates (missing .purpose), which the stop hook still enforces separately.
  const postflight: {
    ranThisSession: boolean;
    selfHealed: boolean;
    selfHealError?: string;
    blockProposed: boolean;
  } = { ranThisSession: false, selfHealed: false, blockProposed: false };

  postflight.ranThisSession = sessionPostflightRan(paradigmDir);

  if (!postflight.ranThisSession) {
    try {
      const { runPostflightLearning } = await import('./ambient.js');
      await runPostflightLearning(ctx.rootDir, { claimant: 'navigation' });
      postflight.selfHealed = true;
      log.flow('$captain-board').info('Cid self-healed postflight (no prior liveness record)', {
        orchestrationId,
      });
    } catch (err) {
      postflight.selfHealError = err instanceof Error ? err.message : String(err);
      log.flow('$captain-board').warn('Cid postflight self-heal threw — proposing advise block', {
        orchestrationId, error: postflight.selfHealError,
      });
      try {
        const { handleProposeBlockTool } = await import('./propose-block.js');
        await handleProposeBlockTool(
          'paradigm_propose_block',
          {
            claimant: 'navigation',
            severity: 'advise', // NEVER guard — learning-loop gap must not deadlock the human.
            reason: `Postflight learning did not run and Cid's self-heal failed: ${postflight.selfHealError}`,
            unblock_hint: 'Run `paradigm_ambient_learn_postflight` manually, or inspect .paradigm/events/settlement-liveness.jsonl for the severed stage.',
          },
          ctx,
        );
        postflight.blockProposed = true;
      } catch {
        // Even the advise-block proposal is best-effort.
      }
    }
  }

  // ── Step 5: Write .cid-briefed marker ───────────────
  // Always clears the stop hook (learning-loop liveness is advise-only, not a
  // hard gate). The unconditional write is preserved by design — Part C adds the
  // self-heal BEFORE the clear, it does NOT turn the clear into a hard refuse.
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

  // Real agent verdicts parsed from the session log (BEFORE the synthetic
  // fallback below). Only these count toward the enforcement marker — a
  // fabricated 'session' fallback contribution is not a real cross-check.
  const realVerdicts = sessionInsights.agentContributions.length;

  // Fallback: if no contributions were parsed, create one from the session summary
  if (sessionInsights.agentContributions.length === 0) {
    sessionInsights.agentContributions.push({
      agentId: 'session',
      contribution: sessionSummary.slice(0, 200),
      symbolsTouched: newSymbols.slice(0, 10),
      patternsObserved: [],
    });
  }

  // Enforcement marker (T-005): a debrief that recorded REAL agent verdicts
  // (parsed contributions > 0) is a completion signal for orchestration that
  // produced verdicts without a full task-DAG settlement. Satisfy the Stop-hook
  // gate here. A debrief with no real contributions (only the synthetic
  // fallback) writes nothing — no real cross-check occurred.
  if (realVerdicts > 0) {
    recordOrchestrationCompletion(ctx.rootDir, { verdicts: realVerdicts, source: 'debrief' });
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
    postflight,
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
// Postflight liveness check (v7 §3 — Cid session-close self-heal)
// ────────────────────────────────────────────────────────

const LIVENESS_REL = path.join('events', 'settlement-liveness.jsonl');
/** Window for "this session ran postflight" — recent settlements only. */
const POSTFLIGHT_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Did the learning chain's postflight stage actually run for this session?
 * Reads `.paradigm/events/settlement-liveness.jsonl` (written by §2 settlement)
 * and returns true iff a recent record shows `runPostflightLearning === 'ok'`.
 *
 * A severed chain (postflight commented out / threw) writes a record with the
 * stage as `threw`/`skipped` → `chainLive:false` → this returns false → Cid
 * self-heals. No file at all (no settlement happened) also returns false.
 */
function sessionPostflightRan(paradigmDir: string): boolean {
  const filePath = path.join(paradigmDir, LIVENESS_REL);
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const cutoff = Date.now() - POSTFLIGHT_WINDOW_MS;
    // Scan recent records (last 50) for a live postflight stage.
    for (const line of lines.slice(-50)) {
      try {
        const rec = JSON.parse(line) as {
          ts?: string;
          stages?: { runPostflightLearning?: string };
        };
        const ts = rec.ts ? new Date(rec.ts).getTime() : NaN;
        if (Number.isNaN(ts) || ts < cutoff) continue;
        if (rec.stages?.runPostflightLearning === 'ok') return true;
      } catch {
        // Malformed line — skip.
      }
    }
  } catch {
    // Read failure → treat as "did not run" so Cid self-heals rather than
    // silently skipping the loop.
    return false;
  }
  return false;
}

// ────────────────────────────────────────────────────────
// Captain Board Handler (#captain-board — v7 §3)
// ────────────────────────────────────────────────────────

/**
 * Cid's owned read+write artifact over the live orchestration task-DAG.
 *
 * RECONCILIATION with the shipped emission/settlement model: the **epic task**
 * (`external_ref.kind==='orchestration'`) IS the run-record — it replaced the
 * frozen `logOrchestration` blob. Settlement (Loid) stamps `settledAt` on the
 * epic when its children finish. So "un-freeze the run-record" = read/advance the
 * epic task, not the old log file. `read` derives `runStatus` from the epic's
 * `settledAt` + child statuses; it never writes `settledAt` (Loid's field).
 *
 * Ownership boundary (enforced here): Cid WRITES `claimant` (claim) and a
 * `blocked_on` reason (advance). Cid NEVER writes `settledAt`, `status`
 * transitions orchestration owns, or `blurb`/`priority`/`tags`.
 */
async function handleCaptainBoard(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const action = (args.action as 'read' | 'claim' | 'advance' | undefined) || 'read';

  if (action === 'claim') {
    return handleBoardClaim(args, ctx);
  }
  if (action === 'advance') {
    return handleBoardAdvance(args, ctx);
  }

  // ── read (readOnly) ──
  const board = await assembleCaptainBoard(ctx.rootDir, {}, ctx);
  const text = JSON.stringify(board, null, 2);
  trackToolCall(text.length, 'paradigm_captain_board');
  return { handled: true, text };
}

/**
 * Derive a run's live status from the epic + its children. `settledAt` (Loid's
 * retrospective stamp) is the authoritative "settled" signal; otherwise we read
 * the children's live statuses.
 */
function deriveRunStatus(epic: Task, children: Task[]): RunStatus {
  if (epic.settledAt) {
    // A crash-settle is distinguishable via the epic/child crash markers.
    if (epic.crashed_at || children.some(c => c.crashed_at)) return 'crashed';
    return 'settled';
  }
  if (children.length === 0) return 'pending';
  const anyInFlight = children.some(c => c.status === 'in-progress')
    || epic.status === 'in-progress';
  return anyInFlight ? 'in-progress' : 'pending';
}

/** Order children by stage, then by dependsOn depth (roots first), then id. */
function orderNodes(children: Task[]): Task[] {
  return [...children].sort((a, b) => {
    const sa = a.stage ?? 0;
    const sb = b.stage ?? 0;
    if (sa !== sb) return sa - sb;
    const da = (a.dependsOn?.length ?? 0);
    const db = (b.dependsOn?.length ?? 0);
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Cheap inline fragile-symbol detection: ripple each symbol referenced by the
 * task (tags + blurb) and collect the high-impact ones. Merged onto the node
 * (adversarial cut: NOT a separate coverageGaps/inFlightSymbols block). Bounded
 * to keep the board cheap.
 */
async function fragileSymbolsFor(task: Task, ctx: ProjectContext): Promise<string[]> {
  const symbols = symbolsFromTask(task).slice(0, 3);
  const fragile: string[] = [];
  for (const sym of symbols) {
    try {
      const rippleResponse = await handleRippleTool(
        'paradigm_ripple',
        { symbol: sym, depth: 1, response_format: 'concise' },
        ctx,
      );
      if (rippleResponse.handled) {
        const rd = JSON.parse(rippleResponse.text);
        if (rd.impact === 'high' && !fragile.includes(sym)) fragile.push(sym);
      }
    } catch {
      // Ripple is non-fatal per symbol.
    }
  }
  return fragile;
}

const SYMBOL_RE = /[#$^!~][a-z][a-z0-9-]*/gi;

/** Symbols referenced by a task — from explicit tags and from the blurb prose. */
function symbolsFromTask(task: Task): string[] {
  const out = new Set<string>();
  for (const t of task.tags || []) {
    if (/^[#$^!~]/.test(t)) out.add(t);
  }
  const fromBlurb = task.blurb?.match(SYMBOL_RE) || [];
  for (const s of fromBlurb) out.add(s);
  return Array.from(out);
}

/**
 * Ripple-rank an unclaimed task: sum the downstream blast-radius of its symbols.
 * Reuses the same ripple machinery the brief uses (captain.ts ripple loop). A
 * task with no symbols ranks at 0 (priority breaks ties in the sort).
 */
async function rippleScoreFor(task: Task, ctx: ProjectContext): Promise<{ score: number; fragile: string[] }> {
  const symbols = symbolsFromTask(task).slice(0, 3);
  let score = 0;
  const fragile: string[] = [];
  for (const sym of symbols) {
    try {
      const rippleResponse = await handleRippleTool(
        'paradigm_ripple',
        { symbol: sym, depth: 2, response_format: 'concise' },
        ctx,
      );
      if (rippleResponse.handled) {
        const rd = JSON.parse(rippleResponse.text);
        const direct = rd.analysis?.directlyAffected?.length ?? 0;
        const indirect = rd.analysis?.indirectlyAffected?.length ?? 0;
        score += direct * 2 + indirect;
        if (rd.impact === 'high' && !fragile.includes(sym)) fragile.push(sym);
      }
    } catch {
      // Ripple is non-fatal per symbol.
    }
  }
  return { score, fragile };
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Assemble the live run-DAG board. Pure read — assembles runs from non-terminal
 * epics + their children, plus ripple-ranked unclaimed open tasks and a summary.
 *
 * @param proposeClaimants when true (session-open), attach a `proposedClaimant`
 *   to each unclaimed task by matching its tags/symbols → archetype. (The actual
 *   write-back happens in session-open, not here — `read` stays read-only.)
 */
export async function assembleCaptainBoard(
  rootDir: string,
  opts: { proposeClaimants?: boolean } = {},
  ctxOverride?: ProjectContext,
): Promise<CaptainBoard> {
  const ctx = ctxOverride;
  const { loadTasks } = await import('../utils/task-loader.js');

  let all: Task[] = [];
  try {
    all = await loadTasks(rootDir, { status: 'all', limit: 9999 });
  } catch (err) {
    log.flow('$captain-board').warn('Board task load failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Runs: non-terminal epics (orchestration external_ref, no parentTaskId) ──
  const epics = all.filter(t =>
    t.external_ref?.kind === 'orchestration' &&
    !t.parentTaskId &&
    !t.settledAt, // non-terminal runs only
  );

  const runs: BoardRun[] = [];
  for (const epic of epics) {
    const children = orderNodes(all.filter(t => t.parentTaskId === epic.id));
    const nodes: BoardNode[] = [];
    for (const child of children) {
      const fragile = ctx ? await fragileSymbolsFor(child, ctx) : [];
      nodes.push({
        taskId: child.id,
        blurb: child.blurb,
        stage: child.stage,
        status: child.status,
        claimant: child.claimant,
        dependsOn: child.dependsOn || [],
        fragileSymbols: fragile,
      });
    }
    runs.push({
      epicTaskId: epic.id,
      blurb: epic.blurb,
      runStatus: deriveRunStatus(epic, children),
      settledAt: epic.settledAt,
      nodes,
    });
  }

  // ── Unclaimed: open tasks with no claimant, ripple-ranked ──
  const unclaimedTasks = all.filter(t => t.status === 'open' && !t.claimant);

  const unclaimed: BoardUnclaimed[] = [];
  for (const task of unclaimedTasks) {
    const { score, fragile } = ctx
      ? await rippleScoreFor(task, ctx)
      : { score: 0, fragile: [] };
    let proposedClaimant: Claimant | undefined;
    if (opts.proposeClaimants) {
      proposedClaimant = await proposeClaimantFor(task, rootDir);
    }
    unclaimed.push({
      taskId: task.id,
      blurb: task.blurb,
      priority: task.priority,
      tags: task.tags || [],
      rippleScore: score,
      fragileSymbols: fragile,
      proposedClaimant,
    });
  }

  // Rank: ripple desc, then priority asc, then recency (id) desc.
  unclaimed.sort((a, b) => {
    if (b.rippleScore !== a.rippleScore) return b.rippleScore - a.rippleScore;
    const pr = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
    if (pr !== 0) return pr;
    return b.taskId.localeCompare(a.taskId);
  });

  const inFlight = all.filter(t => t.status === 'in-progress').length;
  const open = all.filter(t => t.status === 'open').length;

  return {
    runs,
    unclaimed,
    summary: {
      runs: runs.length,
      open,
      inFlight,
      unclaimed: unclaimed.length,
    },
  };
}

/**
 * Propose an archetype claimant for an unclaimed task by reusing the
 * orchestrator's own agent-matcher (`suggestAgentsForTask`) against the task's
 * blurb + tags. Returns the top-confidence archetype, or undefined if no match.
 */
export async function proposeClaimantFor(task: Task, rootDir: string): Promise<Claimant | undefined> {
  try {
    const { suggestAgentsForTask, loadAgentsManifest } = await import('./orchestration.js');
    const manifest = loadAgentsManifest(rootDir);
    if (!manifest?.agents) return undefined;
    // Match against blurb + symbol-bearing tags (gives the matcher both keyword
    // and symbol signal).
    const matchText = [task.blurb, ...(task.tags || [])].join(' ');
    const suggestions = suggestAgentsForTask(matchText, manifest.agents);
    if (suggestions.length === 0) return undefined;
    return { kind: 'archetype', ref: suggestions[0].name };
  } catch {
    return undefined;
  }
}

/**
 * `claim` — write a task's claimant (status stays 'open'). A human/peer claim
 * overrides any prior archetype proposal; an archetype (Cid) claim does NOT
 * override a human/peer claim (Cid can't re-grab a human-claimed task).
 */
async function handleBoardClaim(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const taskId = args.taskId as string | undefined;
  const claimantArg = args.claimant as Claimant | undefined;
  if (!taskId || !claimantArg?.kind || !claimantArg?.ref) {
    return {
      handled: true,
      text: JSON.stringify({ ok: false, error: 'claim requires taskId and claimant {kind, ref}' }),
    };
  }

  const { loadTask, updateTask } = await import('../utils/task-loader.js');
  const task = await loadTask(ctx.rootDir, taskId);
  if (!task) {
    return { handled: true, text: JSON.stringify({ ok: false, error: `task not found: ${taskId}` }) };
  }

  // Override guard: an archetype proposal may not displace a human/peer claim.
  const existing = task.claimant;
  if (existing && existing.kind !== 'archetype' && claimantArg.kind === 'archetype') {
    log.flow('$captain-board').info('Claim rejected: archetype cannot override human/peer claim', {
      taskId, existing: existing.kind, proposed: claimantArg.kind,
    });
    return {
      handled: true,
      text: JSON.stringify({
        ok: false,
        error: `task ${taskId} is claimed by ${existing.kind}:${existing.ref}; archetype proposal cannot override`,
        claimant: existing,
      }),
    };
  }

  // status stays 'open' — claimant present + open = "proposed/assigned, not started".
  const ok = await updateTask(ctx.rootDir, taskId, { claimant: claimantArg });
  log.flow('$captain-board').info('Captain claim written', { taskId, claimant: claimantArg, ok });
  return {
    handled: true,
    text: JSON.stringify({ ok, taskId, claimant: claimantArg, status: 'open' }),
  };
}

/**
 * `advance` — v7.0 has NO `blocked` status (4 states only), so this records a
 * `blocked_on` reason on the task and leaves `status` untouched. Orchestration —
 * not Cid — owns the in-progress/done transitions. (If `blocked` lands as a real
 * status in fast-follow, advance gains the `→blocked` transition; for v7.0 it is
 * a reason-stamp only.)
 */
async function handleBoardAdvance(
  args: Record<string, unknown>,
  ctx: ProjectContext,
): Promise<{ handled: boolean; text: string }> {
  const taskId = args.taskId as string | undefined;
  const blockedOn = args.blockedOn as string | undefined;
  if (!taskId || !blockedOn) {
    return {
      handled: true,
      text: JSON.stringify({
        ok: false,
        error: "advance requires taskId and blockedOn (v7.0 has no 'blocked' status — advance records a reason only)",
      }),
    };
  }

  const { loadTask, updateTask } = await import('../utils/task-loader.js');
  const task = await loadTask(ctx.rootDir, taskId);
  if (!task) {
    return { handled: true, text: JSON.stringify({ ok: false, error: `task not found: ${taskId}` }) };
  }

  // blocked_on is a Cid-owned reason field; status is left as-is.
  const ok = await updateTask(ctx.rootDir, taskId, { blocked_on: blockedOn });
  log.flow('$captain-board').info('Captain advance: blocked_on recorded (status unchanged)', {
    taskId, blockedOn, status: task.status, ok,
  });
  return {
    handled: true,
    text: JSON.stringify({ ok, taskId, blocked_on: blockedOn, status: task.status }),
  };
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
