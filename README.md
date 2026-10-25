# YSP Live for XPTV — 央视频直播

央视频（Yangshipin）直播，XPTV / TVBox `csp` 格式的 JS 扩展。64 个频道（央视 30 + 卫视 34），点播时现算签名地址播放。

## 文件

- `ysp-live-xptv.js` — 扩展本体（1,332 行）。频道表与 BK 签名代码逐字取自 JSTV 版（CatVod spider），未改动任何编号与签名算法。

## 怎么用

在 XPTV 的订阅 JSON 里加一个 `type: 3` 的站点：

```json
{"name": "央视频", "type": 3, "api": "csp_ysp",
 "ext": "https://raw.githubusercontent.com/freefly353/ysp-live-xptv/main/ysp-live-xptv.js"}
```

`ext` 也可以换成你自己的托管地址。XPTV 加载后调用文件的五个全局函数：`getConfig` / `getCards` / `getTracks` / `getPlayinfo` / `search`。

## 能播什么、不能播什么

- 全部 64 个频道走 **BK（播控）协议**直播。BK 是 JSTV 版的兜底来源，64 个台都支持。
- **没有 Device、没有 JCE**：XPTV 的 JS 环境（按社区扩展代码实测）只提供 `$fetch` / `$cache` / `argsify` / `jsonify` / `$config_str` / `createCryptoJS`（仅见过 MD5），没有 AES-GCM、RSA、gzip、定时器。所以 JSTV 版的另外两条线路搬不过来——Device（投屏设备协议）需要 AES-GCM + RSA-OAEP + 心跳定时器；JCE 需要 gzip + 二进制 JCE/QMF 编解码。因此 XPTV 版没有 Device 的 4K/8K 高码率，也没有 JCE 的 7 天回看。

## 验证状态

- 本机用 XPTV host 垫片（`$fetch`/`argsify`/`jsonify`）跑通过：`getConfig` / `getCards`（64 台，分页）/ `getTracks` / `getPlayinfo`（BK 上游用模拟数据）/ `search` 均正常；TEA/cKey 与 NanoTV 原版逐字节一致。
- 真实上游与真机 XPTV **尚未验证**。XPTV 没有官方文档，格式是按社区扩展代码（bililive.js / douyu.js 等）反推的，需在真机上验证。

## 来源

转换自同一作者的 JSTV 版：https://github.com/freefly353/ysp-live-spider —— 频道表与 BK 签名（TEA + cKey）与该版本逐字节一致。原始脚本：Gary's Club ysp-live v9.5（Python）。
