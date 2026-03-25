# Per-Project Agent Roster Spec

## Problem

All global agents (~/.paradigm/agents/) are currently available to every project by default. This means:
- 54 agents show up on a CRM project when only ~20 are relevant
- Users must manually bench irrelevant agents per project
- Benching is a global flag (`benched: true` on the .agent file) — benching for dealoracle benches everywhere
- The orchestrator considers all active agents, adding noise to planning

## Solution: Project-Level Rosters

### Storage

```yaml
# .paradigm/roster.yaml (per-project, committed to repo)
version: "1.0"
project: dealoracle
type: saas-web-app          # Used for roster suggestions

active:
  - architect
  - builder
  - reviewer
  - tester
  - security
  - documentor
  - designer                # Mika
  - copywriter              # Wren
  - performance             # Bolt
  - devops                  # Atlas
  - dba                     # Vault
  - e2e                     # Ghost
  - dx                      # Helix
  - seo                     # Beacon
  - pm                      # Yuki
  - product                 # North
  - sales                   # Mozi
  - legal                   # Clause
  - a11y                    # Aria
  - qa                      # Shield
  - advocate                # Jinx
  - debugger                # Trace
  - release                 # Ship
  - narrator                # Ink

# Not listed = not active on this project (but still available globally)
# The orchestrator ONLY considers agents in this list
```

### Behavior

1. **No roster.yaml** → backward compatible: all global agents available (current behavior)
2. **roster.yaml exists** → orchestrator ONLY considers listed agents
3. Global agent profiles are never modified — `benched: true` is removed from global files
4. Per-project activation is the roster.yaml list

### CLI Commands

```bash
# Interactive roster setup (suggests based on project type)
paradigm agents roster

# Quick activate specific agents
paradigm agents activate designer copywriter security devops dba

# Quick deactivate
paradigm agents deactivate gamedev 3d audio streaming

# List active for this project
paradigm agents list                    # Shows only active roster
paradigm agents list --all              # Shows all global + active status

# Install a pod (activates all agents in the pod)
paradigm agents activate --pod ship-pod
paradigm agents activate --pod design-pod
```

### paradigm shift Integration

During `paradigm shift`, after team init:

```
Step 2b/6: Agent roster setup...

  Detected project type: SaaS web app (React + Supabase + Vercel)

  Suggested roster (20 agents):
    Core:       architect, builder, reviewer, tester, security, documentor
    Design:     designer (Mika), copywriter (Wren), a11y (Aria)
    Data:       dba (Vault), performance (Bolt), analyst (Sage)
    Infra:      devops (Atlas), seo (Beacon), release (Ship)
    Product:    pm (Yuki), product (North)
    Quality:    e2e (Ghost), qa (Shield), advocate (Jinx)

  Accept suggested roster? [Y/n]

  ✓ Roster saved to .paradigm/roster.yaml (20 agents active)
```

### Project Type Detection

Auto-detect from project signals:

```typescript
function detectProjectType(cwd: string): ProjectType {
  const signals = {
    hasPackageJson: exists('package.json'),
    hasSupabase: exists('supabase/'),
    hasVercelJson: exists('vercel.json'),
    hasNextConfig: exists('next.config.*'),
    hasSwiftPackage: exists('Package.swift'),
    hasCargoToml: exists('Cargo.toml'),
    hasPubspecYaml: exists('pubspec.yaml'),
    hasGodotProject: exists('project.godot'),
    hasUnityProject: exists('Assets/'),
    hasPrisma: exists('prisma/'),
    hasDockerfile: exists('Dockerfile'),
  };

  if (signals.hasGodotProject || signals.hasUnityProject) return 'game';
  if (signals.hasSwiftPackage && !signals.hasPackageJson) return 'ios-app';
  if (signals.hasPubspecYaml) return 'flutter-app';
  if (signals.hasSupabase && signals.hasNextConfig) return 'saas-web-app';
  if (signals.hasNextConfig) return 'web-app';
  if (signals.hasCargoToml) return 'rust-project';
  if (signals.hasPrisma || signals.hasDockerfile) return 'backend-api';
  return 'generic';
}
```

### Suggested Rosters by Type

```typescript
const ROSTER_SUGGESTIONS: Record<ProjectType, string[]> = {
  'saas-web-app': [
    'architect', 'builder', 'reviewer', 'tester', 'security', 'documentor',
    'designer', 'copywriter', 'performance', 'devops', 'dba', 'e2e',
    'dx', 'seo', 'pm', 'product', 'sales', 'legal', 'a11y', 'qa',
    'advocate', 'debugger', 'release', 'narrator',
  ],
  'web-app': [
    'architect', 'builder', 'reviewer', 'tester', 'security', 'documentor',
    'designer', 'copywriter', 'performance', 'devops', 'e2e', 'seo',
    'a11y', 'qa', 'debugger',
  ],
  'backend-api': [
    'architect', 'builder', 'reviewer', 'tester', 'security', 'documentor',
    'devops', 'dba', 'performance', 'dx', 'qa', 'debugger', 'release',
  ],
  'ios-app': [
    'architect', 'builder', 'reviewer', 'tester', 'security', 'documentor',
    'designer', 'mobile', 'performance', 'a11y', 'qa', 'debugger',
  ],
  'game': [
    'architect', 'builder', 'reviewer', 'tester', 'documentor',
    'gamedev', '3d', 'audio', 'designer', 'performance', 'debugger',
  ],
  'flutter-app': [
    'architect', 'builder', 'reviewer', 'tester', 'security', 'documentor',
    'designer', 'mobile', 'performance', 'a11y', 'debugger',
  ],
  'generic': [
    'architect', 'builder', 'reviewer', 'tester', 'security', 'documentor',
    'debugger', 'qa',
  ],
};
```

### Orchestrator Change

```typescript
// In handleOrchestrateInline:

function getActiveAgents(rootDir: string): string[] {
  const rosterPath = path.join(rootDir, '.paradigm', 'roster.yaml');

  if (fs.existsSync(rosterPath)) {
    const roster = yaml.load(fs.readFileSync(rosterPath, 'utf8'));
    return roster.active || [];
  }

  // Fallback: all non-benched global agents (backward compat)
  return getAllGlobalAgents().filter(a => !a.benched).map(a => a.id);
}

// Then in planning:
const activeAgents = getActiveAgents(rootDir);
// Only consider agents in activeAgents when building orchestration plan
```

### Migration

1. Remove `benched: true` from global .agent files (it's per-project now)
2. Projects without roster.yaml continue working (all agents available)
3. `paradigm shift` on existing projects offers to create roster.yaml
4. First run creates the file based on project type detection + user confirmation
