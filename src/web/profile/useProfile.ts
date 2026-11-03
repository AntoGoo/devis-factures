import { useQuery } from '@tanstack/react-query';
import type { NumberingInfo } from '../../shared/api-types';
import type { ProfileData } from '../../shared/profile';
import { api } from '../api';

export const useProfile = () => useQuery({ queryKey: ['profile'], queryFn: () => api<{ profile: ProfileData | null }>('GET', '/api/profile') });
export const useNumbering = () => useQuery({ queryKey: ['numbering'], queryFn: () => api<NumberingInfo>('GET', '/api/numbering') });
