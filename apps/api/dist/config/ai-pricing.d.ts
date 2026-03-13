declare const DEFAULT_PRICING: {
    deepgram: {
        streaming_per_minute: number;
    };
    openai: {
        models: {
            'gpt-4.1-mini': {
                input_per_million_tokens: number;
                output_per_million_tokens: number;
            };
            'gpt-4o': {
                input_per_million_tokens: number;
                output_per_million_tokens: number;
            };
            'gpt-4o-mini': {
                input_per_million_tokens: number;
                output_per_million_tokens: number;
            };
        };
    };
    translation: {
        per_character: number;
    };
};
export declare const AI_PRICING: {
    deepgram: {
        streaming_per_minute: number;
    };
    openai: {
        models: {
            'gpt-4.1-mini': {
                input_per_million_tokens: number;
                output_per_million_tokens: number;
            };
            'gpt-4o': {
                input_per_million_tokens: number;
                output_per_million_tokens: number;
            };
            'gpt-4o-mini': {
                input_per_million_tokens: number;
                output_per_million_tokens: number;
            };
        };
        defaultModel: keyof typeof DEFAULT_PRICING.openai.models;
    };
    translation: {
        per_character: number;
    };
};
export declare const AI_COST_LIMITS: {
    daily_cost_limit_usd: number;
    max_translation_chars_per_day: number;
    max_deepgram_minutes_per_day: number;
    max_openai_tokens_per_day: number;
};
export type OpenAIModel = keyof typeof AI_PRICING.openai.models;
export interface AIPricingSnapshot {
    deepgram_per_minute: number;
    openai_input_per_million: number;
    openai_output_per_million: number;
    translation_per_char: number;
}
/**
 * Get a snapshot of current pricing for logging/debugging
 */
export declare function getPricingSnapshot(): AIPricingSnapshot;
export default AI_PRICING;
//# sourceMappingURL=ai-pricing.d.ts.map