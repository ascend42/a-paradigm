/**
 * MCP Tools Input Validation
 *
 * Zod schemas for validating tool inputs
 */

import { z } from 'zod';

// Symbol format validation regex
const SYMBOL_PREFIX_REGEX = /^[@#$%^!?~&]/;

/**
 * Custom Zod schema for Paradigm symbols
 */
export const symbolSchema = z.string().refine(
  (val) => SYMBOL_PREFIX_REGEX.test(val),
  {
    message: 'Symbol must start with a valid prefix: @ # $ % ^ ! ? ~ or &',
  }
);

/**
 * Schema for paradigm_search input
 */
export const searchInputSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  type: z
    .enum(['feature', 'component', 'gate', 'flow', 'signal', 'state', 'idea'])
    .optional(),
  limit: z.number().int().min(1).max(100).optional().default(10),
  fuzzy: z.boolean().optional().default(true),
});

/**
 * Schema for paradigm_ripple input
 */
export const rippleInputSchema = z.object({
  symbol: symbolSchema,
  depth: z.number().int().min(1).max(5).optional().default(2),
});

/**
 * Schema for paradigm_related input
 */
export const relatedInputSchema = z.object({
  symbol: symbolSchema,
});

/**
 * Schema for paradigm_gates_for_route input
 */
export const gatesForRouteInputSchema = z.object({
  route: z.string().min(1, 'Route cannot be empty'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
});

/**
 * Schema for paradigm_navigate input
 */
export const navigateInputSchema = z.object({
  intent: z.enum(['find', 'explore', 'context']),
  target: z.string().optional(),
  task: z.string().optional(),
});

/**
 * Schema for paradigm_wisdom_context input
 */
export const wisdomContextInputSchema = z.object({
  symbols: z.array(symbolSchema).min(1, 'At least one symbol required'),
  include_global: z.boolean().optional().default(true),
});

/**
 * Schema for paradigm_history_context input
 */
export const historyContextInputSchema = z.object({
  symbols: z.array(symbolSchema).min(1, 'At least one symbol required'),
});

/**
 * Validate input against a schema and return typed result or error
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  input: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format error message
  const errors = result.error.errors.map((e) => {
    const path = e.path.length > 0 ? `${e.path.join('.')}: ` : '';
    return `${path}${e.message}`;
  });

  return { success: false, error: errors.join('; ') };
}

/**
 * Create a validation error response
 */
export function validationErrorResponse(error: string): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            error: 'Validation error',
            details: error,
            hint: 'Check the input parameters match the expected schema',
          },
          null,
          2
        ),
      },
    ],
  };
}
