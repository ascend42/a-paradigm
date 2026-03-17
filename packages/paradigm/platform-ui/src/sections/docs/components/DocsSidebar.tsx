import React, { useCallback } from 'react';
import { useDocsStore } from '../store/docsStore';
import type { SidebarGroup, SidebarItem } from '../store/docsStore';

const KIND_COLORS: Record<string, string> = {
  component: 'var(--p-symbol-component)',
  flow: 'var(--p-symbol-flow)',
  gate: 'var(--p-symbol-gate)',
  signal: 'var(--p-symbol-signal)',
  aspect: 'var(--p-symbol-aspect)',
  custom: 'var(--p-accent-blue)',
  portal: 'var(--p-accent-orange)',
  guide: 'var(--p-accent-green)',
};

const KIND_PREFIXES: Record<string, string> = {
  component: '#',
  flow: '$',
  gate: '^',
  signal: '!',
  aspect: '~',
};

export function DocsSidebar() {
  const manifest = useDocsStore(s => s.manifest);
  const activePage = useDocsStore(s => s.activePage);
  const searchQuery = useDocsStore(s => s.searchQuery);
  const sidebarCollapsed = useDocsStore(s => s.sidebarCollapsed);
  const selectPage = useDocsStore(s => s.selectPage);
  const search = useDocsStore(s => s.search);
  const clearSearch = useDocsStore(s => s.clearSearch);
  const toggleGroup = useDocsStore(s => s.toggleGroup);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    if (q) search(q);
    else clearSearch();
  }, [search, clearSearch]);

  const handleItemClick = useCallback((item: SidebarItem) => {
    clearSearch();
    const kindMap: Record<string, 'symbol' | 'flow' | 'portal' | 'custom'> = {
      component: 'symbol',
      signal: 'symbol',
      aspect: 'symbol',
      gate: 'symbol',
      flow: 'flow',
      portal: 'portal',
      custom: 'custom',
      guide: 'custom',
    };
    selectPage(kindMap[item.kind] || 'symbol', item.id);
  }, [selectPage, clearSearch]);

  if (!manifest) return <div className="docs-sidebar docs-sidebar--loading">Loading...</div>;

  return (
    <div className="docs-sidebar">
      <div className="docs-sidebar__search">
        <input
          type="text"
          placeholder="Search docs..."
          value={searchQuery}
          onChange={handleSearch}
          className="docs-sidebar__search-input"
        />
      </div>
      <div className="docs-sidebar__groups">
        {manifest.groups.map(group => (
          <SidebarGroupComponent
            key={group.id}
            group={group}
            collapsed={sidebarCollapsed[group.id] ?? group.collapsed}
            activePage={activePage}
            sidebarCollapsed={sidebarCollapsed}
            onToggle={toggleGroup}
            onItemClick={handleItemClick}
          />
        ))}
      </div>
    </div>
  );
}

function SidebarGroupComponent({
  group,
  collapsed,
  activePage,
  sidebarCollapsed,
  onToggle,
  onItemClick,
}: {
  group: SidebarGroup;
  collapsed: boolean;
  activePage: { kind: string; id: string } | null;
  sidebarCollapsed: Record<string, boolean>;
  onToggle: (id: string) => void;
  onItemClick: (item: SidebarItem) => void;
}) {
  return (
    <div className="docs-sidebar__group">
      <button
        className="docs-sidebar__group-header"
        onClick={() => onToggle(group.id)}
      >
        <span className="docs-sidebar__group-arrow">{collapsed ? '▸' : '▾'}</span>
        <span className="docs-sidebar__group-label">{group.label}</span>
        <span className="docs-sidebar__group-count">{group.items.length}</span>
      </button>
      {!collapsed && (
        <>
          {group.subgroups?.map(sg => (
            <SidebarGroupComponent
              key={sg.id}
              group={sg}
              collapsed={sidebarCollapsed[`${group.id}/${sg.id}`] ?? sg.collapsed}
              activePage={activePage}
              sidebarCollapsed={sidebarCollapsed}
              onToggle={(id) => onToggle(`${group.id}/${id}`)}
              onItemClick={onItemClick}
            />
          ))}
          {group.items.map(item => (
            <button
              key={item.id}
              className={`docs-sidebar__item ${activePage?.id === item.id ? 'docs-sidebar__item--active' : ''}`}
              onClick={() => onItemClick(item)}
              title={item.description}
            >
              <span
                className="docs-sidebar__item-prefix"
                style={{ color: KIND_COLORS[item.kind] }}
              >
                {KIND_PREFIXES[item.kind] || ''}
              </span>
              <span className="docs-sidebar__item-label">{item.label}</span>
              {item.badge && <span className="docs-sidebar__item-badge">{item.badge}</span>}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
