import { NavLink, Link } from 'react-router-dom';
import { useMe } from '../me.ts';

export function Header() {
  const me = useMe();
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Earthnow home">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="15" cy="15" r="10.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path d="M4.5 15h21M15 4.5c-3.6 3-5 6.6-5 10.5s1.4 7.5 5 10.5c3.6-3 5-6.6 5-10.5S18.6 7.5 15 4.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="24" cy="24" r="4.6" fill="var(--accent)" />
        </svg>
        <span>earthnow</span>
      </Link>
      <nav className="nav" aria-label="Main">
        <NavLink to="/maps">Maps</NavLink>
        <NavLink to="/daily">Daily</NavLink>
        <NavLink to="/duels">Duels</NavLink>
        <NavLink to="/party">Party</NavLink>
        <NavLink to="/create">Create</NavLink>
        <NavLink to="/leaderboards">Ranks</NavLink>
      </nav>
      <Link to="/profile" className="me-chip" aria-label="Your profile">
        <span className="me-level" title="Level">{me?.level.level ?? 1}</span>
        <span className="me-name">{me?.displayName ?? 'Guest'}</span>
      </Link>
    </header>
  );
}
