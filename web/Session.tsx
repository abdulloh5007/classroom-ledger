import { createContext, useContext } from 'react';
import type { StaffUser } from '../src/contracts';
export const SessionContext = createContext<StaffUser | null>(null);
export function usePermissions() {
  const user = useContext(SessionContext);
  return {
    user,
    canManageCourses: user?.role !== 'teacher',
    canManageStaff: user?.role === 'owner',
  };
}
export const roleLabel = { teacher: 'Учитель', admin: 'Администратор', owner: 'Владелец' } as const;
