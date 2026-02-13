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
    redis: {
        url: string;
    };
    jwt: {
        secret: string;
        expiresIn: string;
        refreshExpiresIn: string;
    };
    stripe: {
        secretKey: string;
        webhookSecret: string;
    };
    paystack: {
        secretKey: string;
        publicKey: string;
    };
    flutterwave: {
        secretKey: string;
        publicKey: string;
        webhookHash: string;
    };
    ai: {
        openaiApiKey: string;
        googleCredentials: string;
    };
    aiProxy: {
        url: string;
        apiKey: string;
    };
    license: {
        key: string;
        gatewayUrl: string;
    };
    email: {
        host: string;
        port: number;
        user: string;
        pass: string;
        from: string;
    };
    upload: {
        dir: string;
        maxFileSizeMB: number;
    };
    fcm: {
        projectId: string;
    };
};
//# sourceMappingURL=config.d.ts.map