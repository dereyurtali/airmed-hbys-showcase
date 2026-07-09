import { createTRPCReact, type CreateTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../api/src/trpc/app-router';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trpc: CreateTRPCReact<AppRouter, any> = createTRPCReact<AppRouter>();
export type { AppRouter };
