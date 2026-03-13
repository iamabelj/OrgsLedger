"use strict";
// ============================================================
// OrgsLedger API — Zod-to-OpenAPI Bridge
// Converts Zod schemas into JSON Schema objects compatible
// with the OpenAPI 3.0 specification.  Keeps docs in sync
// with the actual validators used by route handlers.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.schemaRegistry = void 0;
exports.zodToJsonSchema = zodToJsonSchema;
exports.registerSchema = registerSchema;
exports.getRegisteredSchemas = getRegisteredSchemas;
const zod_1 = require("zod");
/**
 * Convert a Zod schema into an OpenAPI-compatible JSON Schema object.
 * Supports the subset of Zod types used in OrgsLedger route validators.
 */
function zodToJsonSchema(schema) {
    // Unwrap wrappers first
    if (schema instanceof zod_1.ZodOptional) {
        return zodToJsonSchema(schema._def.innerType);
    }
    if (schema instanceof zod_1.ZodDefault) {
        const inner = zodToJsonSchema(schema._def.innerType);
        inner.default = schema._def.defaultValue();
        return inner;
    }
    if (schema instanceof zod_1.ZodNullable) {
        const inner = zodToJsonSchema(schema._def.innerType);
        inner.nullable = true;
        return inner;
    }
    // Primitives
    if (schema instanceof zod_1.ZodString) {
        const s = { type: 'string' };
        for (const check of schema._def.checks || []) {
            if (check.kind === 'min')
                s.minLength = check.value;
            if (check.kind === 'max')
                s.maxLength = check.value;
            if (check.kind === 'email')
                s.format = 'email';
            if (check.kind === 'uuid')
                s.format = 'uuid';
            if (check.kind === 'url')
                s.format = 'uri';
            if (check.kind === 'regex')
                s.pattern = check.regex.source;
        }
        return s;
    }
    if (schema instanceof zod_1.ZodNumber) {
        const n = { type: 'number' };
        for (const check of schema._def.checks || []) {
            if (check.kind === 'int')
                n.type = 'integer';
            if (check.kind === 'min')
                n.minimum = check.value;
            if (check.kind === 'max')
                n.maximum = check.value;
        }
        return n;
    }
    if (schema instanceof zod_1.ZodBoolean) {
        return { type: 'boolean' };
    }
    if (schema instanceof zod_1.ZodLiteral) {
        return { type: typeof schema._def.value, enum: [schema._def.value] };
    }
    // Enums
    if (schema instanceof zod_1.ZodEnum) {
        return { type: 'string', enum: schema._def.values };
    }
    // Arrays
    if (schema instanceof zod_1.ZodArray) {
        const items = zodToJsonSchema(schema._def.type);
        const arr = { type: 'array', items };
        const minLength = schema._def.minLength;
        const maxLength = schema._def.maxLength;
        if (minLength != null)
            arr.minItems = minLength.value;
        if (maxLength != null)
            arr.maxItems = maxLength.value;
        return arr;
    }
    // Objects
    if (schema instanceof zod_1.ZodObject) {
        const shape = schema._def.shape();
        const properties = {};
        const required = [];
        for (const [key, value] of Object.entries(shape)) {
            properties[key] = zodToJsonSchema(value);
            // Required if NOT optional and NOT defaulted
            if (!(value instanceof zod_1.ZodOptional) && !(value instanceof zod_1.ZodDefault)) {
                required.push(key);
            }
        }
        const obj = { type: 'object', properties };
        if (required.length)
            obj.required = required;
        return obj;
    }
    // Union (ZodUnion) — oneOf
    if (schema instanceof zod_1.ZodUnion) {
        const options = schema._def.options.map((o) => zodToJsonSchema(o));
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
const schemaRegistry = new Map();
exports.schemaRegistry = schemaRegistry;
function registerSchema(name, schema, description) {
    schemaRegistry.set(name, { schema, description });
}
function getRegisteredSchemas() {
    const result = {};
    for (const [name, { schema, description }] of schemaRegistry) {
        const jsonSchema = zodToJsonSchema(schema);
        if (description)
            jsonSchema.description = description;
        result[name] = jsonSchema;
    }
    return result;
}
//# sourceMappingURL=zod-to-openapi.js.map