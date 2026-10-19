import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { post } from '../services/api.js';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hms_user') || 'null'); } catch { return null; }
  });
  useEffect(() => {
    const logoutOnExpiry = () => { localStorage.removeItem('hms_token'); localStorage.removeItem('hms_user'); setUser(null); };
    window.addEventListener('hms:unauthorized', logoutOnExpiry);
    return () => window.removeEventListener('hms:unauthorized', logoutOnExpiry);
  }, []);
  const login = async (credentials) => {
    const result = await post('/auth/login', credentials);
    localStorage.setItem('hms_token', result.token);
    localStorage.setItem('hms_user', JSON.stringify(result.user));
    setUser(result.user);
    return result.user;
  };
  const register = async (details) => post('/auth/register', details);
  const logout = () => { localStorage.removeItem('hms_token'); localStorage.removeItem('hms_user'); setUser(null); };
  const value = useMemo(() => ({ user, login, register, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
