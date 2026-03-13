"use strict";
// ============================================================
// OrgsLedger API — AI Service Pricing Configuration
// ============================================================
//
// All AI provider pricing is centralized here for easy updates.
// Environment variables can override default values.
//
// Pricing Sources:
//   - Deepgram: https://deepgram.com/pricing
//   - OpenAI: https://openai.com/api/pricing
//   - Translation: Provider-specific
//
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_COST_LIMITS = exports.AI_PRICING = void 0;
exports.getPricingSnapshot = getPricingSnapshot;
// ── Default Pricing ─────────────────────────────────────────
const DEFAULT_PRICING = {
    deepgram: {
        // Pay-as-you-go streaming transcription (Nova-2)
        streaming_per_minute: 0.0043,
    },
    openai: {
        models: {
            'gpt-4.1-mini': {
                input_per_million_tokens: 0.15,
                output_per_million_tokens: 0.60,
            },
            'gpt-4o': {
                input_per_million_tokens: 2.50,
                output_per_million_tokens: 10.00,
            },
            'gpt-4o-mini': {
                input_per_million_tokens: 0.15,
                output_per_million_tokens: 0.60,
            },
        },
    },
    translation: {
        // Price per character (e.g., Google Translate API)
        per_character: 0.00002,
    },
};
// ── Environment Override Support ────────────────────────────
function parseFloat(envVar, defaultValue) {
    if (envVar === undefined || envVar === '') {
        return defaultValue;
    }
    const parsed = Number.parseFloat(envVar);
    return Number.isNaN(parsed) ? defaultValue : parsed;
}
// ── Exported Pricing Configuration ──────────────────────────
exports.AI_PRICING = {
    deepgram: {
        streaming_per_minute: parseFloat(process.env.DEEPGRAM_PRICE_PER_MIN, DEFAULT_PRICING.deepgram.streaming_per_minute),
    },
    openai: {
        models: {
            'gpt-4.1-mini': {
                input_per_million_tokens: parseFloat(process.env.OPENAI_GPT4_MINI_INPUT_PRICE, DEFAULT_PRICING.openai.models['gpt-4.1-mini'].input_per_million_tokens),
                output_per_million_tokens: parseFloat(process.env.OPENAI_GPT4_MINI_OUTPUT_PRICE, DEFAULT_PRICING.openai.models['gpt-4.1-mini'].output_per_million_tokens),
            },
            'gpt-4o': {
                input_per_million_tokens: parseFloat(process.env.OPENAI_GPT4O_INPUT_PRICE, DEFAULT_PRICING.openai.models['gpt-4o'].input_per_million_tokens),
                output_per_million_tokens: parseFloat(process.env.OPENAI_GPT4O_OUTPUT_PRICE, DEFAULT_PRICING.openai.models['gpt-4o'].output_per_million_tokens),
            },
            'gpt-4o-mini': {
                input_per_million_tokens: parseFloat(process.env.OPENAI_GPT4O_MINI_INPUT_PRICE, DEFAULT_PRICING.openai.models['gpt-4o-mini'].input_per_million_tokens),
                output_per_million_tokens: parseFloat(process.env.OPENAI_GPT4O_MINI_OUTPUT_PRICE, DEFAULT_PRICING.openai.models['gpt-4o-mini'].output_per_million_tokens),
            },
        },
        // Default model for cost calculations
        defaultModel: (process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1-mini'),
    },
    translation: {
        per_character: parseFloat(process.env.TRANSLATION_PRICE_PER_CHAR, DEFAULT_PRICING.translation.per_character),
    },
};
// ── Cost Limits (Safety Thresholds) ─────────────────────────
exports.AI_COST_LIMITS = {
    // Daily cost limit in USD (triggers alert if exceeded)
    daily_cost_limit_usd: parseFloat(process.env.AI_DAILY_COST_LIMIT_USD, 100.00),
    // Maximum translation characters per day
    max_translation_chars_per_day: parseFloat(process.env.AI_MAX_TRANSLATION_CHARS_PER_DAY, 10_000_000),
    // Maximum Deepgram minutes per day
    max_deepgram_minutes_per_day: parseFloat(process.env.AI_MAX_DEEPGRAM_MINUTES_PER_DAY, 10_000),
    // Maximum OpenAI tokens per day (input + output)
    max_openai_tokens_per_day: parseFloat(process.env.AI_MAX_OPENAI_TOKENS_PER_DAY, 50_000_000),
};
/**
 * Get a snapshot of current pricing for logging/debugging
 */
function getPricingSnapshot() {
    const model = exports.AI_PRICING.openai.defaultModel;
    return {
        deepgram_per_minute: exports.AI_PRICING.deepgram.streaming_per_minute,
        openai_input_per_million: exports.AI_PRICING.openai.models[model].input_per_million_tokens,
        openai_output_per_million: exports.AI_PRICING.openai.models[model].output_per_million_tokens,
        translation_per_char: exports.AI_PRICING.translation.per_character,
    };
}
exports.default = exports.AI_PRICING;
//# sourceMappingURL=ai-pricing.js.map