import '../schemas/api-schemas';
declare const router: import("express-serve-static-core").Router;
/**
 * OpenAPI 3.0 specification for the OrgsLedger API.
 * Served at /api/docs/openapi.json
 */
declare const openApiSpec: {
    openapi: string;
    info: {
        title: string;
        version: string;
        description: string;
        contact: {
            name: string;
            email: string;
        };
        license: {
            name: string;
        };
    };
    servers: {
        url: string;
        description: string;
    }[];
    components: {
        securitySchemes: {
            BearerAuth: {
                type: string;
                scheme: string;
                bearerFormat: string;
                description: string;
            };
        };
        schemas: {
            Error: {
                type: string;
                properties: {
                    success: {
                        type: string;
                        example: boolean;
                    };
                    error: {
                        type: string;
                        example: string;
                    };
                };
            };
            Success: {
                type: string;
                properties: {
                    success: {
                        type: string;
                        example: boolean;
                    };
                    data: {
                        type: string;
                    };
                };
            };
            User: {
                type: string;
                properties: {
                    id: {
                        type: string;
                        format: string;
                    };
                    email: {
                        type: string;
                        format: string;
                    };
                    firstName: {
                        type: string;
                    };
                    lastName: {
                        type: string;
                    };
                    avatarUrl: {
                        type: string;
                        nullable: boolean;
                    };
                    globalRole: {
                        type: string;
                        enum: string[];
                    };
                };
            };
            Tokens: {
                type: string;
                properties: {
                    accessToken: {
                        type: string;
                    };
                    refreshToken: {
                        type: string;
                    };
                };
            };
            Membership: {
                type: string;
                properties: {
                    id: {
                        type: string;
                        format: string;
                    };
                    role: {
                        type: string;
                    };
                    organizationId: {
                        type: string;
                        format: string;
                    };
                    organizationName: {
                        type: string;
                    };
                    organizationSlug: {
                        type: string;
                    };
                };
            };
            PaginationMeta: {
                type: string;
                properties: {
                    page: {
                        type: string;
                    };
                    limit: {
                        type: string;
                    };
                    total: {
                        type: string;
                    };
                };
            };
        };
        parameters: {
            OrgId: {
                name: string;
                in: string;
                required: boolean;
                schema: {
                    type: string;
                    format: string;
                };
                description: string;
            };
            Page: {
                name: string;
                in: string;
                schema: {
                    type: string;
                    default: number;
                    minimum: number;
                };
            };
            Limit: {
                name: string;
                in: string;
                schema: {
                    type: string;
                    default: number;
                    maximum: number;
                };
            };
        };
    };
    security: {
        BearerAuth: never[];
    }[];
    paths: {
        '/auth/register': {
            post: {
                tags: string[];
                summary: string;
                security: never[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    email: {
                                        type: string;
                                        format: string;
                                    };
                                    password: {
                                        type: string;
                                        minLength: number;
                                    };
                                    firstName: {
                                        type: string;
                                    };
                                    lastName: {
                                        type: string;
                                    };
                                    inviteCode: {
                                        type: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    '201': {
                        description: string;
                    };
                    '400': {
                        description: string;
                    };
                    '409': {
                        description: string;
                    };
                };
            };
        };
        '/auth/login': {
            post: {
                tags: string[];
                summary: string;
                security: never[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    email: {
                                        type: string;
                                        format: string;
                                    };
                                    password: {
                                        type: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    '200': {
                        description: string;
                        content: {
                            'application/json': {
                                schema: {
                                    type: string;
                                    properties: {
                                        success: {
                                            type: string;
                                        };
                                        data: {
                                            type: string;
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                                memberships: {
                                                    type: string;
                                                    items: {
                                                        $ref: string;
                                                    };
                                                };
                                                accessToken: {
                                                    type: string;
                                                };
                                                refreshToken: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                    '401': {
                        description: string;
                    };
                    '423': {
                        description: string;
                    };
                };
            };
        };
        '/auth/refresh': {
            post: {
                tags: string[];
                summary: string;
                security: never[];
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    refreshToken: {
                                        type: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    '200': {
                        description: string;
                    };
                    '401': {
                        description: string;
                    };
                };
            };
        };
        '/auth/logout': {
            post: {
                tags: string[];
                summary: string;
                security: never[];
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                properties: {
                                    refreshToken: {
                                        type: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
        };
        '/auth/logout-all': {
            post: {
                tags: string[];
                summary: string;
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
        };
        '/auth/me': {
            get: {
                tags: string[];
                summary: string;
                responses: {
                    '200': {
                        description: string;
                    };
                    '401': {
                        description: string;
                    };
                };
            };
        };
        '/auth/change-password': {
            put: {
                tags: string[];
                summary: string;
                requestBody: {
                    required: boolean;
                    content: {
                        'application/json': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    currentPassword: {
                                        type: string;
                                    };
                                    newPassword: {
                                        type: string;
                                        minLength: number;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    '200': {
                        description: string;
                    };
                    '400': {
                        description: string;
                    };
                };
            };
        };
        '/organizations': {
            get: {
                tags: string[];
                summary: string;
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
            post: {
                tags: string[];
                summary: string;
                responses: {
                    '201': {
                        description: string;
                    };
                };
            };
        };
        '/documents/{orgId}': {
            get: {
                tags: string[];
                summary: string;
                parameters: ({
                    $ref: string;
                    name?: undefined;
                    in?: undefined;
                    schema?: undefined;
                } | {
                    name: string;
                    in: string;
                    schema: {
                        type: string;
                    };
                    $ref?: undefined;
                })[];
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
            post: {
                tags: string[];
                summary: string;
                requestBody: {
                    required: boolean;
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: string;
                                required: string[];
                                properties: {
                                    file: {
                                        type: string;
                                        format: string;
                                    };
                                    title: {
                                        type: string;
                                    };
                                    description: {
                                        type: string;
                                    };
                                    category: {
                                        type: string;
                                    };
                                };
                            };
                        };
                    };
                };
                responses: {
                    '201': {
                        description: string;
                    };
                    '400': {
                        description: string;
                    };
                };
            };
        };
        '/meetings/{orgId}': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    $ref: string;
                }[];
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
            post: {
                tags: string[];
                summary: string;
                parameters: {
                    $ref: string;
                }[];
                responses: {
                    '201': {
                        description: string;
                    };
                };
            };
        };
        '/financials/{orgId}': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    $ref: string;
                }[];
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
        };
        '/notifications': {
            get: {
                tags: string[];
                summary: string;
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
        };
        '/notifications/read-all': {
            put: {
                tags: string[];
                summary: string;
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
        };
        '/chat/{orgId}/channels': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    $ref: string;
                }[];
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
        };
        '/payments/{orgId}/pay': {
            post: {
                tags: string[];
                summary: string;
                parameters: {
                    $ref: string;
                }[];
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
        };
        '/subscriptions/{orgId}': {
            get: {
                tags: string[];
                summary: string;
                parameters: {
                    $ref: string;
                }[];
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
        };
        '/health': {
            get: {
                tags: string[];
                summary: string;
                security: never[];
                responses: {
                    '200': {
                        description: string;
                    };
                };
            };
        };
    };
    tags: {
        name: string;
        description: string;
    }[];
};
export default router;
export { openApiSpec };
//# sourceMappingURL=docs.d.ts.map