# 贡献指南 · Contributing Guide

感谢你考虑为 diveo 做贡献！

---

## 开发环境搭建

### 推荐方式：Dev Build（完整功能）

```bash
git clone https://github.com/你的用户名/diveo.git
cd diveo
npm install
npx expo run:android   # 需要连接 Android 设备或启动模拟器
```

Dev Build 支持 DASH 原生播放（react-native-video），是开发视频播放功能的必选方式。

### Expo Go 模式（快速验证 UI）

```bash
npm install
npx expo start
```

适合开发 UI 组件、导航、弹幕列表等不依赖原生视频解码的功能。

### Web 端

```bash
npx expo start --web
```

Web 端图片防盗链需要本地代理，在单独终端启动：

```bash
node scripts/proxy.js   # 监听 localhost:3001
```

---

## 提交规范（Conventional Commits）

请遵循以下格式：

```
<type>(<scope>): <描述>

[可选正文]
```

| type | 含义 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构（不改变功能） |
| `docs` | 文档更新 |
| `chore` | 构建脚本、依赖更新等 |
| `style` | 代码格式（不影响逻辑） |
| `perf` | 性能优化 |

示例：

```
feat(danmaku): 添加弹幕字体大小设置
fix(player): 修复 DASH MPD 解析在 Android 12 上崩溃的问题
docs: 更新 README 快速开始步骤
```

---

## PR 提交流程

1. Fork 本仓库并创建功能分支：`git checkout -b feat/your-feature`
2. 在本地完成开发并测试
3. 提交符合规范的 commit
4. 发起 Pull Request，填写模板中的说明
5. 等待 Code Review

---

## 注意事项

- **禁止**在代码中硬编码任何账号信息（SESSDATA、uid 等）
- **不接受**涉及自动化批量操作、绕过 B 站反爬的 PR
- 新增功能请优先开 Issue 讨论，避免重复劳动
- 涉及 API 参数变更时，请同步更新 `services/bilibili.ts` 中的注释
- **注释 / 字符串语言规范**：新增代码请使用英文注释与英文用户可见字符串（与现有 GSAV 代码一致）；旧 B 站代码中的中文注释保持原样，不必批量改写。
  Comment/string language policy: write new code with English comments and
  English user-facing strings (matching the GSAV code); leave legacy Bilibili
  Chinese comments as-is.

---

## 问题反馈

- Bug 报告：[提交 Issue](https://github.com/你的用户名/diveo/issues/new?template=bug_report.yml)
- 功能建议：[提交 Feature Request](https://github.com/你的用户名/diveo/issues/new?template=feature_request.yml)
- 使用问题：优先在 [Discussions](https://github.com/你的用户名/diveo/discussions) 提问
