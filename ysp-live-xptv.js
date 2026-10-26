/*
 * ===================================================================
 *  央视频直播 (YSP Live v9.5) —— XPTV 内置 JS 扩展版 v2.2.4
 * ===================================================================
 *
 *  v2.1.0 是在 v2.0.0 基础上加的自动换源（见下）；v2 是对 v1.0.0 的修正重发，不是重写：Device / BK / 频道表与
 *  入口函数的代码与用户提供的 Ysp_Xptv_1.0.0.txt 逐字相同（仅改了
 *  本文件头、版本号、订阅 api 名与 getPlayinfo 的容错，见下）。
 *
 *  修正的结论（v1 说错了，特此更正）：
 *  1. Device 协议可以在 XPTV 里跑。本文件自带纯 JS 加密套件
 *     （TEA/cKey、MD5、SHA-1、SHA-256、AES-256-GCM、2048 位
 *     RSA-OAEP-SHA256，BigInt 实现），不依赖 Node.js crypto；
 *     Device 解析是“一锤子”请求（注册→取流→VDN 签名），心跳
 *     只是会话建立时的一次性 post，不需要定时器常驻。用户实测：
 *     央视各台的投屏源（Device）在 XPTV 里能播。
 *  2. 频道表与 BK 签名已与 JSTV 版（ysp-live-spider.js）逐项核对：
 *     64 个台的 id / channelID / livePID / definition 零差异，
 *     BK 的 PLATFORM / APP_VERSION / TEA_KEY / 请求参数 / 候选
 *     地址排序也一致。所以卫视“有时能播有时不能播”不是数据错，
 *     是 BK 上游本身的波动：卫视没有 Device LIVE_ID，只能走 BK。
 *     v2 的办法是把 BK 的主备线都暴露出来（getTracks 里 BK 主线/
 *     备线1/备线2，getPlayinfo 支持 candidateIndex），主线 403
 *     时手动切备线；getPlayinfo 仍把全部候选地址按序返回。
 *  3. JSTV 版 auto 会对卫视先试 JCE 直播窗再回退 BK；JCE 需要
 *     gzip + 二进制 JCE 编解码，XPTV 里没有现成的纯 JS 实现，
 *     本版暂不含 JCE（也不含 7 天回看），是已知的待办，不是遗漏。
 *  4. v2.1.0 新增自动换源：点播前实测播放地址是否可用（用播放请求头拉一次
 *     m3u8，看正文是不是真正的播放列表）；首选地址不可用时自动换备线，
 *     Device 地址不可用时自动退回 BK；BK 解析失败重试一次。卫视“有时能播
 *     有时不能播”多半是首选地址当时不可用，v2.1.0 会自动换到可用的那条，
 *     不用手动切线路。
 *  5. v2.1.1：BK 候选地址全部不可用时，重新向上游要一份新地址（新签名）再试
 *     一次。JSTV 里清后台重开能修好，是因为它清掉了内存里的旧状态；XPTV 里
 *     清后台重开修不好，说明坏的是上游当时给的地址，不是本地状态——所以
 *     v2.1.1 改为重新解析一次，而不是只换备线。
 *  6. v2.2.0：把 JCE 也搬进来了（纯 JS 实现）。卫视与 JSTV 的根本区别就是
 *     JCE：JSTV 卫视先走 JCE、再退 BK，XPTV 之前只有 BK。JCE 的二进制编解码
 *     与 JSTV 版逐字相同；请求压缩用纯 JS stored-gzip，回包解压用纯 JS
 *     inflate（已用 Node zlib 往返验证 47/47）。auto 对有回看的台先试 JCE，
 *     失败冷却 5 分钟并退回 BK；也可手动选 [JCE] 线路。注意：JCE 请求体是
 *     二进制（Uint8Array），回包格式也依赖宿主 $fetch 的处理，真机验证前
 *     不能保证 $fetch 一定按二进制透传——若 JCE 在真机上失败，会自动退回 BK。
 *  7. v2.2.1：修 v2.2.0 引入的挂起——卫视全部一直转圈，是因为 JCE 的二进制
 *     POST 让宿主 $fetch 一直不回包，阻塞了 BK 回退。现给 JCE 请求加 6 秒超时，
 *     超时或失败时改用 latin-1 字符串体重试一次；都没有定时器的宿主只用
 *     字符串体（快速失败，不挂起）。JCE 再也不会无限挂起，失败即退回 BK。
 *  8. v2.2.2：卫视仍转圈，央视正常。两手准备：① 频道备注里临时加上版本号
 *     （v2.2.2），用来确认 XPTV 实际加载的是哪个版本（缓存旧版是常见原因）；
 *     ② 给所有 $fetch 请求（BK/Device 上游）也加 10 秒超时，防止上游不回包
 *     时整个解析挂起。确认版本后会去掉备注里的版本号。
 *  9. v2.2.3：清理版——已确认加载的是 v2.2.2，去掉频道备注里的临时版本号，
 *     其余逻辑与 v2.2.2 完全一致（BK/Device/JCE、超时、频道表均未动）。
 *  10. v2.2.3 诊断版：临时加编码诊断——点播后把那路流的 m3u8 的 CODECS
 *     和第一条分片的后缀（.ts 还是 .m4s）记下来，回频道列表时显示在备注里，
 *     用来确认 BK 与 Device 的编码格式是否一样。确认后应删掉这段诊断代码。
 *  11. v2.2.4：修诊断拿不到结果——原来诊断是 fire-and-forget，真机上
 *     getPlayinfo 返回后宿主不再跑挂起的异步任务，所以备注里什么都没有。
 *     现改成在 getPlayinfo 里 await 诊断跑完再返回（诊断自带 10 秒超时），
 *     并把临时版本号 v2.2.4 加回备注里，方便确认加载的是哪个版本。
 *
 *  路由（与 v1.0.0 相同）：
 *  - auto：有 Device ID 且不在 forceBK 的台优先 Device，失败回退 BK；
 *    其余台直接 BK。forceBK：cctv11/12/14/15/16/17 与三个剧场台。
 *  - Device LIVE_ID 仅 26 个：CCTV-1~17（缺 6）、CCTV-4K/8K/16-4K、
 *    CGTN 及其 5 个语种/纪录频道；卫视、CCTV-6、剧场台无 Device。
 *  - $config_str 可填 { "source": "auto"|"device"|"bk", "rate": "36p" }。
 *
 *  XPTV 订阅配置：
 *  {
 *    "name": "央视频|直播",
 *    "type": 3,
 *    "api": "csp_ysp",
 *    "ext": "https://raw.githubusercontent.com/freefly353/ysp-live-xptv/main/ysp-live-xptv.js"
 *  }
 *  或直接用仓库里的 subscription.json 当订阅地址。
 */

if (typeof argsify !== "function") {
    globalThis.argsify = function (str) {
        if (!str) return {};
        return typeof str === "string" ? JSON.parse(str) : str;
    };
}

if (typeof jsonify !== "function") {
    globalThis.jsonify = function (obj) {
        return typeof obj === "string" ? obj : JSON.stringify(obj);
    };
}

