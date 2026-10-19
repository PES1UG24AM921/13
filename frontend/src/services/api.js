const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/$/, '');

export async function api(path, options = {}) {
  const token = localStorage.getItem('hms_token');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('hms:unauthorized'));
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }
  return data;
}
export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
export const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });
export const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = (path) => api(path, { method: 'DELETE' });
