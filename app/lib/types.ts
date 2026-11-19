/**
 * Frontend view of the API contract. Re-exports shared/api-types.ts so the
 * React app and the Worker compile against exactly the same shapes.
 */
export * from '../../shared/api-types';

export type { Tone } from './format';

/** Change/input event of a Polaris form field rendered through the ui wrappers (typed `any` there). */
export type FieldEvent = Event & { currentTarget: HTMLInputElement };
