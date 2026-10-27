import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { post } from '../services/api.js';

const AuthContext = createContext(null);

const USER_ROLES = new Set(['patient', 'doctor', 'admin']);

function clearStoredSession() {
  localStorage.removeItem('hms_token');
  localStorage.removeItem('hms_user');
}

function readStoredUser() {
  const token = localStorage.getItem('hms_token');
  const storedUser = localStorage.getItem('hms_user');

  if (!token || !storedUser) {
    clearStoredSession();
    return null;
  }

  try {
    const user = JSON.parse(storedUser);
    if (
      !user
      || typeof user !== 'object'
      || typeof user.id !== 'string'
      || typeof user.email !== 'string'
      || !USER_ROLES.has(user.role)
    ) {
      clearStoredSession();
      return null;
    }
    return user;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);

  useEffect(() => {
    const logoutOnExpiry = () => {
      clearStoredSession();
      setUser(null);
    };
    const syncStoredSession = (event) => {
      if (event.key === null || event.key === 'hms_token' || event.key === 'hms_user') {
        setUser(readStoredUser());
      }
    };

    window.addEventListener('hms:unauthorized', logoutOnExpiry);
    window.addEventListener('storage', syncStoredSession);
    return () => {
      window.removeEventListener('hms:unauthorized', logoutOnExpiry);
      window.removeEventListener('storage', syncStoredSession);
    };
  }, []);

  const login = async (credentials) => {
    const result = await post('/auth/login', credentials);
    localStorage.setItem('hms_token', result.token);
    localStorage.setItem('hms_user', JSON.stringify(result.user));
    setUser(result.user);
    return result.user;
  };

  const register = async (details) => post('/auth/register', details);

  const logout = () => {
    clearStoredSession();
    setUser(null);
  };

  const value = useMemo(() => ({ user, login, register, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
