// ============================================================
// OrgsLedger API — Zod-to-OpenAPI Bridge
// Converts Zod schemas into JSON Schema objects compatible
// with the OpenAPI 3.0 specification.  Keeps docs in sync
// with the actual validators used by route handlers.
// ============================================================

import { z, ZodTypeAny, ZodObject, ZodArray, ZodEnum, ZodOptional, ZodNullable, ZodDefault, ZodString, ZodNumber, ZodBoolean, ZodLiteral, ZodUnion } from 'zod';

/**
 * Convert a Zod schema into an OpenAPI-compatible JSON Schema object.
 * Supports the subset of Zod types used in OrgsLedger route validators.
 */
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, any> {
  // Unwrap wrappers first
  if (schema instanceof ZodOptional) {
    return zodToJsonSchema((schema as any)._def.innerType);
  }
  if (schema instanceof ZodDefault) {
    const inner = zodToJsonSchema((schema as any)._def.innerType);
    inner.default = (schema as any)._def.defaultValue();
    return inner;
  }
  if (schema instanceof ZodNullable) {
    const inner = zodToJsonSchema((schema as any)._def.innerType);
    inner.nullable = true;
    return inner;
  }

  // Primitives
  if (schema instanceof ZodString) {
    const s: Record<string, any> = { type: 'string' };
    for (const check of (schema as any)._def.checks || []) {
      if (check.kind === 'min') s.minLength = check.value;
      if (check.kind === 'max') s.maxLength = check.value;
      if (check.kind === 'email') s.format = 'email';
      if (check.kind === 'uuid') s.format = 'uuid';
      if (check.kind === 'url') s.format = 'uri';
      if (check.kind === 'regex') s.pattern = check.regex.source;
    }
    return s;
  }

  if (schema instanceof ZodNumber) {
    const n: Record<string, any> = { type: 'number' };
    for (const check of (schema as any)._def.checks || []) {
      if (check.kind === 'int') n.type = 'integer';
      if (check.kind === 'min') n.minimum = check.value;
      if (check.kind === 'max') n.maximum = check.value;
    }
    return n;
  }

  if (schema instanceof ZodBoolean) {
    return { type: 'boolean' };
  }

  if (schema instanceof ZodLiteral) {
    return { type: typeof (schema as any)._def.value, enum: [(schema as any)._def.value] };
  }

  // Enums
  if (schema instanceof ZodEnum) {
    return { type: 'string', enum: (schema as any)._def.values };
  }

  // Arrays
  if (schema instanceof ZodArray) {
    const items = zodToJsonSchema((schema as any)._def.type);
    const arr: Record<string, any> = { type: 'array', items };
    const minLength = (schema as any)._def.minLength;
    const maxLength = (schema as any)._def.maxLength;
    if (minLength != null) arr.minItems = minLength.value;
    if (maxLength != null) arr.maxItems = maxLength.value;
    return arr;
  }

  // Objects
  if (schema instanceof ZodObject) {
    const shape = (schema as any)._def.shape();
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as ZodTypeAny);
      // Required if NOT optional and NOT defaulted
      if (!(value instanceof ZodOptional) && !(value instanceof ZodDefault)) {
        required.push(key);
      }
    }

    const obj: Record<string, any> = { type: 'object', properties };
    if (required.length) obj.required = required;
    return obj;
  }

  // Union (ZodUnion) — oneOf
  if (schema instanceof ZodUnion) {
    const options = (schema as any)._def.options.map((o: ZodTypeAny) => zodToJsonSchema(o));
    return { oneOf: options };
  }

  // Fallback — opaque
  return { type: 'object', description: 'Complex type (see source)' };
}

/**
 * Registry of named Zod schemas for auto-documentation.
 * Routes register their schemas here; the docs endpoint
 * pulls them into the OpenAPI components.schemas section.
 */
const schemaRegistry = new Map<string, { schema: ZodTypeAny; description?: string }>();

export function registerSchema(name: string, schema: ZodTypeAny, description?: string): void {
  schemaRegistry.set(name, { schema, description });
}

export function getRegisteredSchemas(): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [name, { schema, description }] of schemaRegistry) {
    const jsonSchema = zodToJsonSchema(schema);
    if (description) jsonSchema.description = description;
    result[name] = jsonSchema;
  }
  return result;
}

export { schemaRegistry };
