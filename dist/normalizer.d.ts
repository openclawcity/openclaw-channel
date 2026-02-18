import type { CityEvent, MessageEnvelope, WelcomeFrame } from './types.js';
/**
 * Format a city event into human-readable text for the LLM.
 */
export declare function formatEventText(event: CityEvent): string;
/**
 * Format a welcome frame into human-readable text.
 */
export declare function formatWelcomeText(welcome: WelcomeFrame): string;
/**
 * Normalize a city_event into an OpenClaw MessageEnvelope.
 */
export declare function normalize(event: CityEvent): MessageEnvelope;
