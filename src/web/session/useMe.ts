import { useQuery } from '@tanstack/react-query';
import type { MeResponse } from '../../shared/api-types';
import { api, invalidResponse } from '../api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await api<MeResponse>('GET', '/api/me');
      // Le reste de l'application lit user et onboarding sans précaution : une réponse incomplète est une erreur.
      if (!me?.user || !me.onboarding) throw invalidResponse(200);
      return me;
    },
  });
}
