import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';
import { usePackConfigStore } from '../store/packConfigStore';

const THEME_KEY = 'paradigm-university-theme';

const TAB_CONFIG = {
  campus:       { label: 'Campus',       path: '/' },
  courses:      { label: 'Courses',      path: '/courses' },
  plsat:        { label: 'PLSAT',        path: '/plsat' },
  library:      { label: 'Library',      path: '/reference' },
  certificates: { label: 'Certificates', path: '/certificate' },
} as const;

type TabId = keyof typeof TAB_CONFIG;

function isTabActive(tabId: TabId, pathname: string): boolean {
  if (tabId === 'campus') return pathname === '/';
  if (tabId === 'courses') return pathname.startsWith('/course') || pathname === '/courses';
  if (tabId === 'plsat') return pathname.startsWith('/plsat');
  if (tabId === 'library') return pathname.startsWith('/reference');
  if (tabId === 'certificates') return pathname.startsWith('/certificate');
  return false;
}

interface HeaderProps {
  version: string;
}

export function Header({ version }: HeaderProps) {
  const location = useLocation();
  const config = usePackConfigStore((s) => s.config);
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // localStorage unavailable
    }
  }, [dark]);

  const name = config?.branding.name ?? 'Paradigm University';
  const tagline = config?.branding.tagline ?? 'Lux in Codice';
  const displayVersion = config?.version ?? version;
  const tabs = config?.branding.tabs ?? (['campus', 'courses', 'plsat', 'library', 'certificates'] as TabId[]);

  return (
    <header className="header">
      <div className="header-left">
        <Link to="/" className="header-brand">
          <BrandLogo size={36} />
          <h1>{name}</h1>
          <span className="subtitle">{tagline}</span>
        </Link>
      </div>

      <nav className="header-nav">
        {tabs.map((tabId) => {
          const tab = TAB_CONFIG[tabId as TabId];
          if (!tab) return null;
          return (
            <Link
              key={tabId}
              to={tab.path}
              className={isTabActive(tabId as TabId, location.pathname) ? 'active' : ''}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="header-right">
        <span className="version-badge">v{displayVersion}</span>
        <button
          className="theme-toggle"
          onClick={() => setDark(d => !d)}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? '☀' : '☾'}
        </button>
      </div>
    </header>
  );
}