var YSPCore = (function () {
    "use strict";

    // =========================================================================
    // 一、纯 JS 字节与密码学工具（UTF-8 / Hex / Base64 / MD5 / SHA-1 / SHA-256 / AES-256-GCM / RSA-OAEP）
    // =========================================================================

    function utf8ToBytes(str) {
        const encoded = encodeURIComponent(String(str));
        const out = [];
        for (let i = 0; i < encoded.length; i++) {
            if (encoded[i] === "%") {
                out.push(parseInt(encoded.slice(i + 1, i + 3), 16));
                i += 2;
            } else {
                out.push(encoded.charCodeAt(i));
            }
        }
        return new Uint8Array(out);
    }

    function bytesToUtf8(bytes) {
        let pct = "";
        for (let i = 0; i < bytes.length; i++) {
            pct += "%" + (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
        }
        return decodeURIComponent(pct);
    }

    function hexToBytes(hex) {
        const clean = String(hex).replace(/\s+/g, "");
        if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) {
            throw new Error("Invalid hexadecimal bytes");
        }
        const out = new Uint8Array(clean.length >>> 1);
        for (let i = 0; i < out.length; i++) {
            out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    function bytesToHex(bytes) {
        let out = "";
        for (let i = 0; i < bytes.length; i++) {
            out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
        }
        return out;
    }

    const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function bytesToBase64(bytes) {
        let out = "";
        for (let i = 0; i < bytes.length; i += 3) {
            const a = bytes[i];
            const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
            const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
            out += B64_CHARS[a >>> 2];
            out += B64_CHARS[((a & 3) << 4) | (b === undefined ? 0 : b >>> 4)];
            out += b === undefined ? "=" : B64_CHARS[((b & 15) << 2) | (c === undefined ? 0 : c >>> 6)];
            out += c === undefined ? "=" : B64_CHARS[c & 63];
        }
        return out;
    }

    function base64ToBytes(b64) {
        const clean = String(b64).replace(/[^A-Za-z0-9+/=]/g, "");
        const out = [];
        for (let i = 0; i < clean.length; i += 4) {
            const c0 = B64_CHARS.indexOf(clean[i]);
            const c1 = B64_CHARS.indexOf(clean[i + 1]);
            const c2 = clean[i + 2] === "=" ? -1 : B64_CHARS.indexOf(clean[i + 2]);
            const c3 = clean[i + 3] === "=" ? -1 : B64_CHARS.indexOf(clean[i + 3]);
            if (c0 < 0 || c1 < 0) break;
            out.push((c0 << 2) | (c1 >>> 4));
            if (c2 >= 0) {
                out.push(((c1 & 15) << 4) | (c2 >>> 2));
                if (c3 >= 0) {
                    out.push(((c2 & 3) << 6) | c3);
                }
            }
        }
        return new Uint8Array(out);
    }

    function convertBytes(value, fromEnc, toEnc) {
        if (fromEnc === toEnc) return String(value);
        let bytes;
        if (fromEnc === "utf8") bytes = utf8ToBytes(value);
        else if (fromEnc === "hex") bytes = hexToBytes(value);
        else if (fromEnc === "base64") bytes = base64ToBytes(value);
        else throw new Error("Unsupported source encoding: " + fromEnc);

        if (toEnc === "utf8") return bytesToUtf8(bytes);
        if (toEnc === "hex") return bytesToHex(bytes);
        if (toEnc === "base64") return bytesToBase64(bytes);
        throw new Error("Unsupported target encoding: " + toEnc);
    }

    function randomBytesArray(count) {
        const out = new Uint8Array(count);
        if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
            crypto.getRandomValues(out);
            return out;
        }
        for (let i = 0; i < count; i++) {
            out[i] = Math.floor(Math.random() * 256) & 0xff;
        }
        return out;
    }

    function randomHex(count) {
        if (count <= 0) return "";
        return bytesToHex(randomBytesArray(count));
    }

    // ---- MD5 ----
    const MD5_S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const MD5_K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
        MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    }

    function md5Bytes(inputBytes) {
        const len = inputBytes.length;
        const bitLen = len * 8;
        const padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
        const buf = new Uint8Array(len + 1 + padLen + 8);
        buf.set(inputBytes);
        buf[len] = 0x80;
        const dv = new DataView(buf.buffer);
        dv.setUint32(buf.length - 8, bitLen >>> 0, true);
        dv.setUint32(buf.length - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

        let a0 = 0x67452301 >>> 0;
        let b0 = 0xefcdab89 >>> 0;
        let c0 = 0x98badcfe >>> 0;
        let d0 = 0x10325476 >>> 0;

        for (let offset = 0; offset < buf.length; offset += 64) {
            let A = a0, B = b0, C = c0, D = d0;
            for (let i = 0; i < 64; i++) {
                let F, g;
                if (i < 16) {
                    F = (B & C) | (~B & D);
                    g = i;
                } else if (i < 32) {
                    F = (D & B) | (~D & C);
                    g = (5 * i + 1) % 16;
                } else if (i < 48) {
                    F = B ^ C ^ D;
                    g = (3 * i + 5) % 16;
                } else {
                    F = C ^ (B | ~D);
                    g = (7 * i) % 16;
                }
                const M = dv.getUint32(offset + g * 4, true);
                F = (F + A + MD5_K[i] + M) >>> 0;
                A = D;
                D = C;
                C = B;
                const rot = ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i]))) >>> 0;
                B = (B + rot) >>> 0;
            }
            a0 = (a0 + A) >>> 0;
            b0 = (b0 + B) >>> 0;
            c0 = (c0 + C) >>> 0;
            d0 = (d0 + D) >>> 0;
        }

        const out = new Uint8Array(16);
        const outDv = new DataView(out.buffer);
        outDv.setUint32(0, a0, true);
        outDv.setUint32(4, b0, true);
        outDv.setUint32(8, c0, true);
        outDv.setUint32(12, d0, true);
        return out;
    }

    // ---- SHA-1 ----
    function sha1Bytes(inputBytes) {
        const len = inputBytes.length;
        const bitLen = len * 8;
        const padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
        const buf = new Uint8Array(len + 1 + padLen + 8);
        buf.set(inputBytes);
        buf[len] = 0x80;
        const dv = new DataView(buf.buffer);
        dv.setUint32(buf.length - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
        dv.setUint32(buf.length - 4, bitLen >>> 0, false);

        let h0 = 0x67452301 >>> 0;
        let h1 = 0xefcdab89 >>> 0;
        let h2 = 0x98badcfe >>> 0;
        let h3 = 0x10325476 >>> 0;
        let h4 = 0xc3d2e1f0 >>> 0;
        const W = new Uint32Array(80);

        for (let offset = 0; offset < buf.length; offset += 64) {
            for (let i = 0; i < 16; i++) W[i] = dv.getUint32(offset + i * 4, false);
            for (let i = 16; i < 80; i++) {
                const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16];
                W[i] = ((x << 1) | (x >>> 31)) >>> 0;
            }
            let a = h0, b = h1, c = h2, d = h3, e = h4;
            for (let i = 0; i < 80; i++) {
                let f, k;
                if (i < 20) {
                    f = (b & c) | (~b & d);
                    k = 0x5a827999;
                } else if (i < 40) {
                    f = b ^ c ^ d;
                    k = 0x6ed9eba1;
                } else if (i < 60) {
                    f = (b & c) | (b & d) | (c & d);
                    k = 0x8f1bbcdc;
                } else {
                    f = b ^ c ^ d;
                    k = 0xca62c1d6;
                }
                const temp = ((((a << 5) | (a >>> 27)) >>> 0) + (f >>> 0) + e + k + W[i]) >>> 0;
                e = d;
                d = c;
                c = ((b << 30) | (b >>> 2)) >>> 0;
                b = a;
                a = temp;
            }
            h0 = (h0 + a) >>> 0;
            h1 = (h1 + b) >>> 0;
            h2 = (h2 + c) >>> 0;
            h3 = (h3 + d) >>> 0;
            h4 = (h4 + e) >>> 0;
        }

        const out = new Uint8Array(20);
        const outDv = new DataView(out.buffer);
        outDv.setUint32(0, h0, false);
        outDv.setUint32(4, h1, false);
        outDv.setUint32(8, h2, false);
        outDv.setUint32(12, h3, false);
        outDv.setUint32(16, h4, false);
        return out;
    }

    // ---- SHA-256 ----
    const SHA256_K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);

    function rotr(x, n) {
        return ((x >>> n) | (x << (32 - n))) >>> 0;
    }

    function sha256Bytes(inputBytes) {
        const len = inputBytes.length;
        const bitLen = len * 8;
        const padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
        const buf = new Uint8Array(len + 1 + padLen + 8);
        buf.set(inputBytes);
        buf[len] = 0x80;
        const dv = new DataView(buf.buffer);
        dv.setUint32(buf.length - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);
        dv.setUint32(buf.length - 4, bitLen >>> 0, false);

        let H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a;
        let H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19;
        const W = new Uint32Array(64);

        for (let offset = 0; offset < buf.length; offset += 64) {
            for (let i = 0; i < 16; i++) W[i] = dv.getUint32(offset + i * 4, false);
            for (let i = 16; i < 64; i++) {
                const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
                const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
                W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
            }
            let a = H0, b = H1, c = H2, d = H3, e = H4, f = H5, g = H6, h = H7;
            for (let i = 0; i < 64; i++) {
                const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                const ch = ((e & f) ^ (~e & g)) >>> 0;
                const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
                const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
                const temp2 = (S0 + maj) >>> 0;
                h = g; g = f; f = e;
                e = (d + temp1) >>> 0;
                d = c; c = b; b = a;
                a = (temp1 + temp2) >>> 0;
            }
            H0 = (H0 + a) >>> 0; H1 = (H1 + b) >>> 0; H2 = (H2 + c) >>> 0; H3 = (H3 + d) >>> 0;
            H4 = (H4 + e) >>> 0; H5 = (H5 + f) >>> 0; H6 = (H6 + g) >>> 0; H7 = (H7 + h) >>> 0;
        }

        const out = new Uint8Array(32);
        const outDv = new DataView(out.buffer);
        outDv.setUint32(0, H0, false); outDv.setUint32(4, H1, false);
        outDv.setUint32(8, H2, false); outDv.setUint32(12, H3, false);
        outDv.setUint32(16, H4, false); outDv.setUint32(20, H5, false);
        outDv.setUint32(24, H6, false); outDv.setUint32(28, H7, false);
        return out;
    }

    function digestHex(algo, textStr) {
        const bytes = utf8ToBytes(textStr);
        const norm = String(algo).toLowerCase().replace("-", "");
        if (norm === "md5") return bytesToHex(md5Bytes(bytes));
        if (norm === "sha1") return bytesToHex(sha1Bytes(bytes));
        if (norm === "sha256") return bytesToHex(sha256Bytes(bytes));
        throw new Error("Unsupported digest algorithm: " + algo);
    }

    // ---- AES-256-GCM ----
    const AES_SBOX = new Uint8Array(256);
    const AES_RCON = new Uint8Array(15);
    (function initAesTables() {
        const p = new Uint8Array(256);
        const q = new Uint8Array(256);
        let x = 1;
        for (let i = 0; i < 255; i++) {
            p[i] = x;
            q[x] = i;
            x = (x ^ ((x << 1) ^ (x & 0x80 ? 0x1b : 0))) & 0xff;
        }
        AES_SBOX[0] = 0x63;
        for (let i = 1; i < 256; i++) {
            const y = p[(255 - q[i]) % 255];
            let s = y;
            for (let r = 1; r <= 4; r++) {
                s ^= ((y << r) | (y >>> (8 - r))) & 0xff;
            }
            AES_SBOX[i] = (s ^ 0x63) & 0xff;
        }
        let rc = 1;
        for (let i = 1; i < 15; i++) {
            AES_RCON[i] = rc;
            rc = ((rc << 1) ^ (rc & 0x80 ? 0x1b : 0)) & 0xff;
        }
    })();

    function xtime(a) {
        return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
    }

    function aes256KeySchedule(key) {
        const rk = new Uint8Array(240);
        rk.set(key.subarray(0, 32));
        const temp = new Uint8Array(4);
        for (let i = 8; i < 60; i++) {
            const prev = (i - 1) * 4;
            temp[0] = rk[prev]; temp[1] = rk[prev + 1]; temp[2] = rk[prev + 2]; temp[3] = rk[prev + 3];
            if (i % 8 === 0) {
                const t = temp[0];
                temp[0] = AES_SBOX[temp[1]] ^ AES_RCON[i / 8];
                temp[1] = AES_SBOX[temp[2]];
                temp[2] = AES_SBOX[temp[3]];
                temp[3] = AES_SBOX[t];
            } else if (i % 8 === 4) {
                temp[0] = AES_SBOX[temp[0]];
                temp[1] = AES_SBOX[temp[1]];
                temp[2] = AES_SBOX[temp[2]];
                temp[3] = AES_SBOX[temp[3]];
            }
            const cur = i * 4;
            const back = (i - 8) * 4;
            rk[cur] = rk[back] ^ temp[0];
            rk[cur + 1] = rk[back + 1] ^ temp[1];
            rk[cur + 2] = rk[back + 2] ^ temp[2];
            rk[cur + 3] = rk[back + 3] ^ temp[3];
        }
        return rk;
    }

    function aes256EncryptBlock(block, rk) {
        const s = new Uint8Array(16);
        for (let i = 0; i < 16; i++) s[i] = block[i] ^ rk[i];
        for (let round = 1; round <= 14; round++) {
            for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]];
            let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
            t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
            t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
            if (round < 14) {
                for (let c = 0; c < 16; c += 4) {
                    const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
                    const h = a0 ^ a1 ^ a2 ^ a3;
                    s[c] ^= h ^ xtime(a0 ^ a1);
                    s[c + 1] ^= h ^ xtime(a1 ^ a2);
                    s[c + 2] ^= h ^ xtime(a2 ^ a3);
                    s[c + 3] ^= h ^ xtime(a3 ^ a0);
                }
            }
            const ro = round * 16;
            for (let i = 0; i < 16; i++) s[i] ^= rk[ro + i];
        }
        return s;
    }

    function gfMult(x, y) {
        const z = new Uint8Array(16);
        const v = new Uint8Array(y);
        for (let i = 0; i < 16; i++) {
            const xi = x[i];
            for (let bit = 7; bit >= 0; bit--) {
                if ((xi >>> bit) & 1) {
                    for (let j = 0; j < 16; j++) z[j] ^= v[j];
                }
                const lsb = v[15] & 1;
                for (let j = 15; j > 0; j--) {
                    v[j] = (v[j] >>> 1) | ((v[j - 1] & 1) << 7);
                }
                v[0] >>>= 1;
                if (lsb) v[0] ^= 0xe1;
            }
        }
        return z;
    }

    function ghash(H, ciphertext) {
        let Y = new Uint8Array(16);
        const block = new Uint8Array(16);
        for (let offset = 0; offset < ciphertext.length; offset += 16) {
            block.fill(0);
            const slice = ciphertext.subarray(offset, Math.min(offset + 16, ciphertext.length));
            block.set(slice);
            for (let i = 0; i < 16; i++) Y[i] ^= block[i];
            Y = gfMult(Y, H);
        }
        block.fill(0);
        const bitLen = ciphertext.length * 8;
        const dv = new DataView(block.buffer);
        dv.setUint32(8, Math.floor(bitLen / 0x100000000) >>> 0, false);
        dv.setUint32(12, bitLen >>> 0, false);
        for (let i = 0; i < 16; i++) Y[i] ^= block[i];
        return gfMult(Y, H);
    }

    function inc32(counter) {
        const next = new Uint8Array(counter);
        const dv = new DataView(next.buffer);
        dv.setUint32(12, (dv.getUint32(12, false) + 1) >>> 0, false);
        return next;
    }

    function gctr(rk, icb, input) {
        const out = new Uint8Array(input.length);
        let cb = new Uint8Array(icb);
        for (let offset = 0; offset < input.length; offset += 16) {
            const keystream = aes256EncryptBlock(cb, rk);
            const end = Math.min(offset + 16, input.length);
            for (let i = offset; i < end; i++) {
                out[i] = input[i] ^ keystream[i - offset];
            }
            cb = inc32(cb);
        }
        return out;
    }

    function aes256GcmSeal(key32, plaintext, nonce12) {
        const rk = aes256KeySchedule(key32);
        const H = aes256EncryptBlock(new Uint8Array(16), rk);
        const j0 = new Uint8Array(16);
        j0.set(nonce12.subarray(0, 12), 0);
        j0[15] = 1;
        const ciphertext = gctr(rk, inc32(j0), plaintext);
        const S = ghash(H, ciphertext);
        const tag = gctr(rk, j0, S);
        const combined = new Uint8Array(12 + ciphertext.length + 16);
        combined.set(nonce12.subarray(0, 12), 0);
        combined.set(ciphertext, 12);
        combined.set(tag, 12 + ciphertext.length);
        return combined;
    }

    function aes256GcmOpen(key32, combined) {
        if (combined.length < 28) throw new Error("AES-GCM input too short");
        const nonce12 = combined.subarray(0, 12);
        const ciphertext = combined.subarray(12, combined.length - 16);
        const tag = combined.subarray(combined.length - 16);
        const rk = aes256KeySchedule(key32);
        const H = aes256EncryptBlock(new Uint8Array(16), rk);
        const j0 = new Uint8Array(16);
        j0.set(nonce12, 0);
        j0[15] = 1;
        const S = ghash(H, ciphertext);
        const expectedTag = gctr(rk, j0, S);
        let diff = 0;
        for (let i = 0; i < 16; i++) diff |= tag[i] ^ expectedTag[i];
        if (diff !== 0) throw new Error("AES-GCM authentication failed");
        return gctr(rk, inc32(j0), ciphertext);
    }

    // ---- RSA-OAEP-SHA256 (2048-bit) ----
    const RSA_MODULUS_HEX =
        "90a78bcb8cb058b4a7064c11caa6201771cc223d39579bae8791e3c84b193969eed4d1eede33d0bf7b2bdf6c3040d62fe6a6a9b0d5e63602d40c7b601d9c6a3d00185e5b63491734aa1703dbceadeb6c0e20721df335d2decd49cb8ae0538aa3416cc8f6ba7fd6c134a4cb26c136896b8cee2798b3f15c05f00bf9a09d64f87c58fbf1cb9e33655b586658ba6e0d89a4658b80a131dad5519e1d087d144288f1970bdc64d0a614a15280be2a0dcfd61194553b4261aa66ccf4b996401dc1e6eecf0bd309f1a24c4ad86429cf05449e57b0559608ed2d8222dbd2af1746bc147b0931f7bf51d1dcc96fd18a1b0860eb4341c451a45197c8f5db56bcc526c7b6e1";

    function mgf1Sha256(seed, maskLen) {
        const out = new Uint8Array(maskLen);
        let offset = 0;
        let counter = 0;
        const buf = new Uint8Array(seed.length + 4);
        buf.set(seed, 0);
        const dv = new DataView(buf.buffer);
        while (offset < maskLen) {
            dv.setUint32(seed.length, counter++, false);
            const digest = sha256Bytes(buf);
            const take = Math.min(32, maskLen - offset);
            out.set(digest.subarray(0, take), offset);
            offset += take;
        }
        return out;
    }

    function modPow(base, exp, mod) {
        let result = 1n;
        let b = base % mod;
        let e = exp;
        while (e > 0n) {
            if (e & 1n) result = (result * b) % mod;
            e >>= 1n;
            b = (b * b) % mod;
        }
        return result;
    }

    function rsaOaepSha256Encrypt(msgBytes, random32Bytes) {
        const k = 256;
        const hLen = 32;
        if (msgBytes.length > k - 2 * hLen - 2) throw new Error("Message too long for RSA-OAEP");
        const lHash = sha256Bytes(new Uint8Array(0));
        const db = new Uint8Array(k - hLen - 1);
        db.set(lHash, 0);
        db[db.length - msgBytes.length - 1] = 0x01;
        db.set(msgBytes, db.length - msgBytes.length);

        const dbMask = mgf1Sha256(random32Bytes, k - hLen - 1);
        const maskedDB = new Uint8Array(k - hLen - 1);
        for (let i = 0; i < maskedDB.length; i++) maskedDB[i] = db[i] ^ dbMask[i];

        const seedMask = mgf1Sha256(maskedDB, hLen);
        const maskedSeed = new Uint8Array(hLen);
        for (let i = 0; i < hLen; i++) maskedSeed[i] = random32Bytes[i] ^ seedMask[i];

        const em = new Uint8Array(k);
        em[0] = 0x00;
        em.set(maskedSeed, 1);
        em.set(maskedDB, 1 + hLen);

        const m = BigInt("0x" + bytesToHex(em));
        const n = BigInt("0x" + RSA_MODULUS_HEX);
        const c = modPow(m, 65537n, n);
        return hexToBytes(c.toString(16).padStart(k * 2, "0"));
    }

    // =========================================================================
    // 二、XPTV 宿主桥接层 ($fetch / $cache / sleep / log)
    // =========================================================================

    function sleep(ms) {
        if (!ms || ms <= 0) return Promise.resolve();
        if (typeof setTimeout === "function") {
            return new Promise(function (resolve) {
                setTimeout(resolve, ms);
            });
        }
        const deadline = Date.now() + Math.min(ms, 800);
        while (Date.now() < deadline) {}
        return Promise.resolve();
    }

    // 给一个 Promise 加超时（宿主提供 setTimeout 时才有效；没有定时器时原样返回）。
    // 用于 JCE 的二进制 POST：宿主 $fetch 若处理不了 Uint8Array 可能一直不回包，
    // 超时能把它变成一次失败并触发 BK 回退，而不是让播放器一直转圈。
    function withTimeout(promise, ms, message) {
        if (typeof setTimeout !== "function" || typeof clearTimeout !== "function") return promise;
        let timer = null;
        const timeout = new Promise(function (_, reject) {
            timer = setTimeout(function () {
                reject(new Error(message || "timeout"));
            }, ms);
        });
        return Promise.race([promise, timeout]).then(
            function (v) {
                if (timer) clearTimeout(timer);
                return v;
            },
            function (e) {
                if (timer) clearTimeout(timer);
                throw e;
            }
        );
    }

    function safeLog(message) {
        try {
            if (typeof $print === "function") $print("[YSP] " + message);
            else if (typeof console !== "undefined" && typeof console.log === "function") {
                console.log("[YSP] " + message);
            }
        } catch (_) {}
    }

    function storageGet(key) {
        try {
            if (typeof $cache === "undefined" || typeof $cache.get !== "function") return null;
            const raw = $cache.get("ysp_live_" + key);
            if (raw === undefined || raw === null || raw === "") return null;
            if (typeof raw !== "string") return raw;
            try {
                return JSON.parse(raw);
            } catch (_) {
                return raw; // plain string (e.g. diagnostic text, JCE guid), not JSON
            }
        } catch (_) {
            return null;
        }
    }

    function storageSet(key, value) {
        try {
            if (typeof $cache === "undefined" || typeof $cache.set !== "function") return;
            $cache.set("ysp_live_" + key, typeof value === "string" ? value : JSON.stringify(value));
        } catch (_) {}
    }

    async function xptvHttpRequest(req) {
        const method = String(req.method || "GET").toUpperCase();
        const reqHeaders = req.headers || {};
        let res;
        if (typeof $fetch !== "undefined") {
            if (method === "POST" && typeof $fetch.post === "function") {
                res = await withTimeout(
                    $fetch.post(req.url, req.body || "", { headers: reqHeaders }),
                    10000,
                    "HTTP request timeout"
                );
            } else if (typeof $fetch.get === "function") {
                res = await withTimeout(
                    $fetch.get(req.url, { headers: reqHeaders }),
                    10000,
                    "HTTP request timeout"
                );
            } else {
                throw new Error("$fetch method unavailable");
            }
        } else if (typeof fetch === "function") {
            const fRes = await fetch(req.url, {
                method: method,
                headers: reqHeaders,
                body: method === "POST" ? req.body : undefined,
            });
            const textBody = await fRes.text();
            return {
                ok: fRes.ok,
                status: fRes.status,
                body: textBody,
            };
        } else {
            throw new Error("当前运行环境未提供 $fetch 或 fetch 网络接口");
        }

        if (!res) throw new Error("空网络响应");
        const rawData = res.data !== undefined ? res.data : res.body;
        const bodyStr =
            typeof rawData === "string"
                ? rawData
                : rawData !== undefined && rawData !== null
                  ? JSON.stringify(rawData)
                  : "";
        const status =
            typeof res.status === "number"
                ? res.status
                : typeof res.statusCode === "number"
                  ? res.statusCode
                  : bodyStr
                    ? 200
                    : 502;
        return {
            ok: status >= 200 && status < 300,
            status: status,
            body: bodyStr,
            error: res.error || "",
        };
    }

    // 模拟 NanoTV host 接口供内部协议模块调用
    const hostAdapter = {
        now: function () {
            return Date.now();
        },
        randomHex: randomHex,
        log: safeLog,
        storage: {
            get: storageGet,
            set: storageSet,
        },
        scheduler: {
            sleep: sleep,
            every: function () {},
        },
        bytes: {
            convert: convertBytes,
        },
        crypto: {
            digest: digestHex,
            open: function (opts) {
                const key32 = base64ToBytes(opts.key);
                const combined = base64ToBytes(opts.data);
                const plain = aes256GcmOpen(key32, combined);
                return bytesToBase64(plain);
            },
            seal: function (opts) {
                const key32 = base64ToBytes(opts.key);
                const plain = base64ToBytes(opts.data);
                const nonce12 = randomBytesArray(12);
                const combined = aes256GcmSeal(key32, plain, nonce12);
                return bytesToBase64(combined);
            },
            rsaEncrypt: function (opts) {
                const msgBytes = base64ToBytes(opts.data);
                const seed32 = randomBytesArray(32);
                const cipherBytes = rsaOaepSha256Encrypt(msgBytes, seed32);
                return bytesToBase64(cipherBytes);
            },
        },
        http: {
            request: xptvHttpRequest,
            // 二进制 POST（JCE 用）：body 可为 Uint8Array；返回的 data 原样透传
            // （Uint8Array / ArrayBuffer / 字符串，调用方自行转字节）。
            requestBinary: async function (req) {
                if (typeof $fetch !== "undefined" && typeof $fetch.post === "function") {
                    const res = await $fetch.post(req.url, req.body, { headers: req.headers || {} });
                    const status =
                        typeof res.status === "number"
                            ? res.status
                            : res.data !== undefined || res.body !== undefined
                              ? 200
                              : 502;
                    return {
                        ok: status >= 200 && status < 300,
                        status: status,
                        data: res.data !== undefined ? res.data : res.body,
                    };
                }
                throw new Error("当前运行环境未提供 $fetch.post");
            },
        },
    };

    // =========================================================================
    // 三、BK 协议模块 (createBKProtocol) —— TEA / cKey 签名与主备直播源解析
    // =========================================================================

    function createBKProtocol(h) {
        const PLATFORM = 4330403;
        const APP_VERSION = "V8.22.1035.3031";
        const TEA_KEY = Array.from(hexToBytes("59b2f7cf725ef43c34fdd7c123411ed3"));
        const GUARD_KEY = Array.from(hexToBytes("110dbec10c23e7d2e56a1cad6914ef1b"));
        const KEY_XOR = [132, 46, 237, 8, 240, 102, 230, 234, 72, 180, 202, 169, 145, 237, 111, 243];
        const GUARD_XOR = [179, 201, 83, 160, 105, 19, 173, 77];
        const PLAYBACK_HEADERS = { "User-Agent": "qqlive", "Referer": "https://live.cctv.cn/" };

        function fromHexArr(hex) {
            return Array.from(hexToBytes(hex));
        }
        function toHexArr(bytes) {
            return bytesToHex(new Uint8Array(bytes));
        }
        function utf8Arr(value) {
            return Array.from(utf8ToBytes(value));
        }
        function u32(value) {
            return value >>> 0;
        }
        function uint32(bytes, offset) {
            return u32((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
        }
        function be32(value) {
            value = u32(value);
            return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
        }
        function lp(value) {
            const bytes = typeof value === "string" ? utf8Arr(value) : value;
            if (bytes.length > 65535) throw new Error("Signature field too long");
            return [bytes.length >>> 8, bytes.length & 255].concat(bytes);
        }
        function checksum(bytes) {
            let value = 0;
            for (let i = 0; i < bytes.length; i++) value = (131 * value + bytes[i]) & 0x7fffffff;
            return value;
        }
        function teaBlock(block, key) {
            if (block.length !== 8 || key.length !== 16) throw new Error("Invalid TEA block/key size");
            let y = uint32(block, 0),
                z = uint32(block, 4),
                sum = 0;
            const k = [uint32(key, 0), uint32(key, 4), uint32(key, 8), uint32(key, 12)];
            for (let round = 0; round < 16; round++) {
                sum = u32(sum + 0x9e3779b9);
                y = u32(y + u32(u32(u32(z << 4) + k[0]) ^ u32(z + sum) ^ u32((z >>> 5) + k[1])));
                z = u32(z + u32(u32(u32(y << 4) + k[2]) ^ u32(y + sum) ^ u32((y >>> 5) + k[3])));
            }
            return be32(y).concat(be32(z));
        }
        function xorBytes(a, b) {
            return a.map(function (byte, i) {
                return byte ^ b[i];
            });
        }
        function teaPacket(data, key, randBytesFn) {
            const pad = (8 - ((data.length + 10) % 8)) % 8;
            const plain = [(randBytesFn(1)[0] & 248) | pad].concat(
                randBytesFn(pad),
                randBytesFn(2),
                data,
                [0, 0, 0, 0, 0, 0, 0]
            );
            let output = [],
                previousPlain = [0, 0, 0, 0, 0, 0, 0, 0],
                previousCipher = previousPlain.slice();
            for (let offset = 0; offset < plain.length; offset += 8) {
                const mixed = xorBytes(plain.slice(offset, offset + 8), previousCipher);
                const cipher = xorBytes(teaBlock(mixed, key), previousPlain);
                output = output.concat(cipher);
                previousPlain = mixed;
                previousCipher = cipher;
            }
            return output;
        }
        function base64Arr(bytes) {
            return bytesToBase64(new Uint8Array(bytes));
        }
        function guard(timestamp, guid, randBytesFn) {
            function tail(value) {
                return value.length >= 5 ? value.slice(-5) : "";
            }
            const body = be32(timestamp).concat(lp(tail(guid)), lp(tail("null")), lp(tail("null")), lp("-1"));
            const plain = lp(body);
            const encrypted = teaPacket(plain, GUARD_KEY, randBytesFn).concat(be32(checksum(plain)));
            return toHexArr(
                encrypted.map(function (byte, i) {
                    return byte ^ GUARD_XOR[i & 7];
                })
            ).toUpperCase();
        }
        function createCKey(channelID, timestamp, randBytesFn) {
            const guid = toHexArr(randBytesFn(16));
            const signatureGuard = guard(timestamp, guid, randBytesFn);
            const uid = toHexArr(randBytesFn(4)).toUpperCase();
            const body = fromHexArr("0000004200000004000004d2").concat(
                be32(PLATFORM),
                be32(0),
                be32(timestamp),
                lp("dcgh"),
                lp("_zj1A5Gh6QYcxWjIUGos2w=="),
                lp(APP_VERSION),
                lp(String(channelID)),
                lp(guid),
                be32(1),
                be32(1),
                lp(uid),
                lp("nil"),
                lp("57eab0c4-2c58-44c6-8ae9-dd2757525dc5"),
                lp("nil"),
                lp("v0.1.000"),
                lp("com.cctv.yangshipin.app.iphone"),
                lp(String(PLATFORM)),
                lp("ex_json_bus"),
                lp("ex_json_vs"),
                lp(signatureGuard)
            );
            const packet = lp(body);
            const packetChecksum = be32(checksum(packet));
            for (let i = 0; i < 4; i++) packet[18 + i] = packetChecksum[i];
            let encrypted = teaPacket(packet, TEA_KEY, randBytesFn).concat(be32(checksum(packet)));
            encrypted = encrypted.map(function (byte, index) {
                return byte ^ KEY_XOR[index & 15];
            });
            const uuid = randBytesFn(16);
            uuid[6] = (uuid[6] & 15) | 64;
            uuid[8] = (uuid[8] & 63) | 128;
            return {
                cKey: "--01" + base64Arr(encrypted).replace(/\+/g, "_").replace(/\//g, "-").replace(/=+$/, ""),
                guid: guid,
                ts: timestamp,
                flowId: toHexArr(uuid).toUpperCase() + "_" + PLATFORM,
            };
        }
        function randomBytesForBK(count) {
            if (count === 0) return [];
            return fromHexArr(h.randomHex(count));
        }
        function formEncode(value) {
            return encodeURIComponent(String(value))
                .replace(/[!'()*]/g, function (char) {
                    return "%" + char.charCodeAt(0).toString(16).toUpperCase();
                })
                .replace(/%20/g, "+");
        }
        function queryString(values) {
            return Object.keys(values)
                .map(function (key) {
                    return formEncode(key) + "=" + formEncode(values[key]);
                })
                .join("&");
        }
        function upstreamRequest(channel) {
            const key = createCKey(channel.channelID, Math.floor(h.now() / 1000), randomBytesForBK);
            const values = {
                atime: "120",
                livepid: channel.livePID,
                cnlid: channel.channelID,
                appVer: APP_VERSION,
                app_version: "300090",
                caplv: "1",
                cmd: "2",
                defn: channel.definition,
                device: "iPhone",
                encryptVer: "4.2",
                getpreviewinfo: "0",
                hevclv: "0",
                lang: "zh-Hans_CN",
                livequeue: "0",
                logintype: "1",
                nettype: "1",
                newnettype: "1",
                newplatform: String(PLATFORM),
                platform: String(PLATFORM),
                sdtfrom: "v3021",
                spacode: "23",
                spaudio: "1",
                spdemuxer: "6",
                spdrm: "2",
                spdynamicrange: "1",
                spflv: "1",
                spflvaudio: "1",
                sphdrfps: "60",
                sphttps: "1",
                spvcode: base64Arr(utf8Arr("H(30:1080,60:1080|30:1080,60:1080)")),
                spvideo: "4",
                stream: "1",
                system: "1",
                sysver: "ios18.2.1",
                uhd_flag: "0",
                cKey: key.cKey,
                guid: key.guid,
                fntick: String(key.ts),
                flowid: key.flowId,
                playbacktime: "0",
            };
            return {
                url: "https://bkliveinfo.ysp.cctv.cn/?" + queryString(values),
                method: "GET",
                headers: { "User-Agent": "qqlive", "Accept": "application/json" },
                timeoutSeconds: 15,
            };
        }
        function playbackHost(url) {
            if (typeof url !== "string" || /[\s\u0000-\u001f\u007f\\]/.test(url)) return null;
            const match = /^(https?):\/\/([^\/?#]+)(?:[\/?#]|$)/i.exec(url);
            if (!match || match[2].indexOf("@") !== -1 || match[2].indexOf("%") !== -1) return null;
            const authority = match[2].toLowerCase();
            const parts = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(authority);
            if (!parts || (parts[2] && (Number(parts[2]) < 1 || Number(parts[2]) > 65535))) return null;
            const host = parts[1];
            const suffixes = ["cctv.cn", "cctv.com", "cctvpic.com", "citvc.com", "yangshipin.cn", "cntv.cn", "cntv.com"];
            return suffixes.some(function (suffix) {
                return host === suffix || host.slice(-(suffix.length + 1)) === "." + suffix;
            })
                ? host
                : null;
        }
        function isAllowedPlaybackURL(url) {
            return playbackHost(url) !== null;
        }
        function collectCandidates(payload) {
            let all = [];
            if (typeof payload.playurl === "string") all.push(payload.playurl);
            const backup = payload.backurl_list || payload.backurlList || payload.backurl;
            if (Array.isArray(backup)) {
                backup.forEach(function (item) {
                    if (typeof item === "string") all.push(item);
                    else if (item && typeof item === "object") all.push(item.url || item.playurl || "");
                });
            } else if (typeof backup === "string") {
                all = all.concat(backup.split(/[;,]\s*(?=https?:\/\/)/i));
            }
            const unique = [];
            all.forEach(function (candidate) {
                if (isAllowedPlaybackURL(candidate) && unique.indexOf(candidate) < 0) unique.push(candidate);
            });
            return unique.sort(function (a, b) {
                const scoreA = playbackHost(a).indexOf("bklive-") >= 0 ? 0 : 1;
                const scoreB = playbackHost(b).indexOf("bklive-") >= 0 ? 0 : 1;
                return scoreA - scoreB || (a < b ? -1 : a > b ? 1 : 0);
            });
        }

        async function resolveChannel(channel) {
            try {
                const response = await h.http.request(upstreamRequest(channel));
                if (response.status < 200 || response.status > 299) {
                    throw new Error("源站 HTTP " + response.status);
                }
                let payload;
                try {
                    payload = typeof response.body === "string" ? JSON.parse(response.body) : response.body;
                } catch (_) {
                    throw new Error("源站未返回有效 JSON");
                }
                if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                    throw new Error("源站响应结构不正确");
                }
                if (Number(payload.iretcode) !== 0 || payload.iretcode === "" || payload.iretcode === undefined) {
                    throw new Error("源站拒绝解析 (iretcode=" + payload.iretcode + ")");
                }
                const candidates = collectCandidates(payload);
                if (!candidates.length) {
                    throw new Error("源站未返回有效播放地址");
                }
                return {
                    ok: true,
                    url: candidates[0],
                    candidates: candidates,
                    headers: PLAYBACK_HEADERS,
                    source: "BK live",
                    quality: channel.quality,
                };
            } catch (err) {
                return {
                    ok: false,
                    url: null,
                    candidates: [],
                    headers: {},
                    source: "BK live",
                    error: String(err && err.message ? err.message : err),
                };
            }
        }

        return {
            resolve: resolveChannel,
            testing: {
                createCKey: createCKey,
                teaBlock: teaBlock,
                collectCandidates: collectCandidates,
            },
        };
    }

    // =========================================================================
    // 四、Device 协议模块 (createDeviceProtocol) —— 央视频电视投屏助手超清源
    // =========================================================================

    function createDeviceProtocol(h) {
        const AK = "9f5c54c4ed0e50109b800f7e28fec205";
        const PUBLIC_KEY =
            "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkKeLy4ywWLSnBkwRyqYgF3HMIj05V5uuh5HjyEsZOWnu1NHu3jPQv3sr32wwQNYv5qapsNXmNgLUDHtgHZxqPQAYXltjSRc0qhcD286t62wOIHId8zXS3s1Jy4rgU4qjQWzI9rp/1sE0pMsmwTaJa4zuJ5iz8VwF8Av5oJ1k+HxY+/HLnjNlW1hmWLpuDYmkZYuAoTHa1VGeHQh9FEKI8ZcL3GTQphShUoC+Kg3P1hGUVTtCYapmzPS5lkAdwebuzwvTCfGiTErYZCnPBUSeV7BVlgjtLYIi29KvF0a8FHsJMfe/UdHcyW/RihsIYOtDQcRRpFGXyPXbVrzFJse24QIDAQAB";
        const LIVE_IDS = {
            "cctv1": "Live1717729995180256",
            "cctv2": "Live1718261577870260",
            "cctv3": "Live1718261955077261",
            "cctv4": "Live1718276148119264",
            "cctv5": "Live1719474204987287",
            "cctv5p": "Live1719473996025286",
            "cctv7": "Live1718276412224269",
            "cctv8": "Live1718276458899270",
            "cctv9": "Live1718276503187272",
            "cctv10": "Live1718276550002273",
            "cctv11": "Live1718276603690275",
            "cctv12": "Live1718276623932276",
            "cctv13": "Live1718276575708274",
            "cctv14": "Live1718276498748271",
            "cctv15": "Live1718276319614267",
            "cctv16": "Live1718276256572265",
            "cctv17": "Live1718276138318263",
            "cctv4k": "Live1767871224782105",
            "cctv8k": "Live1688400593818102",
            "cctv164k": "Live1704966749996185",
            "cgtn": "Live1719392219423280",
            "cgtnfr": "Live1719392670442283",
            "cgtnru": "Live1719392779653284",
            "cgtnar": "Live1719392885692285",
            "cgtnes": "Live1719392560433282",
            "cgtndoc": "Live1719392360336281",
        };
        const DEFAULT_TEMPLATE = {
            "source": "sony_8k_pool.XR-85Z9K",
            "brand": "Sony",
            "manufacturer": "Sony",
            "model": "XR-85Z9K",
            "report_model": "XR85Z9K",
            "hardware": "mt5895",
            "board": "mt5895",
            "version_id": "SONYTV.2022.XR_85Z9K",
            "screen_param": "7680-4320-280",
            "cast_model": "XR-85Z9K",
        };
        const BASE = "https://ytpaddr.cctv.cn/gsnw/";

        let identity = null;
        let session = null;
        let lastControl = 0;
        let blockedUntil = 0;

        function fail(stage, message, code, status) {
            const e = new Error(message);
            e.stage = stage;
            e.code = code;
            if (status) e.status = status;
            return e;
        }

        function stable(value, slash) {
            function sort(v) {
                if (Array.isArray(v)) return v.map(sort);
                if (v && typeof v === "object") {
                    const o = {};
                    Object.keys(v)
                        .sort()
                        .forEach(function (k) {
                            o[k] = sort(v[k]);
                        });
                    return o;
                }
                return v;
            }
            const text = JSON.stringify(sort(value));
            return slash ? text.replace(/\//g, "\\/") : text;
        }

        function hashcode(value) {
            let hc = 0;
            for (const c of value) hc = (Math.imul(hc, 31) + c.codePointAt(0)) | 0;
            return hc;
        }

        function signedHex32(value) {
            return (value < 0 ? "ffffffff" : "00000000") + (value >>> 0).toString(16).padStart(8, "0");
        }

        function uid(p) {
            const b =
                "1698" +
                [
                    "hardware",
                    "board",
                    "brand",
                    "device",
                    "manufacturer",
                    "model",
                    "product",
                    "tags",
                    "build_type",
                    "user",
                    "resolution",
                    "mac",
                ]
                    .map(function (k) {
                        return p[k];
                    })
                    .join("");
            return h.crypto
                .digest("sha1", p.android_id + "|" + signedHex32(hashcode(b)) + signedHex32(hashcode(p.model)))
                .toUpperCase();
        }

        function fingerprint(x, ms) {
            const day = Math.floor((Math.floor(ms / 1000) + 28800) / 86400) * 86400000 - 28800000;
            return h.crypto.digest("sha256", h.crypto.digest("sha256", AK + x + ms + day));
        }

        function uuid() {
            const a = h.randomHex(16).split("");
            a[12] = "4";
            a[16] = ((parseInt(a[16], 16) & 3) | 8).toString(16);
            const s = a.join("");
            return s.slice(0, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12, 16) + "-" + s.slice(16, 20) + "-" + s.slice(20);
        }

        function createIdentity() {
            const t = DEFAULT_TEMPLATE;
            const id = (t.brand + "_" + t.model)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/_$/, "");
            const mac = h.randomHex(6).match(/../g);
            mac[0] = ((parseInt(mac[0], 16) | 2) & 254).toString(16).padStart(2, "0");
            const p = {
                android_id: h.randomHex(8),
                mac: mac.join(":"),
                hardware: t.hardware,
                board: t.board,
                brand: t.brand,
                device: id,
                manufacturer: t.manufacturer,
                model: t.model,
                product: id,
                tags: "release-keys",
                build_type: "user",
                user: "build",
                resolution: t.screen_param.split("-").slice(0, 2).join("*"),
                display: t.model + "-user 13 " + t.version_id + " 2024 release-keys",
                version_id: t.version_id,
                host: t.brand.toLowerCase() + "-tv-build",
                fingerprint: t.manufacturer + "/" + id + "/" + id + ":13/" + t.version_id + "/2024:user/release-keys",
                report_model: t.report_model,
            };
            return {
                schema_version: 1,
                profile: p,
                profile_source: t.source,
                screen_param: t.screen_param,
                cast_model: t.cast_model,
                cloud_guid: "",
                registered_at: 0,
            };
        }

        function loadOrInitIdentity() {
            if (identity && identity.profile && /^[a-f0-9]{16}$/i.test(identity.profile.android_id || "")) {
                return identity;
            }
            const cached = h.storage.get("identity");
            if (
                cached &&
                cached.profile &&
                /^[a-f0-9]{16}$/i.test(cached.profile.android_id || "") &&
                cached.profile.mac
            ) {
                delete cached.x_fingerprint;
                identity = cached;
            } else {
                identity = createIdentity();
                h.storage.set("identity", identity);
            }
            return identity;
        }

        function persistIdentity() {
            if (!identity) return;
            const copy = Object.assign({}, identity);
            delete copy.x_fingerprint;
            h.storage.set("identity", copy);
        }

        function keyBytes(key) {
            const hex = h.bytes.convert(key, "utf8", "hex");
            return h.bytes.convert((hex + "00".repeat(32)).slice(0, 64), "hex", "base64");
        }

        function decrypt(value, key) {
            try {
                return h.bytes.convert(h.crypto.open({ key: keyBytes(key), data: value }), "base64", "utf8");
            } catch (_) {
                throw fail("decrypt", "AES-GCM authentication or encoding failed");
            }
        }

        function encrypt(value, key) {
            return h.crypto.seal({ key: keyBytes(key), data: h.bytes.convert(value, "utf8", "base64") });
        }

        function buildHeaders(context, content, time) {
            return {
                "Accept": "application/json",
                "Accept-Language": "zh-CN,zh;q=0.8",
                "Referer": "api.cctv.cn",
                "User-Agent": "cctv_app_tv",
                "UID": context.profile.android_id,
                "appChannel": "dangbei",
                "X-Uid": context.x_uid,
                "X-Fingerprint": context.x_fingerprint,
                "X-Version": "1.4.1",
                "X-Timestamp": String(time || h.now()),
                "X-Nonce": uuid(),
                "Content-Type": content || "application/json",
                "Cache-Control": "no-cache",
            };
        }

        function common(context, sdk) {
            const p = context.profile;
            const v = {
                cctv_id: context.x_uid,
                device_id: p.android_id,
                idfa: "",
                idfv: "",
                user_id: "",
                app_key: "1178c84d-4818-44ff-b415-02106e87e144",
                imei: "",
                android_id: p.android_id,
                mac: p.mac,
                device_builder_type: p.build_type,
                device_hardware: p.hardware,
                device_board: p.board,
                device_brand: p.brand,
                device_params: p.device,
                device_display: p.display,
                device_version_id: p.version_id,
                device_host: p.host,
                device_product: p.product,
                device_tags: p.tags,
                device_user: p.user,
                device_fingerprint: p.fingerprint,
                device_manufacturer: p.manufacturer,
                device_model: p.report_model || p.model.replace(p.manufacturer, "").replace(/ /g, ""),
                device_resolution: p.resolution,
                system_type: "Android",
                device_type: "TV",
                app_language: "CHINESE",
                app_version: "1.4.1",
                sdk_version: sdk || "",
                os_version: (p.fingerprint.split(":")[1] || "").split("/")[0],
                app_channel: "dangbei",
                data_time: String(h.now()),
            };
            const limits = {
                device_host: 128,
                device_user: 30,
                device_fingerprint: 128,
                device_model: 50,
                device_resolution: 20,
                app_version: 30,
                sdk_version: 30,
                os_version: 20,
                app_channel: 50,
                data_time: 13,
            };
            Object.keys(v).forEach(function (k) {
                v[k] = String(v[k]).slice(0, limits[k] || 64);
            });
            return v;
        }

        function resultCode(v) {
            if (!v || typeof v !== "object") return null;
            for (const k of ["result", "code", "errCode", "errcode", "ret"]) {
                const n = v[k];
                if (typeof n === "number" && Number.isInteger(n)) return n;
                if (typeof n === "string" && /^-?\d+$/.test(n)) return Number(n);
            }
            for (const k of ["data", "error", "response"]) {
                const n = resultCode(v[k]);
                if (n !== null) return n;
            }
            return null;
        }

        function guid(v) {
            return v && v.data && typeof v.data.guid === "string" ? v.data.guid : "";
        }

        async function post(stage, url, body, extra, form, slash, cloudResponse, context) {
            const ctx = context || loadOrInitIdentity();
            const wait = 500 - (h.now() - lastControl);
            if (lastControl && wait > 0) await h.scheduler.sleep(wait);
            const payload = typeof body === "function" ? body() : body;
            const additional = typeof extra === "function" ? extra() : extra || {};
            let response;
            try {
                response = await h.http.request({
                    url: url,
                    method: "POST",
                    headers: Object.assign(
                        buildHeaders(ctx, form ? "application/x-www-form-urlencoded" : "application/json"),
                        additional
                    ),
                    body: form ? payload : stable(payload, !!slash),
                    timeoutSeconds: 15,
                });
            } catch (_) {
                throw fail(stage, stage + " network transport failed");
            } finally {
                lastControl = h.now();
            }

            let value;
            try {
                value = typeof response.body === "string" ? JSON.parse(response.body) : response.body;
            } catch (_) {}

            const business = resultCode(value);
            const registration =
                cloudResponse && response.status === 400 && [0, 2, 601, 694, 695].indexOf(business) >= 0;
            if ((response.status < 200 || response.status >= 300) && !registration) {
                const e = fail(
                    stage,
                    stage + " HTTP " + response.status + (business !== null ? " (business " + business + ")" : ""),
                    response.status
                );
                e.httpStatus = response.status;
                e.businessCode = business;
                throw e;
            }
            if (!value || typeof value !== "object") throw fail(stage, stage + " returned invalid JSON");
            return value;
        }

        async function sendHeartbeat(s) {
            if (!s) return;
            const v = await post(
                "heartbeat",
                "https://ytpdata.cctv.cn/das/app/data/message/single",
                function () {
                    return {
                        key: "app_heartbeat",
                        value: Object.assign(common(s.identity), {
                            network_type: "WiFi",
                            guid: s.guid,
                            other: "",
                        }),
                    };
                },
                {},
                false,
                false,
                false,
                s.identity
            );
            const code = resultCode(v);
            if (code !== null && code !== 0) {
                session = null;
                h.storage.set("session", null);
                throw fail("heartbeat", "Heartbeat rejected", code);
            }
            s.lastHeartbeat = h.now();
            h.storage.set("session", s);
        }

        async function bootstrap() {
            const baseId = loadOrInitIdentity();
            const context = JSON.parse(JSON.stringify(baseId));
            const savedUID = baseId.x_uid;
            let time;
            context.x_uid = uid(context.profile);

            const app = await post(
                "app/start",
                BASE + "api/app/start/v1/01",
                function () {
                    time = h.now();
                    context.x_fingerprint = fingerprint(context.x_uid, time);
                    return { key: "app_start_d1", value: common(context) };
                },
                function () {
                    return { UID: "", "X-Timestamp": String(time) };
                },
                false,
                true,
                false,
                context
            );

            const encrypted = typeof app.data === "string" ? app.data : app.data && app.data.key;
            if (typeof encrypted !== "string") throw fail("app/start", "Missing encrypted session key", resultCode(app));
            const key = decrypt(encrypted, context.x_fingerprint.slice(0, 32));

            const savedGUID =
                savedUID === context.x_uid && typeof context.cloud_guid === "string" && context.cloud_guid.trim()
                    ? context.cloud_guid
                    : "";

            const body = {
                device_name: "央视频电视投屏助手",
                device_id: h.crypto.rsaEncrypt({
                    publicKey: PUBLIC_KEY,
                    data: h.bytes.convert(context.x_uid, "utf8", "base64"),
                }),
            };

            let value,
                cloud = "",
                code = null;
            try {
                value = await post(
                    "cloud/get",
                    "https://ytpcloudws.cctv.cn/cloudps/wssapi/device/v2/get",
                    body,
                    {},
                    false,
                    false,
                    true,
                    context
                );
                cloud = guid(value);
                code = resultCode(value);
                if (!cloud && [601, 2].indexOf(code) >= 0) {
                    for (let i = 0; i < 2; i++) {
                        value = await post(
                            "cloud/register",
                            "https://ytpcloudws.cctv.cn/cloudps/wssapi/device/v2/register",
                            body,
                            {},
                            false,
                            false,
                            true,
                            context
                        );
                        cloud = guid(value);
                        code = resultCode(value);
                        if (cloud || code !== 695) break;
                    }
                    if (!cloud && [0, 694, 2].indexOf(code) >= 0) {
                        value = await post(
                            "cloud/get",
                            "https://ytpcloudws.cctv.cn/cloudps/wssapi/device/v2/get",
                            body,
                            {},
                            false,
                            false,
                            true,
                            context
                        );
                        cloud = guid(value);
                        code = resultCode(value);
                    }
                }
            } catch (e) {
                if (savedGUID) {
                    cloud = savedGUID;
                } else {
                    throw e;
                }
            }

            if (!cloud && savedGUID && [0, 2, 601, 694, 695].indexOf(code) >= 0) {
                cloud = savedGUID;
            }
            if (!cloud) {
                throw fail("cloud/register", "Device registration returned no guid", resultCode(value));
            }

            session = {
                key: key,
                guid: cloud,
                created: h.now(),
                lastHeartbeat: h.now(),
                identity: context,
            };
            await sendHeartbeat(session);
            identity.x_uid = context.x_uid;
            identity.cloud_guid = cloud;
            identity.registered_at = identity.registered_at || Math.floor(h.now() / 1000);
            persistIdentity();
            h.storage.set("session", session);
            blockedUntil = 0;
            return session;
        }

        async function ensureSession() {
            if (!session) {
                const cachedSession = h.storage.get("session");
                if (
                    cachedSession &&
                    cachedSession.key &&
                    cachedSession.guid &&
                    cachedSession.identity &&
                    h.now() - cachedSession.created < 7200000
                ) {
                    session = cachedSession;
                }
            }
            if (session && h.now() - session.created < 7200000) {
                if (h.now() - (session.lastHeartbeat || 0) > 60000) {
                    try {
                        await sendHeartbeat(session);
                    } catch (_) {
                        session = null;
                        h.storage.set("session", null);
                    }
                }
                if (session) return session;
            }
            if (h.now() < blockedUntil) {
                throw fail("device/cooldown", "Device initialization is cooling down");
            }
            try {
                return await bootstrap();
            } catch (e) {
                session = null;
                h.storage.set("session", null);
                blockedUntil = h.now() + 15000;
                throw e;
            }
        }

        function form(value) {
            return Object.keys(value)
                .map(function (k) {
                    return (
                        encodeURIComponent(k) +
                        "=" +
                        encodeURIComponent(value[k])
                            .replace(/%20/g, "+")
                            .replace(/[!'()*]/g, function (c) {
                                return "%" + c.charCodeAt(0).toString(16).toUpperCase();
                            })
                    );
                })
                .join("&");
        }

        async function resolve(channel, rate) {
            const targetRate = rate !== undefined ? rate : "36p";
            if (!LIVE_IDS[channel.id]) {
                throw fail("device/channel", "Device route unavailable for this channel", null, 422);
            }
            const s = await ensureSession();
            try {
                const one = await post(
                    "live/01",
                    BASE + "api/live/v1/01",
                    {
                        screenParam: s.identity.screen_param,
                        rate: "",
                        systemType: "ios",
                        model: s.identity.cast_model,
                        id: LIVE_IDS[channel.id],
                        userId: "BAEBFF2B-C516-4F34-ABC0-A824A6461CBD",
                        clientSign: "cctvVideo",
                        deviceId: { serial: "", imei: "", android_id: "" },
                    },
                    {},
                    false,
                    false,
                    false,
                    s.identity
                );
                const videos = one.data && (one.data.videoList || one.data.videos);
                if (!Array.isArray(videos)) throw fail("live/01", "Missing videos", resultCode(one));
                const candidates = videos.filter(function (v) {
                    return v && typeof v.url === "string" && v.url;
                });
                const video =
                    (targetRate &&
                        candidates.find(function (v) {
                            return v.rate === targetRate;
                        })) ||
                    candidates[0];
                if (!video) throw fail("live/01", "No usable video URL");

                const raw = /^https?:\/\//.test(video.url) ? video.url : decrypt(video.url, s.key);
                const two = await post(
                    "live/02",
                    BASE + "api/live/v1/02",
                    { guid: encrypt("", s.key) },
                    {},
                    false,
                    false,
                    false,
                    s.identity
                );
                const secretValue =
                    typeof two.data === "string" ? two.data : two.data && (two.data.appSecret || two.data.app_secret);
                if (typeof secretValue !== "string") throw fail("live/02", "Missing appSecret", resultCode(two));
                const secret = decrypt(secretValue, s.key);
                const random = h.randomHex(4) + "-0000-" + h.randomHex(2) + "-0000-00000000" + h.randomHex(2);
                const sign = h.crypto.digest("md5", AK + secret + random);

                const vdn = await post(
                    "VDN",
                    "https://ytpvdn.cctv.cn/cctvmobileinf/rest/cctv/videoliveUrl/getstream",
                    form({
                        appcommon: stable({ adid: "", av: "1.4.1", an: "央视频电视投屏助手", ap: "cctv_app_tv" }),
                        url: raw,
                    }),
                    { APPID: AK, APPSIGN: sign, APPRANDOMSTR: random },
                    true,
                    false,
                    false,
                    s.identity
                );
                if (
                    String(vdn.succeed).replace(/"/g, "") !== "1" ||
                    typeof vdn.url !== "string" ||
                    !/^https?:\/\//.test(vdn.url)
                ) {
                    throw fail("VDN", "VDN returned no final URL", resultCode(vdn));
                }
                return {
                    url: vdn.url,
                    candidates: [vdn.url],
                    headers: {
                        "UID": s.identity.profile.android_id,
                        "APPID": AK,
                        "APPSIGN": sign,
                        "APPRANDOMSTR": random,
                        "Referer": "api.cctv.cn",
                        "User-Agent": "cctv_app_tv",
                    },
                    source: "device",
                    rate: video.rate || "",
                    quality: video.rateName || video.rate || "投屏超清",
                };
            } catch (e) {
                if (e.stage === "decrypt" || [400, 401, 403].indexOf(e.code) >= 0) {
                    session = null;
                    h.storage.set("session", null);
                    blockedUntil = h.now() + 5000;
                }
                throw e;
            }
        }

        return {
            resolve: resolve,
            liveIDs: LIVE_IDS,
            testing: {
                stable: stable,
                hashcode: hashcode,
                uid: uid,
                fingerprint: fingerprint,
                createIdentity: createIdentity,
                decrypt: decrypt,
                encrypt: encrypt,
            },
        };
    }

    // =========================================================================
    // 五、频道表模块 (createChannelTable) —— 64 个央视 & 卫视频道与路由策略
    // =========================================================================

    // =========================================================================
    // 四（续）、纯 JS gzip / inflate（GzipPure）—— 供 JCE 请求压缩与回包解压
    // =========================================================================

// Pure-JS gzip (stored compress) + gunzip/inflate (decompress) + CRC32.
// No Node.js, no Buffer — only Uint8Array / plain arrays. Written for XPTV's
// JavaScriptCore, tested against Node's zlib (see test-gzip-pure.cjs).
var GzipPure = (function () {
    "use strict";

    // ---- CRC-32 (IEEE, poly 0xEDB88320) ----
    var CRC_TABLE = (function () {
        var t = new Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(bytes) {
        var c = 0xffffffff;
        for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    }

    // ---- gzip compress with STORED (uncompressed) DEFLATE blocks ----
    // Valid gzip; any gunzip accepts it. Used for the JCE request packet.
    function gzipCompressStored(data) {
        var out = [31, 139, 8, 0, 0, 0, 0, 0, 0, 3];
        var pos = 0;
        if (data.length === 0) {
            out.push(1, 0, 0, 255, 255); // final empty stored block
        } else {
            while (pos < data.length) {
                var chunk = Math.min(65535, data.length - pos);
                var last = pos + chunk >= data.length ? 1 : 0;
                out.push(last); // BFINAL + BTYPE=00 (byte-aligned: low 3 bits)
                out.push(chunk & 255, (chunk >>> 8) & 255);
                var nlen = (~chunk) & 65535;
                out.push(nlen & 255, (nlen >>> 8) & 255);
                for (var i = 0; i < chunk; i++) out.push(data[pos + i]);
                pos += chunk;
            }
        }
        var crc = crc32(data);
        out.push(crc & 255, (crc >>> 8) & 255, (crc >>> 16) & 255, (crc >>> 24) & 255);
        var size = data.length >>> 0;
        out.push(size & 255, (size >>> 8) & 255, (size >>> 16) & 255, (size >>> 24) & 255);
        return out;
    }

    // ---- bit reader (LSB-first, per RFC 1951) ----
    function BitReader(bytes, start) {
        this.b = bytes;
        this.p = start || 0; // byte position
        this.bit = 0; // bit position within current byte (0 = LSB)
    }
    BitReader.prototype.read = function (n) {
        var v = 0;
        for (var i = 0; i < n; i++) {
            if (this.p >= this.b.length) throw new Error("inflate: unexpected end of input");
            v |= ((this.b[this.p] >>> this.bit) & 1) << i;
            this.bit++;
            if (this.bit === 8) { this.bit = 0; this.p++; }
        }
        return v;
    };
    BitReader.prototype.alignByte = function () {
        if (this.bit !== 0) { this.bit = 0; this.p++; }
    };

    // ---- canonical Huffman decoder ----
    // lengths: array of code lengths per symbol. Builds canonical codes and
    // decodes by accumulating bits (correct; JCE payloads are small).
    function Huffman(lengths) {
        this.lengths = lengths;
        this.maxLen = 0;
        for (var i = 0; i < lengths.length; i++) if (lengths[i] > this.maxLen) this.maxLen = lengths[i];
        // count codes per length, then assign canonical codes
        var blCount = new Array(this.maxLen + 1).fill(0);
        for (var j = 0; j < lengths.length; j++) if (lengths[j] > 0) blCount[lengths[j]]++;
        var code = 0;
        var nextCode = new Array(this.maxLen + 1).fill(0);
        for (var bits = 1; bits <= this.maxLen; bits++) {
            code = (code + blCount[bits - 1]) << 1;
            nextCode[bits] = code;
        }
        // map: (length, code) -> symbol, stored as map[length][code]
        this.map = [];
        for (var l = 0; l <= this.maxLen; l++) this.map[l] = {};
        for (var s = 0; s < lengths.length; s++) {
            var len = lengths[s];
            if (len > 0) { this.map[len][nextCode[len]] = s; nextCode[len]++; }
        }
    }
    Huffman.prototype.decode = function (br) {
        var code = 0;
        for (var len = 1; len <= this.maxLen; len++) {
            code = (code << 1) | br.read(1);
            var sym = this.map[len][code];
            if (sym !== undefined) return sym;
        }
        throw new Error("inflate: invalid Huffman code");
    };

    // DEFLATE length / distance base values and extra bits (RFC 1951 §3.2.5)
    var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    function inflateBlock(br, litHuff, distHuff, out) {
        for (;;) {
            var sym = litHuff.decode(br);
            if (sym < 256) {
                out.push(sym);
            } else if (sym === 256) {
                return;
            } else {
                var li = sym - 257;
                if (li < 0 || li >= LEN_BASE.length) throw new Error("inflate: bad length symbol " + sym);
                var len = LEN_BASE[li] + br.read(LEN_EXTRA[li]);
                var dsym = distHuff.decode(br);
                if (dsym < 0 || dsym >= DIST_BASE.length) throw new Error("inflate: bad distance symbol " + dsym);
                var dist = DIST_BASE[dsym] + br.read(DIST_EXTRA[dsym]);
                if (dist > out.length) throw new Error("inflate: distance too far back");
                var from = out.length - dist;
                for (var i = 0; i < len; i++) out.push(out[from + i]);
            }
        }
    }

    // Raw DEFLATE stream decompression. bytes: input array, start: byte offset.
    // Returns { data: number[], nextByte: index just past the stream }.
    function inflateRaw(bytes, start) {
        var br = new BitReader(bytes, start || 0);
        var out = [];
        for (;;) {
            var bfinal = br.read(1);
            var btype = br.read(2);
            if (btype === 0) {
                br.alignByte();
                if (br.p + 4 > bytes.length) throw new Error("inflate: truncated stored block");
                var len = bytes[br.p] | (bytes[br.p + 1] << 8);
                var nlen = bytes[br.p + 2] | (bytes[br.p + 3] << 8);
                if (len !== ((~nlen) & 65535)) throw new Error("inflate: stored LEN/NLEN mismatch");
                br.p += 4;
                if (br.p + len > bytes.length) throw new Error("inflate: truncated stored data");
                for (var i = 0; i < len; i++) out.push(bytes[br.p + i]);
                br.p += len;
            } else if (btype === 1) {
                var litLen = new Array(288).fill(0);
                for (var a = 0; a < 144; a++) litLen[a] = 8;
                for (var b = 144; b < 256; b++) litLen[b] = 9;
                for (var c = 256; c < 280; c++) litLen[c] = 7;
                for (var d = 280; d < 288; d++) litLen[d] = 8;
                var distLen = new Array(32).fill(5);
                inflateBlock(br, new Huffman(litLen), new Huffman(distLen), out);
            } else if (btype === 2) {
                var hlit = br.read(5) + 257;
                var hdist = br.read(5) + 1;
                var hclen = br.read(4) + 4;
                var clen = new Array(19).fill(0);
                for (var e = 0; e < hclen; e++) clen[CLEN_ORDER[e]] = br.read(3);
                var clHuff = new Huffman(clen);
                var total = hlit + hdist;
                var lengths = new Array(total).fill(0);
                var i2 = 0;
                while (i2 < total) {
                    var s2 = clHuff.decode(br);
                    if (s2 <= 15) {
                        lengths[i2++] = s2;
                    } else if (s2 === 16) {
                        if (i2 === 0) throw new Error("inflate: repeat with no previous length");
                        var prev = lengths[i2 - 1];
                        var rep = 3 + br.read(2);
                        for (var r = 0; r < rep; r++) lengths[i2++] = prev;
                    } else if (s2 === 17) {
                        var rep17 = 3 + br.read(3);
                        for (var r2 = 0; r2 < rep17; r2++) lengths[i2++] = 0;
                    } else if (s2 === 18) {
                        var rep18 = 11 + br.read(7);
                        for (var r3 = 0; r3 < rep18; r3++) lengths[i2++] = 0;
                    } else {
                        throw new Error("inflate: bad code-length symbol " + s2);
                    }
                }
                var litHuff = new Huffman(lengths.slice(0, hlit));
                var distHuff = new Huffman(lengths.slice(hlit));
                inflateBlock(br, litHuff, distHuff, out);
            } else {
                throw new Error("inflate: invalid block type " + btype);
            }
            if (bfinal) break;
        }
        if (br.bit !== 0) br.p++;
        return { data: out, nextByte: br.p };
    }

    // ---- gunzip (RFC 1952) ----
    function gunzip(bytes) {
        if (!bytes || bytes.length < 18) throw new Error("gunzip: input too short");
        if (bytes[0] !== 31 || bytes[1] !== 139) throw new Error("gunzip: bad magic");
        if (bytes[2] !== 8) throw new Error("gunzip: not DEFLATE");
        var flg = bytes[3];
        var p = 10;
        if (flg & 4) { // FEXTRA
            if (p + 2 > bytes.length) throw new Error("gunzip: truncated FEXTRA");
            var xlen = bytes[p] | (bytes[p + 1] << 8);
            p += 2 + xlen;
        }
        if (flg & 8) { while (p < bytes.length && bytes[p] !== 0) p++; p++; } // FNAME
        if (flg & 16) { while (p < bytes.length && bytes[p] !== 0) p++; p++; } // FCOMMENT
        if (flg & 2) p += 2; // FHCRC
        if (p > bytes.length) throw new Error("gunzip: truncated header");
        var res = inflateRaw(bytes, p);
        var end = res.nextByte;
        if (end + 8 > bytes.length) throw new Error("gunzip: truncated footer");
        var crc = (bytes[end] | (bytes[end + 1] << 8) | (bytes[end + 2] << 16) | (bytes[end + 3] << 24)) >>> 0;
        var isize = (bytes[end + 4] | (bytes[end + 5] << 8) | (bytes[end + 6] << 16) | (bytes[end + 7] << 24)) >>> 0;
        if ((res.data.length >>> 0) !== isize) throw new Error("gunzip: ISIZE mismatch");
        if (crc32(res.data) !== crc) throw new Error("gunzip: CRC mismatch");
        return res.data;
    }

    return { crc32: crc32, gzipCompressStored: gzipCompressStored, inflateRaw: inflateRaw, gunzip: gunzip };
})();

    // =========================================================================
    // 四（续）、JCE 协议模块 (createJCEProtocol) —— 二进制 JCE/QMF 直播窗
    // 由 JSTV 版 ysp-live-spider.js 的 createJCEProtocol 移植，仅替换 Node 专属调用
    // （Buffer/zlib/httpBinary/store），W/R 编解码与 wrap/unwrap 与原版逐字相同。
    // =========================================================================

function createJCEProtocol(h) {
    let guid,
        flow = Promise.resolve(),
        lastRequestAt = -Infinity;
    function be(value, n) {
        const out = [];
        for (let i = n - 1; i >= 0; i--) out.push(Math.floor(value / Math.pow(256, i)) & 255);
        return out;
    }
    function W() {
        this.b = [];
    }
    W.prototype.head = function (type, tag) {
        this.b.push(tag < 15 ? (tag << 4) | type : 240 | type);
        if (tag >= 15) this.b.push(tag);
    };
    W.prototype.number = function (v, tag) {
        if (!Number.isSafeInteger(v)) throw new Error("JCE integer outside safe range");
        if (v === 0) {
            this.head(12, tag);
            return;
        }
        const n =
            v >= -128 && v <= 127 ? 1 : v >= -32768 && v <= 32767 ? 2 : v >= -2147483648 && v <= 2147483647 ? 4 : 8;
        this.head({ 1: 0, 2: 1, 4: 2, 8: 3 }[n], tag);
        this.b.push(...be(v, n));
    };
    function utf8(s) {
        const text = unescape(encodeURIComponent(s));
        return Array.from(text, (c) => c.charCodeAt(0));
    }
    function text(b) {
        return decodeURIComponent(escape(String.fromCharCode(...b)));
    }
    W.prototype.string = function (value, tag) {
        const b = utf8(value);
        this.head(b.length > 255 ? 7 : 6, tag);
        this.b.push(...be(b.length, b.length > 255 ? 4 : 1), ...b);
    };
    W.prototype.bytes = function (b, tag) {
        this.head(13, tag);
        this.head(0, 0);
        this.number(b.length, 0);
        this.b.push(...b);
    };
    W.prototype.struct = function (fn, tag) {
        this.head(10, tag);
        fn(this);
        this.head(11, 0);
    };
    function R(bytes) {
        this.b = bytes;
        this.p = 0;
    }
    R.prototype.get = function (n) {
        if (!Number.isInteger(n) || n < 0 || n > 2097152 || this.p + n > this.b.length)
            throw new Error("Truncated JCE");
        const out = this.b.slice(this.p, this.p + n);
        this.p += n;
        return out;
    };
    R.prototype.num = function (n, signed) {
        const a = this.get(n);
        let v = signed && a[0] & 128 ? -1 : 0;
        for (const c of a) v = v * 256 + c;
        if (!Number.isSafeInteger(v)) throw new Error("JCE integer outside safe range");
        return v;
    };
    R.prototype.head = function () {
        const b = this.num(1, false);
        return [b & 15, b >> 4 === 15 ? this.num(1, false) : b >> 4];
    };
    R.prototype.field = function (depth) {
        const [t] = this.head();
        return this.value(t, depth + 1);
    };
    R.prototype.value = function (t, depth) {
        if (depth > 32) throw new Error("JCE nesting limit");
        if (t <= 3) return this.num([1, 2, 4, 8][t], true);
        if (t === 4 || t === 5) {
            const b = this.get(t === 4 ? 4 : 8);
            const dv = new DataView(new Uint8Array(b).buffer);
            return t === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
        }
        if (t === 6 || t === 7) {
            const b = this.get(this.num(t === 6 ? 1 : 4, false));
            if (b.length > 65536) throw new Error("JCE string limit");
            return text(b);
        }
        if (t === 8 || t === 9) {
            const n = this.field(depth);
            if (!Number.isInteger(n) || n < 0 || n > 4096) throw new Error("JCE collection limit");
            const out = t === 9 ? [] : {};
            for (let i = 0; i < n; i++) {
                if (t === 9) out.push(this.field(depth));
                else {
                    const k = this.field(depth);
                    out[k] = this.field(depth);
                }
            }
            return out;
        }
        if (t === 10) return this.struct(depth + 1);
        if (t === 12) return 0;
        if (t === 13) {
            const [sub] = this.head();
            if (sub !== 0) throw new Error("Invalid JCE byte array");
            return this.get(this.field(depth));
        }
        throw new Error("Unsupported JCE type " + t);
    };
    R.prototype.struct = function (depth = 0) {
        if (depth > 32) throw new Error("JCE nesting limit");
        const out = {};
        while (this.p < this.b.length) {
            const [t, tag] = this.head();
            if (t === 11) return out;
            out[tag] = this.value(t, depth + 1);
        }
        return out;
    };
    function qua(w, id) {
        w.string("3.2.7.26212", 0);
        w.string("302070", 1);
        [1080, 2400, 3].forEach((v, i) => w.number(v, i + 2));
        w.string("12", 5);
        w.number(1, 6);
        w.number(1, 7);
        w.number(420, 8);
        w.string("10070", 9);
        for (let i = 10; i < 15; i++) w.string("", i);
        w.struct((s) => {
            s.number(0, 0);
            s.number(0, 1);
            s.string("", 2);
        }, 15);
        for (let i = 16; i < 19; i++) w.string("", i);
        w.struct((s) => {
            s.number(0, 0);
            s.head(4, 1);
            s.b.push(0, 0, 0, 0);
            s.head(4, 2);
            s.b.push(0, 0, 0, 0);
            s.head(5, 3);
            s.b.push(0, 0, 0, 0, 0, 0, 0, 0);
        }, 19);
        w.string(id.slice(0, 16), 20);
        w.string("Pixel 6", 21);
        w.number(1, 22);
        for (let i = 23; i < 27; i++) w.number(0, i);
        w.string("", 27);
        w.string("", 28);
        w.string(id, 29);
    }
    function toBase64(bytes) {
        return bytesToBase64(bytes);
    }
    function fromBase64(value) {
        return Array.from(base64ToBytes(value));
    }
    function wrap(body, id, reqid) {
        const w = new W();
        w.struct((s) => {
            s.number(reqid, 0);
            s.number(25312, 1);
            s.struct((v) => qua(v, id), 2);
            s.string("1200013", 3);
            s.string(id, 4);
            s.head(9, 5);
            s.number(0, 0);
            s.struct(() => { }, 6);
            s.head(9, 7);
            s.number(0, 0);
            [8, 9, 10].forEach((t) => s.number(0, t));
        }, 0);
        w.bytes(body, 1);
        const inner = [38, ...be(w.b.length + 17, 4), 1, ...Array(10).fill(0), ...w.b, 40];
        const compressed = GzipPure.gzipCompressStored(inner);
        // prettier-ignore
        const out = [
            19, 0, 0, 0, 0, ...be(2, 2), ...be(65281, 2), ...be(25312, 2), 0, 0, ...be(reqid, 8), ...be(531, 4),
            ...be(10012, 4), ...Array(8).fill(0), ...utf8(id), 1, ...be(302070, 4), ...Array(6).fill(0), 0, 0,
            0, 0, 0, ...be(inner.length, 4), ...compressed, 3,
        ];
        out.splice(1, 4, ...be(out.length, 4));
        return out;
    }
    function unwrap(bytes) {
        if (bytes.length < 90 || bytes[0] !== 19 || bytes[bytes.length - 1] !== 3)
            throw new Error("Invalid QMF response");
        const length = new R(bytes.slice(1, 5)).num(4, false);
        if (length !== bytes.length) throw new Error("QMF length mismatch");
        const flags = new R(bytes.slice(21, 25)).num(4, false);
        let payload = bytes.slice(89, -1);
        if (flags & 2) payload = GzipPure.gunzip(payload);
        if (payload[0] !== 38 || payload[payload.length - 1] !== 40) throw new Error("Invalid QMF inner payload");
        const root = new R(payload.slice(16, -1)).struct();
        if (!Array.isArray(root[1])) throw new Error("Missing JCE body");
        return new R(root[1]).struct();
    }
    // 字节数组 -> latin-1 字符串（每字节一个字符）。JCE 请求体的备用格式：
    // 宿主 $fetch 一定能处理字符串体；若它按 latin-1 发送则字节无损，
    // 若按 UTF-8 发送则高位字节会损坏、服务端会报错——都是快速失败，不会挂起。
    function bytesToLatin1(bytes) {
        let out = "";
        for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
        return out;
    }

    // $fetch 返回的二进制回包格式不确定：可能是 Uint8Array / ArrayBuffer /
    // base64 字符串 / latin-1 字符串。按 QMF 魔数（首字节 19、末字节 3）逐个试。
    function responseBytes(data) {
        if (!data && data !== "") throw new Error("JCE empty response");
        if (data instanceof Uint8Array) return Array.from(data);
        if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer)
            return Array.from(new Uint8Array(data));
        if (typeof data === "string") {
            try {
                const asB64 = Array.from(base64ToBytes(data));
                if (asB64.length >= 90 && asB64[0] === 19 && asB64[asB64.length - 1] === 3) return asB64;
            } catch (_) {}
            const out = [];
            for (let i = 0; i < data.length; i++) out.push(data.charCodeAt(i) & 255);
            return out;
        }
        if (Array.isArray(data)) return data.slice();
        throw new Error("JCE unsupported response type");
    }
    async function request(channel, start, end) {
        const w = new W();
        w.string(channel.livePID, 0);
        w.string(channel.channelID, 1);
        w.number(start, 2);
        w.number(end, 3);
        w.string(channel.definition || "fhd", 4);
        const packet = wrap(w.b, guid, Date.now() & 2147483647);
        // 二进制 POST：先试 Uint8Array（标准二进制体）；若宿主 $fetch 处理不了
        // （一直不回包或抛错），再试 latin-1 字符串体。两次都加 6 秒超时，
        // 避免 $fetch 挂起导致播放器一直转圈；都失败则抛错，由上层退回 BK。
        // 若宿主没有 setTimeout（无法超时），只用字符串体——它一定快速失败，
        // 不会挂起。
        const hasTimer = typeof setTimeout === "function" && typeof clearTimeout === "function";
        const bodies = hasTimer ? [new Uint8Array(packet), bytesToLatin1(packet)] : [bytesToLatin1(packet)];
        let response = null;
        let lastError = null;
        for (let i = 0; i < bodies.length; i++) {
            try {
                response = await withTimeout(
                    h.http.requestBinary({
                        url: "https://jacc.ysp.cctv.cn",
                        method: "POST",
                        headers: { "Content-Type": "application/octet-stream" },
                        body: bodies[i],
                    }),
                    6000,
                    "JCE request timeout"
                );
                break;
            } catch (e) {
                lastError = e;
                h.log("JCE 请求体格式 " + (i === 0 && hasTimer ? "Uint8Array" : "latin-1") + " 失败: " + (e.message || e));
            }
        }
        if (!response) throw lastError || new Error("JCE request failed");
        if (!response.ok || response.status < 200 || response.status >= 300)
            throw new Error("JCE HTTP " + response.status);
        const value = unwrap(responseBytes(response.data));
        if (value[0] !== undefined && value[0] !== 0) throw new Error("JCE business code " + value[0]);
        const url = value[2];
        if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new Error("JCE returned no manifest");
        if (/^https?:\/\/liverecord\.video\.cloud\.cctv\.com(?:[/:]|$)/i.test(url))
            throw new Error("JCE returned an unavailable CDN host");
        return {
            url,
            candidates: [url],
            headers: { "User-Agent": "Mozilla/5.0" },
            source: "JCE",
            quality: channel.definition || "fhd",
            expiresAt: Date.now() / 1000 + 60,
            resolutionVerified: false,
        };
    }
    function resolve(channel, start, end) {
        const task = flow.then(async () => {
            const wait = 700 + Math.floor(Math.random() * 100) - (Date.now() - lastRequestAt);
            if (wait > 0) await sleep(wait);
            try {
                return await request(channel, start, end);
            } finally {
                lastRequestAt = Date.now();
            }
        });
        flow = task.then(
            () => undefined,
            () => undefined,
        );
        return task;
    }
    return {
        start: () => {
            guid = h.storage.get("jce-guid");
            if (typeof guid !== "string" || !/^[0-9a-f]{32}$/.test(guid)) {
                guid = h.randomHex(16);
                h.storage.set("jce-guid", guid);
            }
        },
        resolve,
        testing: { W, R, wrap, unwrap, toBase64, fromBase64 },
    };
}

    function createChannelTable() {
        const CHANNELS = [
            {
                "id": "cctv1",
                "name": "CCTV-1 综合",
                "group": "央视",
                "channelID": "2024078201",
                "livePID": "600001859",
                "definition": "fhd",
                "tvgID": "CCTV1",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv1.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv2",
                "name": "CCTV-2 财经",
                "group": "央视",
                "channelID": "2024075401",
                "livePID": "600001800",
                "definition": "fhd",
                "tvgID": "CCTV2",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv2.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv3",
                "name": "CCTV-3 综艺",
                "group": "央视",
                "channelID": "2024068501",
                "livePID": "600001801",
                "definition": "fhd",
                "tvgID": "CCTV3",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv3.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv4",
                "name": "CCTV-4 中文国际",
                "group": "央视",
                "channelID": "2029797101",
                "livePID": "600001814",
                "definition": "fhd",
                "tvgID": "CCTV4",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv4.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv5",
                "name": "CCTV-5 体育",
                "group": "央视",
                "channelID": "2024078401",
                "livePID": "600001818",
                "definition": "fhd",
                "tvgID": "CCTV5",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv5.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv5p",
                "name": "CCTV-5+ 体育赛事",
                "group": "央视",
                "channelID": "2024078001",
                "livePID": "600001817",
                "definition": "fhd",
                "tvgID": "CCTV5+",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv5p.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv6",
                "name": "CCTV-6 电影",
                "group": "央视",
                "channelID": "2013693901",
                "livePID": "600108442",
                "definition": "fhd",
                "tvgID": "CCTV6",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv6.png",
                "quality": "1080p",
            },
            {
                "id": "cctv7",
                "name": "CCTV-7 国防军事",
                "group": "央视",
                "channelID": "2024072001",
                "livePID": "600004092",
                "definition": "fhd",
                "tvgID": "CCTV7",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv7.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv8",
                "name": "CCTV-8 电视剧",
                "group": "央视",
                "channelID": "2029793001",
                "livePID": "600001803",
                "definition": "fhd",
                "tvgID": "CCTV8",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv8.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv9",
                "name": "CCTV-9 纪录",
                "group": "央视",
                "channelID": "2024078601",
                "livePID": "600004078",
                "definition": "fhd",
                "tvgID": "CCTV9",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv9.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv10",
                "name": "CCTV-10 科教",
                "group": "央视",
                "channelID": "2024078701",
                "livePID": "600001805",
                "definition": "fhd",
                "tvgID": "CCTV10",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv10.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv11",
                "name": "CCTV-11 戏曲",
                "group": "央视",
                "channelID": "2027248701",
                "livePID": "600001806",
                "definition": "fhd",
                "tvgID": "CCTV11",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv11.png",
                "quality": "1080p",
            },
            {
                "id": "cctv12",
                "name": "CCTV-12 社会与法",
                "group": "央视",
                "channelID": "2027248801",
                "livePID": "600001807",
                "definition": "fhd",
                "tvgID": "CCTV12",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv12.png",
                "quality": "1080p",
            },
            {
                "id": "cctv13",
                "name": "CCTV-13 新闻",
                "group": "央视",
                "channelID": "2029797201",
                "livePID": "600001811",
                "definition": "fhd",
                "tvgID": "CCTV13",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv13.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctv14",
                "name": "CCTV-14 少儿",
                "group": "央视",
                "channelID": "2027248901",
                "livePID": "600001809",
                "definition": "fhd",
                "tvgID": "CCTV14",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv14.png",
                "quality": "1080p",
            },
            {
                "id": "cctv15",
                "name": "CCTV-15 音乐",
                "group": "央视",
                "channelID": "2027249001",
                "livePID": "600001815",
                "definition": "fhd",
                "tvgID": "CCTV15",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv15.png",
                "quality": "1080p",
            },
            {
                "id": "cctv16",
                "name": "CCTV-16 奥林匹克",
                "group": "央视",
                "channelID": "2027249101",
                "livePID": "600098637",
                "definition": "fhd",
                "tvgID": "CCTV16",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv16.png",
                "quality": "1080p",
            },
            {
                "id": "cctv164k",
                "name": "CCTV-16 4K",
                "group": "央视",
                "channelID": "2027249301",
                "livePID": "600099502",
                "definition": "fhd",
                "tvgID": "CCTV16",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv164k.png",
                "quality": "4K/超高清",
            },
            {
                "id": "cctv17",
                "name": "CCTV-17 农业农村",
                "group": "央视",
                "channelID": "2027249401",
                "livePID": "600001810",
                "definition": "fhd",
                "tvgID": "CCTV17",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv17.png",
                "quality": "1080p",
            },
            {
                "id": "cctv4k",
                "name": "CCTV-4K 超高清",
                "group": "央视",
                "channelID": "2029810301",
                "livePID": "600002264",
                "definition": "fhd",
                "tvgID": "CCTV4K",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv4k.png",
                "quality": "4K/超高清",
            },
            {
                "id": "cctv8k",
                "name": "CCTV-8K 超高清",
                "group": "央视",
                "channelID": "2026774101",
                "livePID": "600156816",
                "definition": "fhd",
                "tvgID": "CCTV-8K",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv8k.png",
                "quality": "8K/超高清",
            },
            {
                "id": "cgtn",
                "name": "CGTN",
                "group": "央视",
                "channelID": "2024181701",
                "livePID": "600014550",
                "definition": "fhd",
                "tvgID": "CGTN英语",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtn.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cgtnfr",
                "name": "CGTN 法语",
                "group": "央视",
                "channelID": "2024181801",
                "livePID": "600084704",
                "definition": "fhd",
                "tvgID": "CGTN法语",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtnfr.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cgtnru",
                "name": "CGTN 俄语",
                "group": "央视",
                "channelID": "2024181901",
                "livePID": "600084758",
                "definition": "fhd",
                "tvgID": "CGTN俄语",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtnru.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cgtnar",
                "name": "CGTN 阿拉伯语",
                "group": "央视",
                "channelID": "2024182001",
                "livePID": "600084782",
                "definition": "fhd",
                "tvgID": "CGTN阿语",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtnar.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cgtnes",
                "name": "CGTN 西班牙语",
                "group": "央视",
                "channelID": "2024182101",
                "livePID": "600084744",
                "definition": "fhd",
                "tvgID": "CGTN西语",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtnes.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cgtndoc",
                "name": "CGTN 纪录",
                "group": "央视",
                "channelID": "2024182301",
                "livePID": "600084781",
                "definition": "fhd",
                "tvgID": "CGTN纪录",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtndoc.png",
                "quality": "1080p/超清",
            },
            {
                "id": "cctvfyjc",
                "name": "CCTV 风云剧场",
                "group": "央视",
                "channelID": "2025637102",
                "livePID": "600099658",
                "definition": "shd",
                "tvgID": "CCTV风云剧场",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctvfyjc.png",
                "quality": "720p",
            },
            {
                "id": "cctvdyjc",
                "name": "CCTV 第一剧场",
                "group": "央视",
                "channelID": "2026874202",
                "livePID": "600099655",
                "definition": "shd",
                "tvgID": "CCTV第一剧场",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctvdyjc.png",
                "quality": "720p",
            },
            {
                "id": "cctvhjjc",
                "name": "CCTV 怀旧剧场",
                "group": "央视",
                "channelID": "2026874302",
                "livePID": "600099620",
                "definition": "shd",
                "tvgID": "CCTV怀旧剧场",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctvhjjc.png",
                "quality": "720p",
            },
            {
                "id": "bjws",
                "name": "北京卫视",
                "group": "卫视",
                "channelID": "2024052703",
                "livePID": "600002309",
                "definition": "fhd",
                "tvgID": "北京卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/bjws.png",
                "quality": "1080p",
            },
            {
                "id": "jsws",
                "name": "江苏卫视",
                "group": "卫视",
                "channelID": "2024171103",
                "livePID": "600002521",
                "definition": "fhd",
                "tvgID": "江苏卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/jsws.png",
                "quality": "1080p",
            },
            {
                "id": "dfws",
                "name": "东方卫视",
                "group": "卫视",
                "channelID": "2024054503",
                "livePID": "600002483",
                "definition": "fhd",
                "tvgID": "东方卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/dfws.png",
                "quality": "1080p",
            },
            {
                "id": "zjws",
                "name": "浙江卫视",
                "group": "卫视",
                "channelID": "2024054703",
                "livePID": "600002520",
                "definition": "fhd",
                "tvgID": "浙江卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/zjws.png",
                "quality": "1080p",
            },
            {
                "id": "hnws",
                "name": "湖南卫视",
                "group": "卫视",
                "channelID": "2024054803",
                "livePID": "600002475",
                "definition": "fhd",
                "tvgID": "湖南卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/hnws.png",
                "quality": "1080p",
            },
            {
                "id": "hbws",
                "name": "湖北卫视",
                "group": "卫视",
                "channelID": "2024171203",
                "livePID": "600002508",
                "definition": "fhd",
                "tvgID": "湖北卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/hbws.png",
                "quality": "1080p",
            },
            {
                "id": "gdws",
                "name": "广东卫视",
                "group": "卫视",
                "channelID": "2024060903",
                "livePID": "600002485",
                "definition": "fhd",
                "tvgID": "广东卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/gdws.png",
                "quality": "1080p",
            },
            {
                "id": "gxws",
                "name": "广西卫视",
                "group": "卫视",
                "channelID": "2024060703",
                "livePID": "600002509",
                "definition": "fhd",
                "tvgID": "广西卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/gxws.png",
                "quality": "1080p",
            },
            {
                "id": "hljws",
                "name": "黑龙江卫视",
                "group": "卫视",
                "channelID": "2029797003",
                "livePID": "600002498",
                "definition": "fhd",
                "tvgID": "黑龙江卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/hljws.png",
                "quality": "1080p",
            },
            {
                "id": "hainanws",
                "name": "海南卫视",
                "group": "卫视",
                "channelID": "2024055603",
                "livePID": "600002506",
                "definition": "fhd",
                "tvgID": "海南卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/hainanws.png",
                "quality": "1080p",
            },
            {
                "id": "cqws",
                "name": "重庆卫视",
                "group": "卫视",
                "channelID": "2024061103",
                "livePID": "600002531",
                "definition": "fhd",
                "tvgID": "重庆卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cqws.png",
                "quality": "1080p",
            },
            {
                "id": "szws",
                "name": "深圳卫视",
                "group": "卫视",
                "channelID": "2024061303",
                "livePID": "600002481",
                "definition": "fhd",
                "tvgID": "深圳卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/szws.png",
                "quality": "1080p",
            },
            {
                "id": "scws",
                "name": "四川卫视",
                "group": "卫视",
                "channelID": "2024061403",
                "livePID": "600002516",
                "definition": "fhd",
                "tvgID": "四川卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/scws.png",
                "quality": "1080p",
            },
            {
                "id": "henanws",
                "name": "河南卫视",
                "group": "卫视",
                "channelID": "2029797303",
                "livePID": "600002525",
                "definition": "fhd",
                "tvgID": "河南卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/henanws.png",
                "quality": "1080p",
            },
            {
                "id": "dnws",
                "name": "东南卫视",
                "group": "卫视",
                "channelID": "2024061503",
                "livePID": "600002484",
                "definition": "fhd",
                "tvgID": "东南卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/dnws.png",
                "quality": "1080p",
            },
            {
                "id": "gzws",
                "name": "贵州卫视",
                "group": "卫视",
                "channelID": "2024061603",
                "livePID": "600002490",
                "definition": "fhd",
                "tvgID": "贵州卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/gzws.png",
                "quality": "1080p",
            },
            {
                "id": "jxws",
                "name": "江西卫视",
                "group": "卫视",
                "channelID": "2024061703",
                "livePID": "600002503",
                "definition": "fhd",
                "tvgID": "江西卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/jxws.png",
                "quality": "1080p",
            },
            {
                "id": "lnws",
                "name": "辽宁卫视",
                "group": "卫视",
                "channelID": "2024171303",
                "livePID": "600002505",
                "definition": "fhd",
                "tvgID": "辽宁卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/lnws.png",
                "quality": "1080p",
            },
            {
                "id": "ahws",
                "name": "安徽卫视",
                "group": "卫视",
                "channelID": "2024171403",
                "livePID": "600002532",
                "definition": "fhd",
                "tvgID": "安徽卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/ahws.png",
                "quality": "1080p",
            },
            {
                "id": "hebws",
                "name": "河北卫视",
                "group": "卫视",
                "channelID": "2024171503",
                "livePID": "600002493",
                "definition": "fhd",
                "tvgID": "河北卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/hebws.png",
                "quality": "1080p",
            },
            {
                "id": "sdws",
                "name": "山东卫视",
                "group": "卫视",
                "channelID": "2029787903",
                "livePID": "600002513",
                "definition": "fhd",
                "tvgID": "山东卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/sdws.png",
                "quality": "1080p",
            },
            {
                "id": "tjws",
                "name": "天津卫视",
                "group": "卫视",
                "channelID": "2019927003",
                "livePID": "600152137",
                "definition": "fhd",
                "tvgID": "天津卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/tjws.png",
                "quality": "1080p",
            },
            {
                "id": "jlws",
                "name": "吉林卫视",
                "group": "卫视",
                "channelID": "2025561503",
                "livePID": "600190405",
                "definition": "fhd",
                "tvgID": "吉林卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/jlws.png",
                "quality": "1080p",
            },
            {
                "id": "saxws",
                "name": "陕西卫视",
                "group": "卫视",
                "channelID": "2029795103",
                "livePID": "600190400",
                "definition": "fhd",
                "tvgID": "陕西卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/saxws.png",
                "quality": "1080p",
            },
            {
                "id": "nxws",
                "name": "宁夏卫视",
                "group": "卫视",
                "channelID": "2025608503",
                "livePID": "600190737",
                "definition": "fhd",
                "tvgID": "宁夏卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/nxws.png",
                "quality": "1080p",
            },
            {
                "id": "nmgws",
                "name": "内蒙古卫视",
                "group": "卫视",
                "channelID": "2025561203",
                "livePID": "600190401",
                "definition": "fhd",
                "tvgID": "内蒙古卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/nmgws.png",
                "quality": "1080p",
            },
            {
                "id": "ynws",
                "name": "云南卫视",
                "group": "卫视",
                "channelID": "2025561303",
                "livePID": "600190402",
                "definition": "fhd",
                "tvgID": "云南卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/ynws.png",
                "quality": "1080p",
            },
            {
                "id": "shanxiws",
                "name": "山西卫视",
                "group": "卫视",
                "channelID": "2025560803",
                "livePID": "600190407",
                "definition": "fhd",
                "tvgID": "山西卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/shanxiws.png",
                "quality": "1080p",
            },
            {
                "id": "gsws",
                "name": "甘肃卫视",
                "group": "卫视",
                "channelID": "2025561703",
                "livePID": "600190408",
                "definition": "fhd",
                "tvgID": "甘肃卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/gsws.png",
                "quality": "1080p",
            },
            {
                "id": "qhws",
                "name": "青海卫视",
                "group": "卫视",
                "channelID": "2025559103",
                "livePID": "600190406",
                "definition": "fhd",
                "tvgID": "青海卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/qhws.png",
                "quality": "1080p",
            },
            {
                "id": "xizangws",
                "name": "西藏卫视",
                "group": "卫视",
                "channelID": "2025558003",
                "livePID": "600190403",
                "definition": "fhd",
                "tvgID": "西藏卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/xizangws.png",
                "quality": "1080p",
            },
            {
                "id": "xjws",
                "name": "新疆卫视",
                "group": "卫视",
                "channelID": "2019927403",
                "livePID": "600152138",
                "definition": "fhd",
                "tvgID": "新疆卫视",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/xjws.png",
                "quality": "1080p",
            },
            {
                "id": "cetv1",
                "name": "CETV-1 中国教育1台",
                "group": "卫视",
                "channelID": "2022823801",
                "livePID": "600171827",
                "definition": "fhd",
                "tvgID": "CETV1",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cetv1.png",
                "quality": "1080p",
            },
            {
                "id": "guoxue",
                "name": "国学频道",
                "group": "卫视",
                "channelID": "2029360403",
                "livePID": "600213139",
                "definition": "fhd",
                "tvgID": "国学",
                "logo": "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/guoxue.png",
                "quality": "1080p",
            },
        ];

        const ALIASES = {
            "anhuiws": "ahws",
            "beijingws": "bjws",
            "cctv16hd": "cctv16",
            "cctv5plus": "cctv5p",
            "cctvdiyijuchang": "cctvdyjc",
            "cctvfengyunjuchang": "cctvfyjc",
            "cctvhuaijiujuchang": "cctvhjjc",
            "cgtnalaboyu": "cgtnar",
            "cgtneyu": "cgtnru",
            "cgtnfayu": "cgtnfr",
            "cgtnwaiyujilu": "cgtndoc",
            "cgtnxibanyayu": "cgtnes",
            "chongqingws": "cqws",
            "dongfangws": "dfws",
            "fujiandongnanws": "dnws",
            "guangdongws": "gdws",
            "guangxiws": "gxws",
            "guizhouws": "gzws",
            "hebeiws": "hebws",
            "heilongjiangws": "hljws",
            "hubeiws": "hbws",
            "hunanws": "hnws",
            "jiangsuws": "jsws",
            "jiangxiws": "jxws",
            "jilinws": "jlws",
            "liaoningws": "lnws",
            "neimengguws": "nmgws",
            "ningxiaws": "nxws",
            "qinghaiws": "qhws",
            "shandongws": "sdws",
            "shannxiws": "saxws",
            "shenzhenws": "szws",
            "sichuanws": "scws",
            "tianjinws": "tjws",
            "xinjiangws": "xjws",
            "yunnanws": "ynws",
            "zhejiangws": "zjws",
        };

        const FORCE_BK_IDS = new Set([
            "cctv11",
            "cctv12",
            "cctv14",
            "cctv15",
            "cctv16",
            "cctv17",
            "cctvfyjc",
            "cctvdyjc",
            "cctvhjjc",
        ]);

        const SPECIAL_IDS = new Set([
            "cctv4k",
            "cctv8k",
            "cctv164k",
            "cgtn",
            "cgtnfr",
            "cgtnru",
            "cgtnar",
            "cgtnes",
            "cgtndoc",
            "cctvfyjc",
            "cctvdyjc",
            "cctvhjjc",
        ]);

        const byID = Object.create(null);
        CHANNELS.forEach(function (c) {
            byID[c.id] = c;
        });

        return {
            list: CHANNELS,
            forceBK: FORCE_BK_IDS,
            specialIDs: SPECIAL_IDS,
            find: function (raw) {
                let key = String(raw || "").toLowerCase();
                key = ALIASES[key] || key;
                return byID[key] || null;
            },
        };
    }

    // =========================================================================
    // 六、解析调度与缓存服务
    // =========================================================================

    const channels = createChannelTable();
    const bk = createBKProtocol(hostAdapter);
    const device = createDeviceProtocol(hostAdapter);
    const jce = createJCEProtocol(hostAdapter);
    jce.start();
    // 支持 JCE 直播窗（7 天回看）的 53 个台，与 JSTV 版一致
    const CATCHUP_IDS = new Set(["ahws","bjws","cctv1","cctv10","cctv13","cctv2","cctv3","cctv4","cctv5","cctv5p","cctv6","cctv7","cctv8","cctv8k","cctv9","cetv1","cgtn","cgtnar","cgtndoc","cgtnes","cgtnfr","cgtnru","cqws","dfws","dnws","gdws","gsws","guoxue","gxws","gzws","hainanws","hbws","hebws","henanws","hljws","hnws","jlws","jsws","jxws","lnws","nmgws","nxws","qhws","saxws","scws","sdws","shanxiws","szws","tjws","xizangws","xjws","ynws","zjws"]);
    const jceCooldown = new Map();
    const resolveCache = new Map();

    function getUserConfig() {
        try {
            if (typeof $config_str === "string" && $config_str.trim()) {
                return JSON.parse($config_str);
            }
        } catch (_) {}
        return {};
    }

    // JCE 直播窗：与 JSTV 版 resolveJCELive 相同（start = now-120，end = now+900）
    async function resolveJCELive(channel) {
        const now = Math.floor(Date.now() / 1000),
            end = now + 900;
        const result = await jce.resolve(channel, now - 120, end);
        return Object.assign({}, result, { expiresAt: end - 60 });
    }

    // JCE 地址实测不可用时退回 BK（与 Device/BK 的校验逻辑一致）
    async function resolveJCEValidated(channel) {
        const r = await resolveJCELive(channel);
        const verdict = await validatePlayUrl(r.url, r.headers);
        if (verdict === "bad") {
            safeLog("JCE 地址实测不可用，回退 BK (" + channel.id + ")");
            return await pickWorkingBK(channel);
        }
        return r;
    }

    async function resolveBKOrThrow(channel) {
        const r = await bk.resolve(channel);
        if (!r.ok || !r.url) {
            throw new Error(r.error || "BK 直播源解析失败");
        }
        return r;
    }

    // 校验播放地址是否真实可用：用播放请求头拉一次 m3u8，看正文是不是播放列表。
    // 返回 "good"（正文以 #EXTM3U 开头）、"bad"（明确拿到非播放列表正文或 HTTP 4xx/5xx）、
    // "unknown"（请求抛错或空正文，无法判断——按可用处理，让播放器再试一次）。
    async function validatePlayUrl(url, headers) {
        try {
            const res = await xptvHttpRequest({ url: url, method: "GET", headers: headers || {} });
            if (res && typeof res.status === "number" && res.status >= 400) return "bad";
            const body = typeof res.body === "string" ? res.body.replace(/^\uFEFF/, "").trim() : "";
            if (!body) return "unknown";
            if (body.indexOf("#EXTM3U") === 0) return "good";
            return "bad";
        } catch (_) {
            return "unknown";
        }
    }

    // 从候选地址里挑第一个可用（good/unknown）的；全是 bad 时返回第一个（尽力而为）。
    async function pickWorkingCandidate(candidates, headers) {
        if (!Array.isArray(candidates) || !candidates.length) return null;
        for (let i = 0; i < candidates.length; i++) {
            const verdict = await validatePlayUrl(candidates[i], headers);
            if (verdict !== "bad") return { url: candidates[i], index: i, verdict: verdict };
        }
        return { url: candidates[0], index: 0, verdict: "bad" };
    }

    // BK 解析失败时重试一次（上游偶发错误），再失败才抛错。
    async function resolveBKWithRetry(channel) {
        try {
            return await resolveBKOrThrow(channel);
        } catch (e) {
            safeLog("BK 解析重试 (" + channel.id + "): " + (e.message || e));
            await sleep(300);
            return await resolveBKOrThrow(channel);
        }
    }

    // 从 BK 结果里挑一个实测可用的地址（卫视 BK 有时首选地址 403，换备线即可）。
    // 返回的新结果把可用地址放首位；全都不可用时保留原结果（尽力而为）。
    async function pickWorkingBK(channel) {
        const r = await resolveBKWithRetry(channel);
        const candidates = Array.isArray(r.candidates) && r.candidates.length ? r.candidates : [r.url];
        let pick = await pickWorkingCandidate(candidates, r.headers);
        // 候选地址全部不可用时，重新向上游要一份新地址（新签名）再试一次。
        // XPTV 里清后台重开修不好这类失败，说明坏的是上游当时给的地址，
        // 不是本地状态，所以直接重新解析比只换备线更有效。
        if (pick && pick.verdict === "bad") {
            safeLog("BK 候选地址全部不可用，重新解析一次 (" + channel.id + ")");
            try {
                const r2 = await resolveBKWithRetry(channel);
                const candidates2 =
                    Array.isArray(r2.candidates) && r2.candidates.length ? r2.candidates : [r2.url];
                const pick2 = await pickWorkingCandidate(candidates2, r2.headers);
                if (pick2 && pick2.verdict !== "bad") {
                    const ordered = [pick2.url].concat(
                        candidates2.filter(function (u) {
                            return u !== pick2.url;
                        })
                    );
                    return Object.assign({}, r2, { url: pick2.url, candidates: ordered });
                }
            } catch (e) {
                safeLog("BK 重新解析失败，返回原结果 (" + channel.id + "): " + (e.message || e));
            }
        }
        if (pick && pick.index > 0) {
            const ordered = [pick.url].concat(
                candidates.filter(function (u) {
                    return u !== pick.url;
                })
            );
            return Object.assign({}, r, { url: pick.url, candidates: ordered });
        }
        return r;
    }

    // Device 地址实测不可用时退回 BK（Device 解析成功但地址 403 时，原逻辑不会回退）。
    async function resolveDeviceValidated(channel, rate) {
        const r = await device.resolve(channel, rate);
        const verdict = await validatePlayUrl(r.url, r.headers);
        if (verdict === "bad") {
            safeLog("Device 地址实测不可用，回退 BK (" + channel.id + ")");
            return await pickWorkingBK(channel);
        }
        return r;
    }

    async function resolvePlayable(channelId, options) {
        const channel = channels.find(channelId);
        if (!channel) throw new Error("未知频道: " + channelId);

        const userCfg = getUserConfig();
        const source = (options && options.source) || userCfg.source || "auto";
        const rate = options && options.rate !== undefined ? options.rate : userCfg.rate || "36p";
        const cacheKey = channel.id + "|" + source + "|" + rate;

        const cached = resolveCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }

        let result;
        if (source === "bk") {
            result = await pickWorkingBK(channel);
        } else if (source === "jce") {
            if (!CATCHUP_IDS.has(channel.id)) throw new Error("JCE is unavailable for this channel");
            try {
                result = await resolveJCEValidated(channel);
            } catch (e) {
                safeLog("JCE 路线请求失败，自动回退 BK: " + (e.message || e));
                jceCooldown.set(channel.id, Date.now() + 300000);
                result = await pickWorkingBK(channel);
            }
        } else if (source === "device") {
            try {
                result = await resolveDeviceValidated(channel, rate);
            } catch (e) {
                safeLog("Device 路线请求失败，自动回退 BK: " + (e.message || e));
                result = await pickWorkingBK(channel);
            }
        } else {
            // auto 模式：有 Device ID 且不在 forceBK 集合中的频道优先走 Device 超清，
            // 解析失败或地址实测不可用时无缝退回 BK
            if (device.liveIDs[channel.id] && !channels.forceBK.has(channel.id)) {
                try {
                    result = await resolveDeviceValidated(channel, rate);
                } catch (e) {
                    safeLog("Auto 模式 Device 回退 BK (" + channel.id + "): " + (e.message || e));
                    result = await pickWorkingBK(channel);
                }
            } else if (CATCHUP_IDS.has(channel.id) && (jceCooldown.get(channel.id) || 0) <= Date.now()) {
                // auto：无 Device 的回看台先试 JCE，失败冷却 5 分钟并退回 BK（与 JSTV 版一致）
                try {
                    result = await resolveJCEValidated(channel);
                } catch (e) {
                    jceCooldown.set(channel.id, Date.now() + 300000);
                    safeLog("Auto 模式 JCE 回退 BK (" + channel.id + "): " + (e.message || e));
                    result = await pickWorkingBK(channel);
                }
            } else {
                result = await pickWorkingBK(channel);
            }
        }

        const ttlMs = result.source === "device" ? 50000 : result.source === "JCE" ? 840000 : 180000;
        resolveCache.set(cacheKey, {
            data: result,
            expiresAt: Date.now() + ttlMs,
        });
        if (resolveCache.size > 64) {
            const oldestKey = resolveCache.keys().next().value;
            resolveCache.delete(oldestKey);
        }
        return result;
    }

    function channelToCard(c) {
        const hasDevice = !!device.liveIDs[c.id] && !channels.forceBK.has(c.id);
        let remarks = (hasDevice ? c.quality + " · 投屏源" : c.quality) + " · v2.2.4";
        try {
            const diag = hostAdapter.storage.get("diag:" + c.id);
            if (typeof diag === "string" && diag) remarks += " · " + diag;
        } catch (e) {}
        return {
            vod_id: c.id,
            vod_name: c.name,
            vod_pic: c.logo || "",
            vod_remarks: remarks,
            ext: {
                id: c.id,
                name: c.name,
            },
        };
    }

    return {
        channels: channels,
        bk: bk,
        device: device,
        jce: jce,
        catchupIDs: CATCHUP_IDS,
        host: hostAdapter,
        resolvePlayable: resolvePlayable,
        channelToCard: channelToCard,
        testing: {
            validatePlayUrl: validatePlayUrl,
            pickWorkingCandidate: pickWorkingCandidate,
        },
    };
})();

// =============================================================================
// 七、XPTV 标准生命周期入口函数 (getConfig / getCards / getTracks / getPlayinfo / search)
// =============================================================================

var appConfig = {
    ver: 2,
    version: "2.2.4",
    name: "央视频直播",
    title: "央视频直播",
    desc: "央视频电视直播 (Device投屏超清 + BK主备源 v2)",
    author: "YSP-XPTV",
    api: "csp_ysp",
    type: 3,
    site: "https://www.yangshipin.cn",
    tabs: [
        { name: "央视", ext: { group: "央视" } },
        { name: "卫视", ext: { group: "卫视" } },
        { name: "4K/CGTN/剧场", ext: { group: "special" } },
        { name: "全部频道", ext: { group: "all" } },
    ],
};

function getLocalInfo() {
    return jsonify(appConfig);
}

function getlocalinfo() {
    return jsonify(appConfig);
}

function getConfig() {
    return jsonify(appConfig);
}

async function getCards(ext) {
    ext = argsify(ext);
    const page = Number(ext.page || 1);
    if (page > 1) {
        return jsonify({ list: [] });
    }
    const group = ext.group || "央视";
    const list = YSPCore.channels.list
        .filter(function (c) {
            if (group === "all") return true;
            if (group === "special") return YSPCore.channels.specialIDs.has(c.id);
            return c.group === group;
        })
        .map(YSPCore.channelToCard);

    return jsonify({ list: list });
}

async function getTracks(ext) {
    ext = argsify(ext);
    const channel = YSPCore.channels.find(ext.id);
    if (!channel) {
        return jsonify({ list: [] });
    }

    const groups = [
        {
            title: "智能优选",
            tracks: [
                {
                    name: channel.name + " [自动优选]",
                    pan: "",
                    ext: {
                        id: channel.id,
                        source: "auto",
                        rate: "36p",
                    },
                },
            ],
        },
    ];

    if (YSPCore.device.liveIDs[channel.id]) {
        groups.push({
            title: "电视投屏源 (Device)",
            tracks: [
                {
                    name: channel.name + " [投屏超清 36p]",
                    pan: "",
                    ext: {
                        id: channel.id,
                        source: "device",
                        rate: "36p",
                    },
                },
                {
                    name: channel.name + " [投屏自适应]",
                    pan: "",
                    ext: {
                        id: channel.id,
                        source: "device",
                        rate: "",
                    },
                },
            ],
        });
    }

    if (YSPCore.catchupIDs.has(channel.id)) {
        groups.push({
            title: "JCE 直播源",
            tracks: [
                {
                    name: channel.name + " [JCE]",
                    pan: "",
                    ext: {
                        id: channel.id,
                        source: "jce",
                    },
                },
            ],
        });
    }

    groups.push({
        title: "稳定直播源 (BK)",
        tracks: [
            {
                name: channel.name + " [BK主线]",
                pan: "",
                ext: {
                    id: channel.id,
                    source: "bk",
                    candidateIndex: 0,
                },
            },
            {
                name: channel.name + " [BK备线1]",
                pan: "",
                ext: {
                    id: channel.id,
                    source: "bk",
                    candidateIndex: 1,
                },
            },
            {
                name: channel.name + " [BK备线2]",
                pan: "",
                ext: {
                    id: channel.id,
                    source: "bk",
                    candidateIndex: 2,
                },
            },
        ],
    });

    return jsonify({ list: groups });
}

// 临时诊断（v2.2.3）：把解析出的那路流的真实编码信息记下来。
    // 拉一次 m3u8，取 CODECS（主播放列表才有）和第一条非 # 行的后缀
    // （分片 .ts 还是变体 .m3u8），存进 $cache，下次回频道列表时显示在备注里。
    // 不阻塞播放（getPlayinfo 里 fire-and-forget），任何失败都只记一条简短说明。
    async function recordStreamDiag(source, channelId, url, headers) {
        const key = "diag:" + channelId;
        const label = source === "BK live" ? "BK" : source === "device" ? "Device" : source === "JCE" ? "JCE" : String(source || "?");
        try {
            const res = await YSPCore.host.http.request({
                url: url,
                method: "GET",
                headers: headers || {},
                timeoutSeconds: 10,
            });
            const text = res && typeof res.body === "string" ? res.body.replace(/^\uFEFF/, "") : "";
            if (!text || text.indexOf("#EXTM3U") < 0) {
                YSPCore.host.storage.set(key, label + ": m3u8 invalid");
                return;
            }
            const codecsMatch = /CODECS="([^"]*)"/i.exec(text);
            const codecs = codecsMatch ? codecsMatch[1] : "";
            let firstUrl = "";
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line && line.charAt(0) !== "#") {
                    firstUrl = line;
                    break;
                }
            }
            let firstExt = "";
            if (firstUrl) {
                const clean = firstUrl.split("?")[0].split("#")[0];
                const dot = clean.lastIndexOf(".");
                firstExt = dot >= 0 ? clean.slice(dot) : "";
            }
            let diag = label;
            if (codecs) diag += " " + codecs;
            if (firstExt) diag += " " + firstExt;
            YSPCore.host.storage.set(key, diag);
        } catch (e) {
            try {
                YSPCore.host.storage.set(key, label + ": diag fail");
            } catch (_) {}
        }
    }

