import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { get } from '../services/api.js';

const links = {
  patient: [['Overview','/dashboard','⌂'], ['Find a doctor','/doctors','✳'], ['Appointments','/appointments','▦'], ['Medical records','/records','▤']],
  doctor: [['Overview','/dashboard','⌂'], ['My appointments','/appointments','▦'], ['Patient records','/records','▤'], ['Availability','/availability','◷']],
  admin: [['Overview','/dashboard','⌂'], ['Appointments','/appointments','▦'], ['User management','/users','♙'], ['Audit log','/audit','≋']],
};
export default function Layout() {
  const { user, logout } = useAuth(); const navigate = useNavigate();
  const [profileName, setProfileName] = useState('');
  useEffect(() => {
    if (user?.role !== 'patient') { setProfileName(''); return; }
    let active = true;
    get('/patients/me')
      .then(d => {
        if (active) {
          const p = d.patient || {};
          setProfileName([p.firstName, p.lastName].filter(Boolean).join(' '));
        }
      })
      .catch(() => { if (active) setProfileName(''); });
    return () => { active = false; };
  }, [user]);
  const nav = links[user?.role] || links.patient;
  const signOut = () => { logout(); navigate('/login'); };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">✚</div><div><strong>careflow</strong><span>HEALTH, IN HARMONY</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav">{nav.map(([label, to, icon]) => <NavLink key={to} to={to} className={({isActive}) => `nav-link ${isActive?'active':''}`}><span className="nav-icon">{icon}</span>{label}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-orb">✦</span><strong>Here for your health</strong><p>Your care journey, thoughtfully organized.</p></div><button className="nav-link logout" onClick={signOut}><span className="nav-icon">↪</span>Sign out</button></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <b> {nav.find((n)=>n[1]===location.pathname)?.[0] || 'Overview'}</b></div><div className="topbar-right"><span className="status-dot"/> <span className="secure-label">Secure workspace</span><button type="button" className="profile-trigger" onClick={() => navigate(user?.role === 'patient' ? '/profile' : '/dashboard')} aria-label="Open profile" style={{background:'transparent',border:'none',color:'inherit',display:'flex',alignItems:'center',gap:'12px',cursor:'pointer',font:'inherit',textAlign:'left'}}><div className="avatar">{(user?.email?.[0] || 'U').toUpperCase()}</div><div className="user-meta"><strong>{profileName || user?.email?.split('@')[0] || 'User'}</strong><span>{user?.role || 'patient'}</span></div></button></div></header><div className="page-wrap"><Outlet /></div><footer className="footer"><span>© 2026 Careflow Health Systems</span><span>Designed around better care <b>✦</b></span></footer></main>
  </div>;
}
