# Q3考高斯刷题

面向小学奥数教研、教师备课和阶段复习的多端刷题系统。当前题库包含 479 道题、932 个题图引用，支持 Windows、macOS、Android 和自建网页服务。

## 主要功能

- 分年级、章节、篇目和数学模块刷题；
- 可配置的顺序与随机训练；
- AI 分步精讲、拍照识别和本地解析兜底；
- 错题本、艾宾浩斯复习、排行榜与学情战报；
- 自动组卷、A4 PDF、高清长图、CSV 与系统分享；
- 坚果云 WebDAV 多端同步、冲突合并和可恢复软删除；
- 200+ 数学家名言随机轮播。

## 本地开发

```bash
npm install
npm run dev
```

## 质量检查

```bash
npm test
npm run lint
npm run build
```

## 多端构建

```bash
# Windows 个人桌面版（可读取 .env.local）
npm run desktop:dist

# Android 个人版
npm run cap:apk

# 完整内部发布材料：嵌入统一运行配置并逐个平台解包审计
npm run release:internal
```

内部构建会把 `.env.local` 中的坚果云账号、应用密码和 AI API Key 写入各平台包体，适合受控内部设备，不得公开分发。凭据不会写入说明文档、截图、校验报告或 Git 跟踪文件。macOS 两种架构均自带运行时；网页包可自动检测或下载 Node.js、启动浏览器并创建桌面快捷方式。

最终材料位于：

`output/release/Q3考高斯刷题_v1.0.0_内部发布材料_最终版/`

详细进展、测试结果和维护说明见 `HANDOVER.md`。
