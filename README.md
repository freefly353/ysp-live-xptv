# YSP Live for XPTV — 央视频直播 v2.1.1

央视频（Yangshipin）直播，XPTV / TVBox `csp` 格式的 JS 扩展。64 个频道（央视 30 + 卫视 34），点播时现算签名地址播放。

## 文件

- `ysp-live-xptv.js` — 扩展本体（2,907 行）。以用户提供的 Ysp_Xptv_1.0.0.txt 为底，在 v2.0.0 修正版上加了 v2.1.0 的自动换源与 v2.1.1 的重新解析。
- `subscription.json` — 单站点订阅（type 3 / api `csp_ysp` / ext 为本文件 raw 链接），可直接当 XPTV 订阅地址。

## 怎么用

直接把本仓库的 `subscription.json` 当订阅地址加进 XPTV：

```
https://raw.githubusercontent.com/freefly353/ysp-live-xptv/main/subscription.json
```

或在自己的订阅 JSON 里加一个 `type: 3` 的站点：

```json
{"name": "央视频", "type": 3, "api": "csp_ysp",
 "ext": "https://raw.githubusercontent.com/freefly353/ysp-live-xptv/main/ysp-live-xptv.js"}
```

## 能播什么

- **Device（电视投屏源）**：26 个频道有 Device LIVE_ID（CCTV-1~17 缺 6、CCTV-4K/8K/16-4K、CGTN 及其 5 个语种/纪录频道），auto 模式优先走 Device，支持高码率。Device 的加密（AES-256-GCM、RSA-OAEP-SHA256、TEA/cKey、MD5/SHA）全是文件自带的纯 JS 实现，不依赖 Node.js crypto，所以在 XPTV 的 JavaScriptCore 里能跑。
- **BK（播控源）**：全部 64 个频道都支持。卫视没有 Device LIVE_ID，只能走 BK。
- **没有 JCE**：JCE 需要 gzip + 二进制 JCE/QMF 编解码，XPTV 里没有现成的纯 JS 实现，所以本版没有 JCE，也没有 7 天回看。

## v2.1.0 的自动换源（针对卫视源时好时坏）

卫视“有时能播有时不能播”的原因是 BK 首选地址当时不可用（解析成功但播放 403），而旧版只在解析抛错时才回退，解析成功但地址坏了就直接返回坏地址。v2.1.0 在点播前实测播放地址：用播放请求头拉一次 m3u8，看正文是不是真正的播放列表（`#EXTM3U`）；首选地址不可用时自动换备线，Device 地址不可用时自动退回 BK；BK 解析失败重试一次。校验是 fail-open 的：校验请求本身失败（网络问题）时仍返回原地址，让播放器再试。

频道表与 BK 签名已与 JSTV 版（[ysp-live-spider](https://github.com/freefly353/ysp-live-spider)）逐项核对：64 个台的 id / channelID / livePID / definition 零差异，BK 的 PLATFORM / APP_VERSION / TEA_KEY / 请求参数 / 候选地址排序也一致。

v2.1.1 补充：BK 候选地址全部不可用时，重新向上游要一份新地址（新签名）再试一次。JSTV 里清后台重开能修好，是因为它清掉了内存里的旧状态；XPTV 里清后台重开修不好，说明坏的是上游当时给的地址，不是本地状态——所以改为重新解析一次，而不是只换备线。

## 验证状态

- 本机用 XPTV host 垫片（`$fetch`/`$cache`/`argsify`/`jsonify`）跑通过：`getConfig` / `getCards`（64 台）/ `getTracks` / `getPlayinfo` / `search` 均正常；TEA 向量与 NanoTV 原版逐字节一致；并模拟了 BK 首选地址 403（自动换备线）、BK 上游偶发失败（重试成功）、Device 失败回退 BK。
- 真实上游与真机 XPTV **尚未验证**。XPTV 没有官方文档，格式是按社区扩展代码反推的，需在真机上验证。

## 来源

转换自同一作者的 JSTV 版：https://github.com/freefly353/ysp-live-spider —— 频道表与 BK 签名与该版本一致。原始脚本：Gary's Club ysp-live v9.5（Python）。
