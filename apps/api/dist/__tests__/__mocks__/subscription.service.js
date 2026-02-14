"use strict";
// Mock subscription service for middleware tests
// Each function is a jest.fn() that can be configured per test
Object.defineProperty(exports, "__esModule", { value: true });
exports.topUpTranslationWallet = exports.topUpAiWallet = exports.getCurrency = exports.isNigeria = exports.getPlanPrice = exports.getPlanBySlug = exports.getPlanById = exports.getPlans = exports.deductTranslationWallet = exports.deductAiWallet = exports.getTranslationWallet = exports.getAiWallet = exports.getOrgSubscription = void 0;
exports.getOrgSubscription = jest.fn();
exports.getAiWallet = jest.fn();
exports.getTranslationWallet = jest.fn();
exports.deductAiWallet = jest.fn();
exports.deductTranslationWallet = jest.fn();
exports.getPlans = jest.fn();
exports.getPlanById = jest.fn();
exports.getPlanBySlug = jest.fn();
exports.getPlanPrice = jest.fn();
exports.isNigeria = jest.fn();
exports.getCurrency = jest.fn();
exports.topUpAiWallet = jest.fn();
exports.topUpTranslationWallet = jest.fn();
//# sourceMappingURL=subscription.service.js.map