/**
 * List View - Displays nodes in a sortable table format
 */

import type { SymbolEntry, SymbolType } from '../../types';
import { useNodesStore, type SortOption } from '../../store/nodesStore';

const TYPE_INFO: Record<SymbolType, { prefix: string; label: string; color: string }> = {
  feature: { prefix: '@', label: 'Feature', color: 'var(--color-feature)' },
  component: { prefix: '#', label: 'Component', color: 'var(--color-component)' },
  flow: { prefix: '$', label: 'Flow', color: 'var(--color-flow)' },
  portal: { prefix: '^', label: 'Gate', color: 'var(--color-portal)' },
  signal: { prefix: '!', label: 'Signal', color: 'var(--color-signal)' },
  state: { prefix: '%', label: 'State', color: 'var(--color-state)' },
  aspect: { prefix: '~', label: 'Aspect', color: 'var(--color-aspect)' },
  idea: { prefix: '?', label: 'Idea', color: 'var(--color-idea)' },
};

interface ListRowProps {
  node: SymbolEntry;
  isSelected: boolean;
  onClick: () => void;
}

function ListRow({ node, isSelected, onClick }: ListRowProps) {
  const info = TYPE_INFO[node.type];
  const name = node.symbol.slice(node.type === 'idea' && node.ideaType ? 2 : 1);

  // Format modified date
  const modifiedDate = node.modified
    ? new Date(node.modified).toLocaleDateString()
    : '-';

  return (
    <tr
      className={`list-row ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <td className="list-cell list-cell--symbol">
        <span className="list-symbol" style={{ color: info.color }}>
          {info.prefix}
        </span>
        <span className="list-name">{name}</span>
      </td>
      <td className="list-cell list-cell--type">
        <span className="list-type-badge" style={{ backgroundColor: info.color }}>
          {info.label}
        </span>
      </td>
      <td className="list-cell list-cell--description">
        {node.description || <span className="list-empty">-</span>}
      </td>
      <td className="list-cell list-cell--tags">
        {node.tags && node.tags.length > 0 ? (
          <div className="list-tags">
            {node.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="list-tag">{tag}</span>
            ))}
            {node.tags.length > 3 && <span className="list-tag-more">+{node.tags.length - 3}</span>}
          </div>
        ) : (
          <span className="list-empty">-</span>
        )}
      </td>
      <td className="list-cell list-cell--modified">{modifiedDate}</td>
    </tr>
  );
}

interface SortHeaderProps {
  label: string;
  sortKey: SortOption;
  currentSort: SortOption;
  onSort: (key: SortOption) => void;
}

function SortHeader({ label, sortKey, currentSort, onSort }: SortHeaderProps) {
  const isActive = currentSort === sortKey;

  return (
    <th
      className={`list-header ${isActive ? 'list-header--active' : ''}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {isActive && <span className="list-sort-indicator">↓</span>}
    </th>
  );
}

export function ListView() {
  const { getSortedNodes, selectedId, selectNode, sortOption, setSortOption } = useNodesStore();
  const nodes = getSortedNodes();

  if (nodes.length === 0) {
    return (
      <div className="list-view list-view--empty">
        <p>No symbols match the current filters</p>
      </div>
    );
  }

  return (
    <div className="list-view">
      <table className="list-table">
        <thead>
          <tr>
            <SortHeader label="Symbol" sortKey="alpha" currentSort={sortOption} onSort={setSortOption} />
            <SortHeader label="Type" sortKey="type" currentSort={sortOption} onSort={setSortOption} />
            <th className="list-header">Description</th>
            <th className="list-header">Tags</th>
            <SortHeader label="Modified" sortKey="updated" currentSort={sortOption} onSort={setSortOption} />
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <ListRow
              key={node.id}
              node={node}
              isSelected={selectedId === node.id}
              onClick={() => selectNode(node.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
