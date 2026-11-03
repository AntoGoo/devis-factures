import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '../../shared/api-types';
import { api } from '../api';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('GET', '/api/me') });
}
