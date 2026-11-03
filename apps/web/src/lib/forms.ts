import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/** Puts API field-level validation errors onto the matching form fields; returns a general message. */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): string {
  if (err instanceof ApiError) {
    const fields = err.fieldErrors;
    for (const [path, message] of Object.entries(fields)) setError(path as Path<T>, { type: 'server', message });
    return Object.keys(fields).length ? 'Please correct the highlighted fields.' : err.message;
  }
  return 'Something went wrong. Please try again.';
}
