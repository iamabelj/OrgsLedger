import { ZodTypeAny } from 'zod';
/**
 * Convert a Zod schema into an OpenAPI-compatible JSON Schema object.
 * Supports the subset of Zod types used in OrgsLedger route validators.
 */
export declare function zodToJsonSchema(schema: ZodTypeAny): Record<string, any>;
/**
 * Registry of named Zod schemas for auto-documentation.
 * Routes register their schemas here; the docs endpoint
 * pulls them into the OpenAPI components.schemas section.
 */
declare const schemaRegistry: Map<string, {
    schema: ZodTypeAny;
    description?: string;
}>;
export declare function registerSchema(name: string, schema: ZodTypeAny, description?: string): void;
export declare function getRegisteredSchemas(): Record<string, any>;
export { schemaRegistry };
//# sourceMappingURL=zod-to-openapi.d.ts.map