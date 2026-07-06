/* @ts-self-types="./gto_solver_wasm.d.ts" */

export class GameManager {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(GameManager.prototype);
        obj.__wbg_ptr = ptr;
        GameManagerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GameManagerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_gamemanager_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    actions() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.gamemanager_actions(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {boolean} enable_compression
     */
    allocate_memory(enable_compression) {
        wasm.gamemanager_allocate_memory(this.__wbg_ptr, enable_compression);
    }
    /**
     * @param {Uint32Array} history
     */
    apply_history(history) {
        const ptr0 = passArray32ToWasm0(history, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.gamemanager_apply_history(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {string}
     */
    current_player() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.gamemanager_current_player(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    exploitability() {
        const ret = wasm.gamemanager_exploitability(this.__wbg_ptr);
        return ret;
    }
    finalize() {
        wasm.gamemanager_finalize(this.__wbg_ptr);
    }
    /**
     * Get full results at the current game tree node.
     * Returns a packed Float64Array with weights, equity, EV, EQR, and strategy.
     * @returns {Float64Array}
     */
    get_results() {
        const ret = wasm.gamemanager_get_results(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Initialize with ranges, board, pot/stack, and bet sizes.
     * Returns null on success, error string on failure.
     * @param {Float32Array} oop_range
     * @param {Float32Array} ip_range
     * @param {Uint8Array} board
     * @param {number} starting_pot
     * @param {number} effective_stack
     * @param {number} rake_rate
     * @param {number} rake_cap
     * @param {boolean} donk_option
     * @param {string} oop_flop_bet
     * @param {string} oop_flop_raise
     * @param {string} oop_turn_bet
     * @param {string} oop_turn_raise
     * @param {string} oop_turn_donk
     * @param {string} oop_river_bet
     * @param {string} oop_river_raise
     * @param {string} oop_river_donk
     * @param {string} ip_flop_bet
     * @param {string} ip_flop_raise
     * @param {string} ip_turn_bet
     * @param {string} ip_turn_raise
     * @param {string} ip_river_bet
     * @param {string} ip_river_raise
     * @param {number} add_allin_threshold
     * @param {number} force_allin_threshold
     * @param {number} merging_threshold
     * @param {string} added_lines
     * @param {string} removed_lines
     * @returns {string | undefined}
     */
    init(oop_range, ip_range, board, starting_pot, effective_stack, rake_rate, rake_cap, donk_option, oop_flop_bet, oop_flop_raise, oop_turn_bet, oop_turn_raise, oop_turn_donk, oop_river_bet, oop_river_raise, oop_river_donk, ip_flop_bet, ip_flop_raise, ip_turn_bet, ip_turn_raise, ip_river_bet, ip_river_raise, add_allin_threshold, force_allin_threshold, merging_threshold, added_lines, removed_lines) {
        const ptr0 = passArrayF32ToWasm0(oop_range, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(ip_range, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(board, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(oop_flop_bet, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(oop_flop_raise, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(oop_turn_bet, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(oop_turn_raise, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passStringToWasm0(oop_turn_donk, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len7 = WASM_VECTOR_LEN;
        const ptr8 = passStringToWasm0(oop_river_bet, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len8 = WASM_VECTOR_LEN;
        const ptr9 = passStringToWasm0(oop_river_raise, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len9 = WASM_VECTOR_LEN;
        const ptr10 = passStringToWasm0(oop_river_donk, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len10 = WASM_VECTOR_LEN;
        const ptr11 = passStringToWasm0(ip_flop_bet, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len11 = WASM_VECTOR_LEN;
        const ptr12 = passStringToWasm0(ip_flop_raise, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len12 = WASM_VECTOR_LEN;
        const ptr13 = passStringToWasm0(ip_turn_bet, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len13 = WASM_VECTOR_LEN;
        const ptr14 = passStringToWasm0(ip_turn_raise, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len14 = WASM_VECTOR_LEN;
        const ptr15 = passStringToWasm0(ip_river_bet, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len15 = WASM_VECTOR_LEN;
        const ptr16 = passStringToWasm0(ip_river_raise, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len16 = WASM_VECTOR_LEN;
        const ptr17 = passStringToWasm0(added_lines, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len17 = WASM_VECTOR_LEN;
        const ptr18 = passStringToWasm0(removed_lines, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len18 = WASM_VECTOR_LEN;
        const ret = wasm.gamemanager_init(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, starting_pot, effective_stack, rake_rate, rake_cap, donk_option, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7, ptr8, len8, ptr9, len9, ptr10, len10, ptr11, len11, ptr12, len12, ptr13, len13, ptr14, len14, ptr15, len15, ptr16, len16, add_allin_threshold, force_allin_threshold, merging_threshold, ptr17, len17, ptr18, len18);
        let v20;
        if (ret[0] !== 0) {
            v20 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v20;
    }
    /**
     * @param {boolean} enable_compression
     * @returns {bigint}
     */
    memory_usage(enable_compression) {
        const ret = wasm.gamemanager_memory_usage(this.__wbg_ptr, enable_compression);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {GameManager}
     */
    static new() {
        const ret = wasm.gamemanager_new();
        return GameManager.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    num_actions() {
        const ret = wasm.gamemanager_num_actions(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} player
     * @returns {Uint16Array}
     */
    private_cards(player) {
        const ret = wasm.gamemanager_private_cards(this.__wbg_ptr, player);
        var v1 = getArrayU16FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 2, 2);
        return v1;
    }
    /**
     * @param {number} current_iteration
     */
    solve_step(current_iteration) {
        wasm.gamemanager_solve_step(this.__wbg_ptr, current_iteration);
    }
}
if (Symbol.dispose) GameManager.prototype[Symbol.dispose] = GameManager.prototype.free;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_df03e93053e0f4bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./gto_solver_wasm_bg.js": import0,
    };
}

const GameManagerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_gamemanager_free(ptr >>> 0, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('gto_solver_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
