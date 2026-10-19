import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import { Login, Register } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { Doctors, BookAppointment, Appointments, Records, Profile, Availability, Users, Audit, NotFound } from './pages/WorkspacePages.jsx';

function Guard({children,roles}){const {user}=useAuth();const location=useLocation();if(!user)return <Navigate to="/login" replace state={{from:location.pathname}}/>;if(roles&&!roles.includes(user.role))return <Navigate to="/dashboard" replace/>;return children;}
function PublicOnly({children}){const {user}=useAuth();return user?<Navigate to="/dashboard" replace/>:children;}
export default function App(){const {user}=useAuth();return <Routes><Route path="/" element={<Navigate to={user?'/dashboard':'/login'} replace/>}/><Route path="/login" element={<PublicOnly><Login/></PublicOnly>}/><Route path="/register" element={<PublicOnly><Register/></PublicOnly>}/><Route element={<Guard><Layout/></Guard>}><Route path="/dashboard" element={<Dashboard/>}/><Route path="/doctors" element={<Guard roles={['patient']}><Doctors/></Guard>}/><Route path="/book/:doctorId" element={<Guard roles={['patient']}><BookAppointment/></Guard>}/><Route path="/appointments" element={<Appointments/>}/><Route path="/records" element={<Guard roles={['patient','doctor']}><Records/></Guard>}/><Route path="/profile" element={<Guard roles={['patient']}><Profile/></Guard>}/><Route path="/availability" element={<Guard roles={['doctor']}><Availability/></Guard>}/><Route path="/users" element={<Guard roles={['admin']}><Users/></Guard>}/><Route path="/audit" element={<Guard roles={['admin']}><Audit/></Guard>}/><Route path="*" element={<NotFound/>}/></Route></Routes>}
