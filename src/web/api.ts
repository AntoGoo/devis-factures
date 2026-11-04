export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public issues?: unknown) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'internal', data?.message ?? 'Erreur inattendue.', data?.issues);
  // Réponse réussie mais illisible (ex. page HTML servie à la place de l'API) : erreur plutôt que données vides.
  if (data === undefined) throw invalidResponse(res.status);
  return data as T;
}

export function invalidResponse(status: number): ApiError {
  return new ApiError(status, 'invalid_response', 'Réponse inattendue du serveur.');
}
