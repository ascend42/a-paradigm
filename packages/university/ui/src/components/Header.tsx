import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Seal } from './Seal';

const THEME_KEY = 'paradigm-university-theme';

interface HeaderProps {
  version: string;
}

export function Header({ version }: HeaderProps) {
  const location = useLocation();
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

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <header className="header">
      <div className="header-left">
        <Link to="/" className="header-brand">
          <Seal size={36} />
          <h1>Paradigm University</h1>
          <span className="subtitle">Lux in Codice</span>
        </Link>
      </div>

      <nav className="header-nav">
        <Link to="/" className={isActive('/') ? 'active' : ''}>
          Campus
        </Link>
        <Link to="/courses" className={isActive('/course') || location.pathname === '/courses' ? 'active' : ''}>
          Courses
        </Link>
        <Link to="/plsat" className={isActive('/plsat') ? 'active' : ''}>
          PLSAT
        </Link>
        <Link to="/reference" className={isActive('/reference') ? 'active' : ''}>
          Library
        </Link>
        <Link to="/certificate" className={isActive('/certificate') ? 'active' : ''}>
          Certificates
        </Link>
      </nav>

      <div className="header-right">
        <span className="version-badge">v{version}</span>
        <button
          className="theme-toggle"
          onClick={() => setDark(d => !d)}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? '\u2600' : '\u263E'}
        </button>
      </div>
    </header>
  );
}
