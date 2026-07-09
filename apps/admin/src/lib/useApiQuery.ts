import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

// #944 (F2) — api() fetch wrapper'ını React Query'ye bağlayan ince hook. Her
// sayfa elle useEffect + AbortController + useState (loading/error) tekrarını
// bırakır; loading/error/refetch/staleTime/dedup tek yerde. Kullanım:
//   const q = useApiQuery(['feedback', status], () => api('/platform/feedback', { bearer }), { enabled: !!bearer })
export function useApiQuery<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  options?: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<T, Error>({ queryKey, queryFn, ...options });
}
