import { useMemo, useState } from 'react';
import { useViewerStore } from '../../store/viewerStore';

interface Command {
  label: string;
  cmd: string;
  description?: string;
}

export function CommandPalette() {
  const { selectedPortalId, selectedFlowId, portals, flows } = useViewerStore();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const commands = useMemo(() => {
    const cmds: Command[] = [];

    // Context-specific commands first
    if (selectedPortalId) {
      const portal = portals.find(p => p.id === selectedPortalId);
      if (portal) {
        cmds.push({
          label: `Ripple analysis for ${portal.id}`,
          cmd: `paradigm ripple ^${portal.id} --json`,
          description: 'See what depends on this portal',
        });
        cmds.push({
          label: `Query ${portal.id} in constellation`,
          cmd: `jq '.stars["^${portal.id}"]' .paradigm/constellation.json`,
          description: 'Get detailed symbol data',
        });
      }
    }

    if (selectedFlowId) {
      const flow = flows.find(f => f.id === selectedFlowId);
      if (flow) {
        cmds.push({
          label: `Query ${flow.id} sequence`,
          cmd: `jq '.orbits["$${flow.id}"].sequence' .paradigm/constellation.json`,
          description: 'Get flow steps',
        });
        cmds.push({
          label: `Ripple analysis for ${flow.id}`,
          cmd: `paradigm ripple $${flow.id} --json`,
          description: 'See flow dependencies',
        });
      }
    }

    // Separator if we have context-specific commands
    if (cmds.length > 0) {
      cmds.push({ label: '---', cmd: '', description: 'General Commands' });
    }

    // General commands
    cmds.push({
      label: 'Get full constellation',
      cmd: 'paradigm constellation --format json',
      description: 'Regenerate symbol graph',
    });
    cmds.push({
      label: 'Show beacon (quick overview)',
      cmd: 'paradigm beacon --json',
      description: 'Get project orientation',
    });
    cmds.push({
      label: 'Show thread (session context)',
      cmd: 'paradigm thread --json',
      description: 'See previous session activity',
    });
    cmds.push({
      label: 'List all portals',
      cmd: `jq '[.stars | to_entries[] | select(.value.type == "gate") | .key]' .paradigm/constellation.json`,
      description: 'Query portal symbols',
    });
    cmds.push({
      label: 'List all features',
      cmd: `jq '[.stars | to_entries[] | select(.value.type == "feature") | .key]' .paradigm/constellation.json`,
      description: 'Query feature symbols',
    });

    return cmds;
  }, [selectedPortalId, selectedFlowId, portals, flows]);

  const copyToClipboard = async (cmd: string, index: number) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = cmd;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  return (
    <div className="command-palette">
      <h3>📋 CLI Commands</h3>
      <p className="palette-hint">Click to copy command for AI agent use</p>
      
      <div className="command-list">
        {commands.map((cmd, index) => {
          // Separator
          if (cmd.label === '---') {
            return (
              <div key={index} className="command-separator">
                <span>{cmd.description}</span>
              </div>
            );
          }

          return (
            <div
              key={index}
              className={`command-item ${copiedIndex === index ? 'copied' : ''}`}
              onClick={() => copyToClipboard(cmd.cmd, index)}
              title={cmd.description}
            >
              <div className="command-label">{cmd.label}</div>
              <code className="command-code">{cmd.cmd}</code>
              <span className="copy-indicator">
                {copiedIndex === index ? '✓ Copied' : 'Copy'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="palette-footer">
        <p>
          💡 <strong>Tip:</strong> AI agents should run these commands instead of reading large context files.
        </p>
      </div>
    </div>
  );
}
