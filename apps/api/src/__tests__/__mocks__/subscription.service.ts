// Mock subscription service for middleware tests
// Each function is a jest.fn() that can be configured per test

export const getOrgSubscription = jest.fn();
export const getAiWallet = jest.fn();
export const getTranslationWallet = jest.fn();
export const deductAiWallet = jest.fn();
export const deductTranslationWallet = jest.fn();
export const getPlans = jest.fn();
export const getPlanById = jest.fn();
export const getPlanBySlug = jest.fn();
export const getPlanPrice = jest.fn();
export const isNigeria = jest.fn();
export const getCurrency = jest.fn();
export const topUpAiWallet = jest.fn();
export const topUpTranslationWallet = jest.fn();
