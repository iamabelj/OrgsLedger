export declare const config: {
    env: string;
    port: number;
    apiUrl: string;
    db: {
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
    };
    jwt: {
        secret: string;
        expiresIn: string;
        refreshExpiresIn: string;
    };
    upload: {
        dir: string;
        maxFileSizeMB: number;
    };
    ai: {
        openaiApiKey: string;
        googleCredentials: string;
    };
    aiProxy: {
        url: string;
        apiKey: string;
    };
};
//# sourceMappingURL=config.d.ts.map