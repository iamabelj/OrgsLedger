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
        refreshSecret: string;
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
    gateway: {
        url: string;
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
    livekit: {
        url: string;
        apiKey: string;
        apiSecret: string;
    };
    deepgram: {
        apiKey: string;
        model: string;
        language: string;
    };
    translation: {
        provider: string;
        targetLanguages: string[];
    };
};
//# sourceMappingURL=config.d.ts.map