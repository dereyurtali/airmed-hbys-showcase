import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Pipe wrapper around a Zod schema. Use it on `@Body()`/`@Query()`/`@Param()`
 * handler arguments instead of repeating `safeParse` boilerplate inside every
 * controller method.
 *
 * Example:
 *   @Post()
 *   create(@Body(new ZodValidationPipe(patientCreateSchema)) dto: PatientCreateInput) {}
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
