# Changelog

所有重要更新都记录在此文件中。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [1.0.16] – [1.0.19] - 2026-06

### 变更（架构转向）
- **GSAV 原生外壳**：新增基于 `react-native-webview` 的原生外壳，加载独立的 GSAV 4DGS 托管 Web 应用（路由 `/watch/:id`、`/gsav/:id`、`/gsav-diagnostics`；原生桥协议见 `utils/gsavBridge.ts`，含运行时校验与单元测试）。
- **B 站客户端冻结**：因收到哔哩哔哩律师函，B 站相关功能停止迭代，仅作学习参考保留。
- Expo SDK 55 / React Native 0.83 兼容性调整。
- 安全：将 Sentry Auth Token 移出 `eas.json`、取消跟踪 `.env`。

> 注：1.0.16–1.0.19 未逐版本记录细节；GSAV 落地进度以 [GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md](GSAV_4DGS_HOSTING_IMPLEMENTATION_CHECKLIST.md) 为准。

---

## [1.0.15] - 2026-03-26

### 新增
- **UP主主页**：视频详情页点击 UP 主名称可进入创作者主页（`/creator/[mid]`），展示头像、简介、粉丝数、投稿数及视频列表（分页加载）
- **缓存管理**：设置页新增「存储」区块，实时显示缓存大小，支持一键清除 expo-image 磁盘/内存缓存及通用缓存目录

### 优化
- **性能**：封面图全面改用 `expo-image`（内存/磁盘两级缓存，`recyclingKey` 复用 UI 树节点）；FlatList 开启 `removeClippedSubviews`；`buvid3` 改为懒初始化，首屏加载快约 30ms
- **搜索体验**：搜索结果列表高亮命中词（HTML 标签过滤）；空态增加图标+文案；防抖 300ms 减少无效请求
- **深色模式**：修补设置页遗漏的硬编码颜色，外观/流量切换按钮、退出登录按钮全部跟随主题
- **登录安全**：SESSDATA 迁移至 `expo-secure-store` 加密存储（Web 降级 AsyncStorage）

### 修复
- **登录后头像不更新**：将 `getUserInfo()` 移入 `authStore.login()`，延迟 1s 后台执行，避免触发 B 站新会话并发风控，登录完成后头像立即刷新
- **getFollowedLiveRooms 登录后返回空**：`login()` 内同步调用 `getUserInfo` 导致 `FollowedLiveStrip` 并发请求被 B 站风控拦截；改为 `setTimeout(1000)` 非阻塞后台拉取修复
- **getUploaderVideos 无数据**：`/x/space/wbi/arc/search` 需要 WBI 签名，补全 `getWbiKeys()` + `signWbi()` 调用
- **getFollowedLiveRooms 字段兼容**：新增 `code !== 0` 校验及 `list ?? rooms ?? []` 兼容不同 API 版本返回结构

---

## [1.0.13] - 2026-03-25

### 修复
- **小窗 PanResponder 闭包过期**：`useRef(PanResponder.create(...))` 捕获初始 `roomId=0` / `bvid=""`，导致点击小窗跳转到错误页面；改用 `storeRef` 模式保持最新值
- **直播小窗进入详情无限 loading**：`useLiveDetail` 使用 `cancelled` 闭包标志，effect cleanup 后 fetch 被静默丢弃；改用 `latestRoomId` ref 比对替代 cancelled 模式
- **进入播放器页面小窗不关闭**：视频/直播详情页进入时通过 `useLayoutEffect` + `getState().clearLive()` 同步清除小窗，避免双播和资源竞争
- **BigVideoCard 与直播小窗冲突**：首页 BigVideoCard 自动播放与直播小窗竞争解码器资源；小窗活跃时跳过 Video 渲染，仅显示封面图
- **退出全屏视频暂停**：互斥渲染后竖屏播放器重新挂载，react-native-video seek 后不自动恢复播放；`onLoad` 中强制 `paused` 状态切换触发播放

### 优化
- **视频播放器单实例**：竖屏/全屏互斥渲染（`{!fullscreen && ...}` / `{fullscreen && ...}`），不再同时挂载两个 Video 解码器，减半 GPU/内存占用
- **onProgress 节流**：`progressUpdateInterval` 从 250ms 调为 500ms，回调内增加 450ms 节流和 seeking 跳过，减少重渲染
- **移除调试日志**：清理 NativeVideoPlayer 中遗留的 `console.log`
- **下载页 UI 优化**：下载管理页交互和暗黑主题适配

