import { useCallback } from 'react';
import { useGraphStore } from '../store/graphStore';

export default function Toolbar() {
  const graphName = useGraphStore((s) => s.graphName);
  const setGraphName = useGraphStore((s) => s.setGraphName);
  const nodes = useGraphStore((s) => s.nodes);
  const groupSelected = useGraphStore((s) => s.groupSelected);
  const ungroupSelected = useGraphStore((s) => s.ungroupSelected);
  const removeNodeFromGroup = useGraphStore((s) => s.removeNodeFromGroup);
  const setExportOpen = useGraphStore((s) => s.setExportOpen);
  const setLoadDialogOpen = useGraphStore((s) => s.setLoadDialogOpen);
  const exportToFile = useGraphStore((s) => s.exportToFile);
  const newGraph = useGraphStore((s) => s.newGraph);

  const handleGroup = useCallback(() => {
    const label = prompt('Group label:');
    if (label) groupSelected(label);
  }, [groupSelected]);

  const handleRemoveFromGroup = useCallback(() => {
    const selected = nodes.filter((n) => n.selected && n.parentId);
    for (const node of selected) {
      removeNodeFromGroup(node.id);
    }
  }, [nodes, removeNodeFromGroup]);

  const handleNew = useCallback(() => {
    if (confirm('Start a new graph? Current graph will be cleared.')) {
      newGraph();
    }
  }, [newGraph]);

  const hasSelectedChildren = nodes.some((n) => n.selected && n.parentId);

  return (
    <div className="toolbar">
      <input
        className="toolbar__name"
        value={graphName}
        onChange={(e) => setGraphName(e.target.value)}
        title="Graph name"
      />
      <div className="toolbar__actions">
        <button className="toolbar__btn" onClick={handleGroup} title="Group selected (Ctrl+G)">
          Group
        </button>
        <button className="toolbar__btn" onClick={ungroupSelected} title="Ungroup selected">
          Ungroup
        </button>
        {hasSelectedChildren && (
          <button className="toolbar__btn" onClick={handleRemoveFromGroup} title="Remove selected from group">
            Remove from Group
          </button>
        )}
        <div className="toolbar__divider" />
        <button className="toolbar__btn toolbar__btn--primary" onClick={() => setExportOpen(true)} title="Export markdown (Ctrl+E)">
          Export
        </button>
        <button className="toolbar__btn" onClick={exportToFile} title="Save as .graph.json">
          Save
        </button>
        <button className="toolbar__btn" onClick={() => setLoadDialogOpen(true)} title="Load .graph.json or paste JSON">
          Load
        </button>
        <button className="toolbar__btn" onClick={handleNew} title="New empty graph">
          New
        </button>
      </div>
    </div>
  );
}
