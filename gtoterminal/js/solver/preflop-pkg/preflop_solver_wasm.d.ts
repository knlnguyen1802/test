/* tslint:disable */
/* eslint-disable */

export class PreflopSolver {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get current exploitability (lower = closer to Nash equilibrium)
     */
    exploitability(): number;
    /**
     * Get results as JSON string.
     * Returns: { "AA": { "fold": 0.0, "call": 0.0, "raise": 1.0 }, ... }
     */
    get_results(): string;
    /**
     * Get results in the compact format used by PreflopRanges.
     * Returns JSON: { "pure_raise": ["AA","KK",...], "pure_call": [...], "mixed": {"QQ": [fold,call,raise],...} }
     */
    get_results_compact(): string;
    /**
     * Get current iteration count
     */
    iterations(): number;
    /**
     * Create a new solver instance
     */
    constructor();
    /**
     * Get total combos in the hero's raising range
     */
    raise_combos(): number;
    /**
     * Set up a preflop spot to solve.
     *
     * config_json format:
     * {
     *   "stackDepth": 100,          // Effective stack in BB
     *   "actionContext": "rfi",      // "rfi", "vs_raise", "vs_3bet", "vs_4bet"
     *   "villainRange": [1.0, ...],  // 169 weights (optional, defaults to full range)
     *   "icmBubbleFactor": 1.0       // ICM bubble factor (optional, default 1.0)
     * }
     */
    setup(config_json: string): string | undefined;
    /**
     * Run solver iterations.
     * Returns the number of iterations actually performed.
     */
    solve(max_iterations: number, target_exploitability: number): number;
    /**
     * Run a single batch of iterations (for progress reporting).
     * Returns current iteration count.
     */
    solve_step(batch_size: number): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_preflopsolver_free: (a: number, b: number) => void;
    readonly preflopsolver_exploitability: (a: number) => number;
    readonly preflopsolver_get_results: (a: number) => [number, number];
    readonly preflopsolver_get_results_compact: (a: number) => [number, number];
    readonly preflopsolver_iterations: (a: number) => number;
    readonly preflopsolver_new: () => number;
    readonly preflopsolver_raise_combos: (a: number) => number;
    readonly preflopsolver_setup: (a: number, b: number, c: number) => [number, number];
    readonly preflopsolver_solve: (a: number, b: number, c: number) => number;
    readonly preflopsolver_solve_step: (a: number, b: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