async function getPlayinfo(ext) {
    ext = argsify(ext);
    let result;
    try {
        result = await YSPCore.resolvePlayable(ext.id, {
        source: ext.source || "auto",
        rate: ext.rate !== undefined ? ext.rate : "36p",
    });

    const allCandidates =
        Array.isArray(result.candidates) && result.candidates.length > 0 ? result.candidates.slice() : [result.url];

    const idx = Number(ext.candidateIndex || 0);
    let orderedUrls = allCandidates;
    if (idx > 0 && allCandidates.length > 1) {
        const chosenIdx = Math.min(idx, allCandidates.length - 1);
        const primary = allCandidates[chosenIdx];
        orderedUrls = [primary].concat(
            allCandidates.filter(function (_, i) {
                return i !== chosenIdx;
            })
        );
    }

    const playHeaders = result.headers || {};
    // 诊断：把这路流的编码信息记下来。必须 await——实测 fire-and-forget 在真机上
    // 拿不到结果（getPlayinfo 返回后宿主似乎就不再跑挂起的异步任务），所以这里等它
    // 跑完再返回地址；诊断自带 10 秒超时，失败也不影响返回。
    try {
        await recordStreamDiag(result.source, ext.id, orderedUrls[0], playHeaders);
    } catch (e) {}
    return jsonify({
        urls: orderedUrls,
        url: orderedUrls[0],
        headers: orderedUrls.map(function () {
            return playHeaders;
        }),
        header: playHeaders,
    });
    } catch (e) {
        return jsonify({ urls: [], headers: [], msg: String((e && e.message) || e || "解析失败") });
    }
}

// 兼容部分旧版模板调用 getPlayUrl
async function getPlayUrl(ext) {
    return getPlayinfo(ext);
}

async function search(ext) {
    ext = argsify(ext);
    const page = Number(ext.page || 1);
    if (page > 1) {
        return jsonify({ list: [] });
    }
    const keyword = String(ext.text || ext.wd || "").trim().toLowerCase();
    if (!keyword) {
        return jsonify({ list: [] });
    }
    const matched = YSPCore.channels.list
        .filter(function (c) {
            return (
                c.name.toLowerCase().indexOf(keyword) >= 0 ||
                c.id.toLowerCase().indexOf(keyword) >= 0 ||
                (c.tvgID && c.tvgID.toLowerCase().indexOf(keyword) >= 0) ||
                c.group.toLowerCase().indexOf(keyword) >= 0
            );
        })
        .map(YSPCore.channelToCard);

    return jsonify({ list: matched });
}