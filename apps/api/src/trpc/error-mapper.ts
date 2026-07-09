import { HttpException } from '@nestjs/common';
import { TRPCError, type TRPC_ERROR_CODE_KEY } from '@trpc/server';

// Maps NestJS HttpException status codes to tRPC error codes. tRPC then
// derives the HTTP response status from the code (UNAUTHORIZED → 401,
// CONFLICT → 409, etc.), so the wire-level status matches what the
// service threw without each router needing its own try/catch.
const STATUS_TO_TRPC: Record<number, TRPC_ERROR_CODE_KEY> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_SUPPORTED',
  408: 'TIMEOUT',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_CONTENT',
  429: 'TOO_MANY_REQUESTS',
  499: 'CLIENT_CLOSED_REQUEST',
};

export function toTrpcError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;

  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code = STATUS_TO_TRPC[status] ?? 'INTERNAL_SERVER_ERROR';
    return new TRPCError({ code, message: err.message, cause: err });
  }

  // Some service paths throw plain objects (e.g. `{ status: 401, message }`)
  // — handle that shape too so existing auth flows keep working.
  if (err && typeof err === 'object' && 'status' in err) {
    const status = Number((err as { status: unknown }).status);
    const code = STATUS_TO_TRPC[status] ?? 'INTERNAL_SERVER_ERROR';
    const message =
      'message' in err && typeof err.message === 'string' ? err.message : 'Request failed';
    return new TRPCError({ code, message, cause: err as unknown as Error });
  }

  const message = err instanceof Error ? err.message : 'Internal error';
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message,
    cause: err instanceof Error ? err : undefined,
  });
}
