import type { Section } from '../types';

interface SectionNavProps {
  sections: Section[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * Horizontal tab strip for University Sections (v6.5).
 *
 * Atelier-collapse rule: when a pack has no sections declared, the loader
 * synthesizes a single implicit-default section. In that case this component
 * renders nothing so the UI looks pixel-identical to v6.4 for legacy packs.
 *
 * Security (per Aegis stage-0): section `name` and `description` are rendered
 * as plain React text children only. No markdown, no dangerouslySetInnerHTML.
 */
export function SectionNav({ sections, activeId, onSelect }: SectionNavProps) {
  // Atelier-collapse: hide entirely for the implicit-default single section.
  if (sections.length <= 1 && sections[0]?.default === true) {
    return null;
  }

  // Defensive sort: server should already sort, but don't rely on it.
  const sorted = [...sections].sort((a, b) => a.order - b.order);

  return (
    <nav className="section-nav" aria-label="Course sections">
      {sorted.map((section) => {
        const isActive = section.id === activeId;
        return (
          <button
            key={section.id}
            type="button"
            className={`section-nav-tab${isActive ? ' active' : ''}`}
            onClick={() => onSelect(section.id)}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="section-nav-name">{section.name}</span>
            {section.description ? (
              <span className="section-nav-description">{section.description}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