---


## [1.0.12] - 2026-03-25

### 新增
- **UP主信息**：视频详情页博主名称下方展示粉丝数和视频数（`getUploaderStat` → `/x/web-interface/card`）
- **视频相关推荐**：详情页推荐列表改为基于当前视频（`getVideoRelated` → `/x/web-interface/archive/related`），不再与首页 feed 共用

### 修复
- **直播全屏退出暂停**：全屏改用 `position:absolute` 覆盖，Video 组件始终在同一棵 React 树中，不再因 Modal 切换导致重建暂停；退出全屏时直播自动暂停
- **直播画质选中**：`changeQuality` 强制用请求的 `qn` 覆盖服务端协商值，画质面板高亮与用户选择一致
- **直播画质过滤**：过滤 `qn > 10000` 的选项（杜比/4K），最高仅展示原画
- **推荐视频导航**：点击推荐列表改用 `router.replace`，避免详情页无限堆叠

### 优化
- **直播画质面板**：改为居中 Modal 弹出框
- **视频详情 Tab**：按钮向左靠齐，移除均分宽度
- **评论排序按钮**：统一为实心背景风格（`#f0f0f0` → `#00AEEC`），与直播分区 Tab 一致
- **设置页按钮**：外观/流量选项按钮统一为实心背景风格

## [1.0.11] - 2026-03-24

### 新增
- **暗黑模式**：全局主题系统（`utils/theme.ts`），支持亮色 / 暗色一键切换，覆盖所有页面和组件
- **节流模式**：设置页新增流量节省开关，开启后使用低画质封面、首页视频不自动播放、视频默认 360p 画质
- **本地二维码生成**：登录二维码改用 `react-native-qrcode-svg` 本地渲染，移除对 `api.qrserver.com` 的外部依赖，提升可靠性

### 修复
- **SeasonSection 背景色**：合集组件背景色与父容器不一致，现跟随主题色 (`theme.card`) 正确显示
- **推荐列表 Loading 状态**：空列表加载中未显示 spinner（`ListEmptyComponent` 条件逻辑反转）
- **合集滚动定位偏移**：`getItemLayout` offset 计算未计入卡片间距（`gap: 10`），导致 `scrollToIndex` 定位不准
- **推荐视频卡片双边框**：相邻推荐视频卡片之间出现双分割线

## [1.0.0] — 2026-03-20

### 首个正式版本

#### 视频播放
- DASH 完整播放：Bilibili DASH 接口 → `buildDashMpdUri()` 生成本地 MPD → ExoPlayer 原生解码
- 支持多清晰度切换（360P / 480P / 720P / 1080P / 1080P+ / 4K）
- BigVideoCard 首页内联 DASH 静音自动播放，支持水平手势快进、进度条/缓冲条
- 全局迷你播放器（MiniPlayer），切换页面后底部浮层续播
- WebView 降级方案（NativeVideoPlayer），兼容 Expo Go 环境

#### 直播
- 直播 Tab 顶部显示关注主播在线状态
- 双列直播卡片网格 + 横向分区筛选
- 热门列表中穿插直播推荐卡片
- LivePlayer 支持 HLS 多画质切换
- 直播弹幕 WebSocket 实时接收，舰长标记 + 礼物计数

#### 弹幕系统
- 视频弹幕：XML 全量拉取 + 时间轴同步 drip 渲染
- DanmakuOverlay 飘屏覆盖层（5 车道滚动）
- DanmakuList 支持实时直播模式（保留最近 500 条）

#### 搜索 & 内容
- 视频关键词搜索 + 分页加载
- 视频详情：简介 / 评论 / 弹幕 三 Tab
- 推荐视频流（无限滚动）
- 评论列表（热评 / 最新排序切换）

#### 账号 & 设置
- 扫码登录（二维码 + 2s 轮询 + SESSDATA 自动提取）
- 登录态持久化（AsyncStorage）
- 封面图清晰度设置（高清 / 普通，节省流量）

#### 下载 & 分享
- 多清晰度视频后台下载
- 下载管理页（播放、删除已下载视频）
- 局域网 HTTP 服务器，生成 QR 码分享，同 Wi-Fi 设备扫码直接播放

#### 跨平台
- Android、iOS、Web 三端支持
- Expo Go 扫码快速运行（UI 预览模式）
- Dev Build 完整功能（DASH 原生播放）
