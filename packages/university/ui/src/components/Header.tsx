import { Link, useLocation } from 'react-router-dom';
import { Seal } from './Seal';

interface HeaderProps {
  version: string;
}

export function Header({ version }: HeaderProps) {
  const location = useLocation();

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
        <Link to="/course/para-101" className={isActive('/course') ? 'active' : ''}>
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
      </div>
    </header>
  );
}
