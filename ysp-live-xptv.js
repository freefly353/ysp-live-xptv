// YSP Live for XPTV — 央视频直播（XPTV / TVBox csp 格式）
//
// 由可用的 JSTV 版（CatVod spider）转换而来：频道表与 BK 签名代码逐字取自
// ysp-live-spider.js，未改动任何编号与签名算法。
//
// == 能播什么 ==
// 64 个频道（央视 30 + 卫视 34），全部走 BK（播控）协议直播。BK 是 JSTV 版的
// 兜底来源，64 个台都支持。
//
// == 为什么只有 BK ==
// XPTV 的 JS 运行环境（按社区扩展代码实测）只提供 $fetch / $cache /
// argsify / jsonify / $config_str / createCryptoJS（仅见过 MD5），没有
// AES-GCM、RSA、gzip、定时器。所以 JSTV 版的另外两条线路搬不过来：
//   - Device（投屏设备协议）需要 AES-GCM + RSA-OAEP + 心跳定时器；
//   - JCE 需要 gzip 压缩/解压 + 二进制 JCE/QMF 编解码。
// 因此 XPTV 版没有 Device 的 4K/8K 高码率，也没有 JCE 的 7 天回看。
// BK 本身是纯 JS（TEA 签名）+ 一次 HTTP 请求，可以在 XPTV 里跑。
//
// == 怎么用 ==
// 订阅 JSON 里加一个 type 3 的站点：
//   {"name": "央视频", "type": 3, "api": "csp_ysp",
//    "ext": "https://raw.githubusercontent.com/freefly353/ysp-live-spider/main/ysp-live-xptv.js"}
// ext 也可以换成你自己的托管地址。XPTV 加载后调用本文件的五个全局函数：
// getConfig / getCards / getTracks / getPlayinfo / search。
//
// == 验证状态 ==
// 本文件在本机用 XPTV host 垫片（$fetch/argsify/jsonify）跑通过：
// getConfig/getCards/getTracks/getPlayinfo（BK 上游用模拟数据）/search 均正常，
// TEA/cKey 与 NanoTV 原版逐字节一致。真实上游与真机 XPTV 尚未验证——
// XPTV 没有官方文档，格式是按社区扩展代码反推的，需在真机上验证。
//

// ---- XPTV host 适配 -------------------------------------------------------

// 日志：XPTV 提供 console.log。
function log(message) {
    console.log("[ysp] " + message);
}

// 随机字节：cKey/guard 只需要随机性，Math.random 够用
//（JSTV 版用 Node crypto.randomBytes，XPTV 没有）。
function randomBytes(count) {
    var out = [];
    for (var i = 0; i < count; i++) out.push(Math.floor(Math.random() * 256));
    return out;
}

