import { NavLink, Link } from 'react-router-dom';
import { useMe } from '../me.ts';
import { IconCalendar, IconHome, IconMap, IconTrophy, IconUsers } from './icons.tsx';

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Earthnow home">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="15" cy="15" r="10.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path d="M4.5 15h21M15 4.5c-3.6 3-5 6.6-5 10.5s1.4 7.5 5 10.5c3.6-3 5-6.6 5-10.5S18.6 7.5 15 4.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="24" cy="24" r="4.6" fill="var(--accent)" />
      </svg>
      <span>earthnow</span>
    </Link>
  );
}

export function Header() {
  const me = useMe();
  return (
    <header className="topbar">
      <Brand />
      <nav className="nav" aria-label="Main">
        <NavLink to="/maps">Maps</NavLink>
        <NavLink to="/daily">Daily</NavLink>
        <NavLink to="/duels">Duels</NavLink>
        <NavLink to="/party">Party</NavLink>
        <NavLink to="/create">Create</NavLink>
        <NavLink to="/leaderboards">Ranks</NavLink>
      </nav>
      <Link to="/profile" className="me-chip" aria-label={`Your profile, level ${me?.level.level ?? 1}`}>
        <span className="me-level" aria-hidden="true">
          {me?.level.level ?? 1}
        </span>
        <span className="me-name">{me?.displayName ?? 'Guest'}</span>
      </Link>
    </header>
  );
}

/** Phone navigation: the five places people go most, in thumb reach. */
export function TabBar() {
  const tabs = [
    { to: '/', label: 'Play', icon: IconHome, end: true },
    { to: '/maps', label: 'Maps', icon: IconMap },
    { to: '/daily', label: 'Daily', icon: IconCalendar },
    { to: '/duels', label: 'Versus', icon: IconUsers, also: /^\/party/ },
    { to: '/leaderboards', label: 'Ranks', icon: IconTrophy },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map(({ to, label, icon: Icon, end, also }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive || (also && also.test(location.pathname)) ? 'active' : '')}>
          <Icon size={22} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
