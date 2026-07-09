import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';

interface RolesGuardProps {
  allowedRoles: string[];
  children: ReactNode;
}

export function RolesGuard({ allowedRoles, children }: RolesGuardProps) {
  const { user } = useAuth();
  const userRoles = user?.roles ?? [];
  const granted = allowedRoles.some((role) => userRoles.includes(role));
  if (!granted) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}