// HTTP：XPTV 没有全局 fetch，用 $fetch.get(url, {headers})，返回 {data} 字符串。
// BK 只发 GET；$fetch 抛错时由 bk.resolve 的 catch 接住，返回 ok:false。
async function httpRequest(request) {
    var response = await $fetch.get(request.url, { headers: request.headers || {} });
    var body = response && typeof response.data === "string" ? response.data : "";
    return { status: 200, body: body };
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

function createBKProtocol() {
    var PLATFORM = 4330403;
    var APP_VERSION = "V8.22.1035.3031";
    var TEA_KEY = fromHex("59b2f7cf725ef43c34fdd7c123411ed3");
    var GUARD_KEY = fromHex("110dbec10c23e7d2e56a1cad6914ef1b");
    var KEY_XOR = [132, 46, 237, 8, 240, 102, 230, 234, 72, 180, 202, 169, 145, 237, 111, 243];
    var GUARD_XOR = [179, 201, 83, 160, 105, 19, 173, 77];
    var PLAYBACK_HEADERS = { "User-Agent": "qqlive", "Referer": "https://live.cctv.cn/" };

    function fromHex(hex) {
        if (typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) {
            throw new Error("Invalid hexadecimal bytes");
        }
        var result = [];
        for (var i = 0; i < hex.length; i += 2) result.push(parseInt(hex.slice(i, i + 2), 16));
        return result;
    }
    function toHex(bytes) {
        return bytes
            .map(function (byte) {
                return (byte < 16 ? "0" : "") + byte.toString(16);
            })
            .join("");
    }
    function utf8(value) {
        var encoded = encodeURIComponent(String(value));
        var result = [];
        for (var i = 0; i < encoded.length; i++) {
            if (encoded[i] === "%") {
                result.push(parseInt(encoded.slice(i + 1, i + 3), 16));
                i += 2;
            } else result.push(encoded.charCodeAt(i));
        }
        return result;
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
        var bytes = typeof value === "string" ? utf8(value) : value;
        if (bytes.length > 65535) throw new Error("Signature field too long");
        return [bytes.length >>> 8, bytes.length & 255].concat(bytes);
    }
    function checksum(bytes) {
        var value = 0;
        for (var i = 0; i < bytes.length; i++) value = (131 * value + bytes[i]) & 0x7fffffff;
        return value;
    }
    function teaBlock(block, key) {
        if (block.length !== 8 || key.length !== 16) throw new Error("Invalid TEA block/key size");
        var y = uint32(block, 0),
            z = uint32(block, 4),
            sum = 0;
        var k = [uint32(key, 0), uint32(key, 4), uint32(key, 8), uint32(key, 12)];
        for (var round = 0; round < 16; round++) {
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
    function teaPacket(data, key, randomBytesFn) {
        var pad = (8 - ((data.length + 10) % 8)) % 8;
        var plain = [(randomBytesFn(1)[0] & 248) | pad].concat(
            randomBytesFn(pad),
            randomBytesFn(2),
            data,
            [0, 0, 0, 0, 0, 0, 0],
        );
        var output = [],
            previousPlain = [0, 0, 0, 0, 0, 0, 0, 0],
            previousCipher = previousPlain.slice();
        for (var offset = 0; offset < plain.length; offset += 8) {
            var mixed = xorBytes(plain.slice(offset, offset + 8), previousCipher);
            var cipher = xorBytes(teaBlock(mixed, key), previousPlain);
            output = output.concat(cipher);
            previousPlain = mixed;
            previousCipher = cipher;
        }
        return output;
    }
    function base64(bytes) {
        var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var output = "";
        for (var i = 0; i < bytes.length; i += 3) {
            var a = bytes[i],
                b = bytes[i + 1],
                c = bytes[i + 2];
            output += alphabet[a >>> 2];
            output += alphabet[((a & 3) << 4) | (b === undefined ? 0 : b >>> 4)];
            output += b === undefined ? "=" : alphabet[((b & 15) << 2) | (c === undefined ? 0 : c >>> 6)];
            output += c === undefined ? "=" : alphabet[c & 63];
        }
        return output;
    }
    function guard(timestamp, guid, randomBytesFn) {
        function tail(value) {
            return value.length >= 5 ? value.slice(-5) : "";
        }
        var body = be32(timestamp).concat(lp(tail(guid)), lp(tail("null")), lp(tail("null")), lp("-1"));
        var plain = lp(body);
        var encrypted = teaPacket(plain, GUARD_KEY, randomBytesFn).concat(be32(checksum(plain)));
        return toHex(
            encrypted.map(function (byte, i) {
                return byte ^ GUARD_XOR[i & 7];
            }),
        ).toUpperCase();
    }
    function createCKey(channelID, timestamp, randomBytesFn) {
        var guid = toHex(randomBytesFn(16));
        var signatureGuard = guard(timestamp, guid, randomBytesFn);
        var uid = toHex(randomBytesFn(4)).toUpperCase();
        var body = fromHex("0000004200000004000004d2").concat(
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
            lp(signatureGuard),
        );
        var packet = lp(body);
        var packetChecksum = be32(checksum(packet));
        for (var i = 0; i < 4; i++) packet[18 + i] = packetChecksum[i];
        var encrypted = teaPacket(packet, TEA_KEY, randomBytesFn).concat(be32(checksum(packet)));
        encrypted = encrypted.map(function (byte, index) {
            return byte ^ KEY_XOR[index & 15];
        });
        var uuid = randomBytesFn(16);
        uuid[6] = (uuid[6] & 15) | 64;
        uuid[8] = (uuid[8] & 63) | 128;
        return {
            cKey: "--01" + base64(encrypted).replace(/\+/g, "_").replace(/\//g, "-").replace(/=+$/, ""),
            guid: guid,
            ts: timestamp,
            flowId: toHex(uuid).toUpperCase() + "_" + PLATFORM,
        };
    }
    function upstreamRequest(channel) {
        var key = createCKey(channel.channelID, Math.floor(Date.now() / 1000), randomBytes);
        var values = {
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
            spvcode: base64(utf8("H(30:1080,60:1080|30:1080,60:1080)")),
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
    function sanitizedDiagnostic(value) {
        return String(value || "源站网络请求失败")
            .replace(/https?:\/\/[^\s"'<>]+/gi, function (url) {
                var authority = /^https?:\/\/[^\/?#]+/i.exec(url);
                return authority ? authority[0] + "/[redacted]" : "[redacted-url]";
            })
            .replace(/\b(cKey|flowid|APPSIGN|token|sig|signature)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
            .replace(/[\u0000-\u001f\u007f]+/g, " ")
            .slice(0, 400);
    }
    async function http(request) {
        const response = await httpRequest(request);
        if (response.status < 200 || response.status > 299) {
            throw new Error("源站 HTTP " + response.status);
        }
        return response;
    }
    function playbackHost(url) {
        if (typeof url !== "string" || /[\s\u0000-\u001f\u007f\\]/.test(url)) return null;
        var match = /^(https?):\/\/([^\/?#]+)(?:[\/?#]|$)/i.exec(url);
        if (!match || match[2].indexOf("@") !== -1 || match[2].indexOf("%") !== -1) return null;
        var authority = match[2].toLowerCase();
        var parts = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(authority);
        if (!parts || (parts[2] && (Number(parts[2]) < 1 || Number(parts[2]) > 65535))) return null;
        var host = parts[1];
        if (
            host.length > 253 ||
            host.split(".").some(function (label) {
                return !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
            })
        )
            return null;
        var suffixes = ["cctv.cn", "cctv.com", "cctvpic.com", "citvc.com", "yangshipin.cn", "cntv.cn", "cntv.com"];
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
        var all = [];
        if (typeof payload.playurl === "string") all.push(payload.playurl);
        var backup = payload.backurl_list || payload.backurlList || payload.backurl;
        if (Array.isArray(backup))
            backup.forEach(function (item) {
                if (typeof item === "string") all.push(item);
                else if (item && typeof item === "object") all.push(item.url || item.playurl || "");
            });
        else if (typeof backup === "string") all = all.concat(backup.split(/[;,]\s*(?=https?:\/\/)/i));
        var unique = [];
        all.forEach(function (candidate) {
            if (isAllowedPlaybackURL(candidate) && unique.indexOf(candidate) < 0) unique.push(candidate);
        });
        return unique.sort(function (a, b) {
            var scoreA = playbackHost(a).indexOf("bklive-") >= 0 ? 0 : 1;
            var scoreB = playbackHost(b).indexOf("bklive-") >= 0 ? 0 : 1;
            return scoreA - scoreB || (a < b ? -1 : a > b ? 1 : 0);
        });
    }
    function publicChannel(channel) {
        return {
            id: channel.id,
            name: channel.name,
            group: channel.group,
            tvgID: channel.tvgID,
            logo: channel.logo,
            definition: channel.definition,
            quality: channel.quality,
            note: channel.note,
        };
    }
    async function resolveChannel(channel) {
        log("BK resolve start: " + channel.id + " (" + channel.definition + ")");
        try {
            const response = await http(upstreamRequest(channel));
            var payload;
            try {
                payload = JSON.parse(response.body);
            } catch (_) {
                throw new Error("源站未返回有效 JSON");
            }
            if (!payload || typeof payload !== "object" || Array.isArray(payload))
                throw new Error("源站响应结构不正确");
            if (
                (typeof payload.iretcode !== "number" && typeof payload.iretcode !== "string") ||
                Number(payload.iretcode) !== 0 ||
                payload.iretcode === ""
            ) {
                var code = String(payload.iretcode === undefined ? "missing" : payload.iretcode)
                    .replace(/[^a-zA-Z0-9_-]/g, "")
                    .slice(0, 24);
                throw new Error("源站拒绝解析（iretcode=" + code + "）");
            }
            var candidates = collectCandidates(payload);
            if (!candidates.length) throw new Error("源站没有返回可接受的 HTTP(S) 播放 URL");
            log("BK resolve success: " + channel.id + "; candidates=" + candidates.length + "; host=" + playbackHost(candidates[0]));
            return {
                ok: true,
                channel: publicChannel(channel),
                url: candidates[0],
                candidates: candidates,
                headers: PLAYBACK_HEADERS,
                source: "BK live",
                quality: channel.quality,
                resolvedAt: new Date().toISOString(),
            };
        } catch (error) {
            var diagnostic = sanitizedDiagnostic(error.message);
            log("BK resolve failed: " + channel.id + "; " + diagnostic);
            return {
                ok: false,
                channel: publicChannel(channel),
                url: null,
                candidates: [],
                headers: {},
                source: "BK live",
                quality: channel.quality,
                resolvedAt: new Date().toISOString(),
                error: diagnostic,
            };
        }
    }

    return {
        resolve: resolveChannel,
        testing: {
            teaBlockHex: function (block, key) {
                return toHex(teaBlock(fromHex(block), fromHex(key)));
            },
            checksumHex: function (hex) {
                return checksum(fromHex(hex));
            },
            createCKeyVector: function (channelID, timestamp, initialByte) {
                var next = initialByte;
                return createCKey(channelID, timestamp, function (count) {
                    var bytes = [];
                    for (var i = 0; i < count; i++) bytes.push(next++ & 255);
                    return bytes;
                });
            },
            isAllowedPlaybackURL: isAllowedPlaybackURL,
            collectCandidates: collectCandidates,
        },
    };
}

const CHANNELS = [
    {
        id: "cctv1",
        name: "CCTV-1 综合",
        group: "央视",
        channelID: "2024078201",
        livePID: "600001859",
        definition: "fhd",
        tvgID: "CCTV1",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv1.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv2",
        name: "CCTV-2 财经",
        group: "央视",
        channelID: "2024075401",
        livePID: "600001800",
        definition: "fhd",
        tvgID: "CCTV2",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv2.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv3",
        name: "CCTV-3 综艺",
        group: "央视",
        channelID: "2024068501",
        livePID: "600001801",
        definition: "fhd",
        tvgID: "CCTV3",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv3.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv4",
        name: "CCTV-4 中文国际",
        group: "央视",
        channelID: "2029797101",
        livePID: "600001814",
        definition: "fhd",
        tvgID: "CCTV4",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv4.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv5",
        name: "CCTV-5 体育",
        group: "央视",
        channelID: "2024078401",
        livePID: "600001818",
        definition: "fhd",
        tvgID: "CCTV5",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv5.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv5p",
        name: "CCTV-5+ 体育赛事",
        group: "央视",
        channelID: "2024078001",
        livePID: "600001817",
        definition: "fhd",
        tvgID: "CCTV5+",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv5p.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv6",
        name: "CCTV-6 电影",
        group: "央视",
        channelID: "2013693901",
        livePID: "600108442",
        definition: "fhd",
        tvgID: "CCTV6",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv6.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv7",
        name: "CCTV-7 国防军事",
        group: "央视",
        channelID: "2024072001",
        livePID: "600004092",
        definition: "fhd",
        tvgID: "CCTV7",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv7.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv8",
        name: "CCTV-8 电视剧",
        group: "央视",
        channelID: "2029793001",
        livePID: "600001803",
        definition: "fhd",
        tvgID: "CCTV8",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv8.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv9",
        name: "CCTV-9 纪录",
        group: "央视",
        channelID: "2024078601",
        livePID: "600004078",
        definition: "fhd",
        tvgID: "CCTV9",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv9.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv10",
        name: "CCTV-10 科教",
        group: "央视",
        channelID: "2024078701",
        livePID: "600001805",
        definition: "fhd",
        tvgID: "CCTV10",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv10.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv11",
        name: "CCTV-11 戏曲",
        group: "央视",
        channelID: "2027248701",
        livePID: "600001806",
        definition: "fhd",
        tvgID: "CCTV11",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv11.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv12",
        name: "CCTV-12 社会与法",
        group: "央视",
        channelID: "2027248801",
        livePID: "600001807",
        definition: "fhd",
        tvgID: "CCTV12",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv12.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv13",
        name: "CCTV-13 新闻",
        group: "央视",
        channelID: "2029797201",
        livePID: "600001811",
        definition: "fhd",
        tvgID: "CCTV13",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv13.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv14",
        name: "CCTV-14 少儿",
        group: "央视",
        channelID: "2027248901",
        livePID: "600001809",
        definition: "fhd",
        tvgID: "CCTV14",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv14.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv15",
        name: "CCTV-15 音乐",
        group: "央视",
        channelID: "2027249001",
        livePID: "600001815",
        definition: "fhd",
        tvgID: "CCTV15",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv15.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv16",
        name: "CCTV-16 奥林匹克",
        group: "央视",
        channelID: "2027249101",
        livePID: "600098637",
        definition: "fhd",
        tvgID: "CCTV16",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv16.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv164k",
        name: "CCTV-16 4K",
        group: "央视",
        channelID: "2027249301",
        livePID: "600099502",
        definition: "fhd",
        tvgID: "CCTV16",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv164k.png",
        quality: "1080p候选",
        note: "频道名称不代表本原型可提供4K/8K；仅尝试BK live回退链路。",
    },
    {
        id: "cctv17",
        name: "CCTV-17 农业农村",
        group: "央视",
        channelID: "2027249401",
        livePID: "600001810",
        definition: "fhd",
        tvgID: "CCTV17",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv17.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctv4k",
        name: "CCTV-4K 超高清",
        group: "央视",
        channelID: "2029810301",
        livePID: "600002264",
        definition: "fhd",
        tvgID: "CCTV4K",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv4k.png",
        quality: "1080p候选",
        note: "频道名称不代表本原型可提供4K/8K；仅尝试BK live回退链路。",
    },
    {
        id: "cctv8k",
        name: "CCTV-8K 超高清",
        group: "央视",
        channelID: "2026774101",
        livePID: "600156816",
        definition: "fhd",
        tvgID: "CCTV-8K",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctv8k.png",
        quality: "1080p候选",
        note: "频道名称不代表本原型可提供4K/8K；仅尝试BK live回退链路。",
    },
    {
        id: "cgtn",
        name: "CGTN",
        group: "央视",
        channelID: "2024181701",
        livePID: "600014550",
        definition: "fhd",
        tvgID: "CGTN英语",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtn.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cgtnfr",
        name: "CGTN 法语",
        group: "央视",
        channelID: "2024181801",
        livePID: "600084704",
        definition: "fhd",
        tvgID: "CGTN法语",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtnfr.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cgtnru",
        name: "CGTN 俄语",
        group: "央视",
        channelID: "2024181901",
        livePID: "600084758",
        definition: "fhd",
        tvgID: "CGTN俄语",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtnru.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cgtnar",
        name: "CGTN 阿拉伯语",
        group: "央视",
        channelID: "2024182001",
        livePID: "600084782",
        definition: "fhd",
        tvgID: "CGTN阿语",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtnar.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cgtnes",
        name: "CGTN 西班牙语",
        group: "央视",
        channelID: "2024182101",
        livePID: "600084744",
        definition: "fhd",
        tvgID: "CGTN西语",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtnes.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cgtndoc",
        name: "CGTN 纪录",
        group: "央视",
        channelID: "2024182301",
        livePID: "600084781",
        definition: "fhd",
        tvgID: "CGTN纪录",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cgtndoc.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cctvfyjc",
        name: "CCTV 风云剧场",
        group: "央视",
        channelID: "2025637102",
        livePID: "600099658",
        definition: "shd",
        tvgID: "CCTV风云剧场",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctvfyjc.png",
        quality: "720p候选",
        note: "",
    },
    {
        id: "cctvdyjc",
        name: "CCTV 第一剧场",
        group: "央视",
        channelID: "2026874202",
        livePID: "600099655",
        definition: "shd",
        tvgID: "CCTV第一剧场",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctvdyjc.png",
        quality: "720p候选",
        note: "",
    },
    {
        id: "cctvhjjc",
        name: "CCTV 怀旧剧场",
        group: "央视",
        channelID: "2026874302",
        livePID: "600099620",
        definition: "shd",
        tvgID: "CCTV怀旧剧场",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cctvhjjc.png",
        quality: "720p候选",
        note: "",
    },
    {
        id: "bjws",
        name: "北京卫视",
        group: "卫视",
        channelID: "2024052703",
        livePID: "600002309",
        definition: "fhd",
        tvgID: "北京卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/bjws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "jsws",
        name: "江苏卫视",
        group: "卫视",
        channelID: "2024171103",
        livePID: "600002521",
        definition: "fhd",
        tvgID: "江苏卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/jsws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "dfws",
        name: "东方卫视",
        group: "卫视",
        channelID: "2024054503",
        livePID: "600002483",
        definition: "fhd",
        tvgID: "东方卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/dfws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "zjws",
        name: "浙江卫视",
        group: "卫视",
        channelID: "2024054703",
        livePID: "600002520",
        definition: "fhd",
        tvgID: "浙江卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/zjws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "hnws",
        name: "湖南卫视",
        group: "卫视",
        channelID: "2024054803",
        livePID: "600002475",
        definition: "fhd",
        tvgID: "湖南卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/hnws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "hbws",
        name: "湖北卫视",
        group: "卫视",
        channelID: "2024171203",
        livePID: "600002508",
        definition: "fhd",
        tvgID: "湖北卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/hbws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "gdws",
        name: "广东卫视",
        group: "卫视",
        channelID: "2024060903",
        livePID: "600002485",
        definition: "fhd",
        tvgID: "广东卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/gdws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "gxws",
        name: "广西卫视",
        group: "卫视",
        channelID: "2024060703",
        livePID: "600002509",
        definition: "fhd",
        tvgID: "广西卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/gxws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "hljws",
        name: "黑龙江卫视",
        group: "卫视",
        channelID: "2029797003",
        livePID: "600002498",
        definition: "fhd",
        tvgID: "黑龙江卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/hljws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "hainanws",
        name: "海南卫视",
        group: "卫视",
        channelID: "2024055603",
        livePID: "600002506",
        definition: "fhd",
        tvgID: "海南卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/hainanws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cqws",
        name: "重庆卫视",
        group: "卫视",
        channelID: "2024061103",
        livePID: "600002531",
        definition: "fhd",
        tvgID: "重庆卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cqws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "szws",
        name: "深圳卫视",
        group: "卫视",
        channelID: "2024061303",
        livePID: "600002481",
        definition: "fhd",
        tvgID: "深圳卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/szws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "scws",
        name: "四川卫视",
        group: "卫视",
        channelID: "2024061403",
        livePID: "600002516",
        definition: "fhd",
        tvgID: "四川卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/scws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "henanws",
        name: "河南卫视",
        group: "卫视",
        channelID: "2029797303",
        livePID: "600002525",
        definition: "fhd",
        tvgID: "河南卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/henanws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "dnws",
        name: "东南卫视",
        group: "卫视",
        channelID: "2024061503",
        livePID: "600002484",
        definition: "fhd",
        tvgID: "东南卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/dnws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "gzws",
        name: "贵州卫视",
        group: "卫视",
        channelID: "2024061603",
        livePID: "600002490",
        definition: "fhd",
        tvgID: "贵州卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/gzws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "jxws",
        name: "江西卫视",
        group: "卫视",
        channelID: "2024061703",
        livePID: "600002503",
        definition: "fhd",
        tvgID: "江西卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/jxws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "lnws",
        name: "辽宁卫视",
        group: "卫视",
        channelID: "2024171303",
        livePID: "600002505",
        definition: "fhd",
        tvgID: "辽宁卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/lnws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "ahws",
        name: "安徽卫视",
        group: "卫视",
        channelID: "2024171403",
        livePID: "600002532",
        definition: "fhd",
        tvgID: "安徽卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/ahws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "hebws",
        name: "河北卫视",
        group: "卫视",
        channelID: "2024171503",
        livePID: "600002493",
        definition: "fhd",
        tvgID: "河北卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/hebws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "sdws",
        name: "山东卫视",
        group: "卫视",
        channelID: "2029787903",
        livePID: "600002513",
        definition: "fhd",
        tvgID: "山东卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/sdws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "tjws",
        name: "天津卫视",
        group: "卫视",
        channelID: "2019927003",
        livePID: "600152137",
        definition: "fhd",
        tvgID: "天津卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/tjws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "jlws",
        name: "吉林卫视",
        group: "卫视",
        channelID: "2025561503",
        livePID: "600190405",
        definition: "fhd",
        tvgID: "吉林卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/jlws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "saxws",
        name: "陕西卫视",
        group: "卫视",
        channelID: "2029795103",
        livePID: "600190400",
        definition: "fhd",
        tvgID: "陕西卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/saxws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "nxws",
        name: "宁夏卫视",
        group: "卫视",
        channelID: "2025608503",
        livePID: "600190737",
        definition: "fhd",
        tvgID: "宁夏卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/nxws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "nmgws",
        name: "内蒙古卫视",
        group: "卫视",
        channelID: "2025561203",
        livePID: "600190401",
        definition: "fhd",
        tvgID: "内蒙古卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/nmgws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "ynws",
        name: "云南卫视",
        group: "卫视",
        channelID: "2025561303",
        livePID: "600190402",
        definition: "fhd",
        tvgID: "云南卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/ynws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "shanxiws",
        name: "山西卫视",
        group: "卫视",
        channelID: "2025560803",
        livePID: "600190407",
        definition: "fhd",
        tvgID: "山西卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/shanxiws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "gsws",
        name: "甘肃卫视",
        group: "卫视",
        channelID: "2025561703",
        livePID: "600190408",
        definition: "fhd",
        tvgID: "甘肃卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/gsws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "qhws",
        name: "青海卫视",
        group: "卫视",
        channelID: "2025559103",
        livePID: "600190406",
        definition: "fhd",
        tvgID: "青海卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/qhws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "xizangws",
        name: "西藏卫视",
        group: "卫视",
        channelID: "2025558003",
        livePID: "600190403",
        definition: "fhd",
        tvgID: "西藏卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/xizangws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "xjws",
        name: "新疆卫视",
        group: "卫视",
        channelID: "2019927403",
        livePID: "600152138",
        definition: "fhd",
        tvgID: "新疆卫视",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/xjws.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "cetv1",
        name: "CETV-1",
        group: "卫视",
        channelID: "2022823801",
        livePID: "600171827",
        definition: "fhd",
        tvgID: "CETV1",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/cetv1.png",
        quality: "1080p候选",
        note: "",
    },
    {
        id: "guoxue",
        name: "国学频道",
        group: "卫视",
        channelID: "2029360403",
        livePID: "600213139",
        definition: "fhd",
        tvgID: "国学",
        logo: "https://garysclub.sharewithyou.dpdns.org/logos/ysp-live-logos/guoxue.png",
        quality: "1080p候选",
        note: "",
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
    "zhejiangws": "zjws"
};

// ---- 频道工具 -------------------------------------------------------------
var bk = createBKProtocol();

function findChannel(id) {
    var raw = String(id || "").replace(/^ysp:\/\//i, "").split("/")[0];
    if (!raw) return null;
    for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].id === raw) return CHANNELS[i];
    return null;
}

function channelCard(ch) {
    return {
        vod_id: ch.id,
        vod_name: ch.name,
        vod_pic: ch.logo,
        vod_remarks: ch.quality,
        vod_duration: ch.group,
        ext: { id: ch.id },
    };
}

function pageOf(items, page, per) {
    var p = parseInt(page, 10);
    if (!(p >= 1)) p = 1;
    var start = (p - 1) * per;
    return items.slice(start, start + per);
}

// ---- XPTV 入口：五个全局函数 ----------------------------------------------
// 全部返回 jsonify(...) 的 JSON 字符串，与 bililive.js / douyu.js 等社区扩展一致。

async function getConfig() {
    return jsonify({
        ver: "20261025",
        title: "央视频",
        site: "https://www.yangshipin.cn",
        tabs: [{ name: "全部", ext: { tab: "all" }, ui: 1 }],
    });
}

async function getCards(ext) {
    var arg = argsify(ext);
    return jsonify({ list: pageOf(CHANNELS.map(channelCard), arg.page, 20) });
}

async function getTracks(ext) {
    var arg = argsify(ext);
    var channel = findChannel(arg.id);
    if (!channel) return jsonify({ list: [] });
    return jsonify({
        list: [{ title: "BK", tracks: [{ name: "BK", pan: "", ext: { id: channel.id } }] }],
    });
}

async function getPlayinfo(ext) {
    var arg = argsify(ext);
    var channel = findChannel(arg.id);
    if (!channel) return jsonify({ urls: [], headers: [] });
    var result = await bk.resolve(channel);
    if (!result.ok || !result.candidates.length) {
        log("BK resolve failed: " + channel.id + "; " + (result.error || "no url"));
        return jsonify({ urls: [], headers: [], msg: result.error || "解析失败" });
    }
    return jsonify({
        urls: result.candidates,
        headers: result.candidates.map(function () { return result.headers; }),
    });
}

async function search(ext) {
    var arg = argsify(ext);
    var key = String(arg.text || "").trim().toLowerCase();
    if (!key) return jsonify({ list: [] });
    var items = CHANNELS.filter(function (ch) {
        var aliasHit = Object.keys(ALIASES).some(function (a) {
            return ALIASES[a] === ch.id && a.indexOf(key) !== -1;
        });
        return (
            aliasHit ||
            ch.id.indexOf(key) !== -1 ||
            ch.name.toLowerCase().indexOf(key) !== -1 ||
            ch.tvgID.toLowerCase().indexOf(key) !== -1
        );
    }).map(channelCard);
    return jsonify({ list: pageOf(items, arg.page, 20) });
}
