# 安全策略

## 报告漏洞

如果您发现安全漏洞，请**不要**提交公开 Issue。

请发送邮件至项目维护者，或通过 GitHub 的 **[私人漏洞报告](https://github.com/yujiangxian/nuwa/security/advisories/new)** 功能提交。

我们将在 48 小时内确认收到您的报告，并在 7 天内提供修复计划。

## 支持版本

| 版本 | 支持 |
|------|------|
| master (最新) | :white_check_mark: |

## 安全最佳实践

- 所有 API 请求都有 50MB 大小限制
- 敏感配置文件 (`config.json`, `.env`) 已被 `.gitignore` 排除
- 源代码不包含硬编码密钥、密码或 token
- 每个推送前运行 pre-push hook 自动扫描凭证泄露
- CI 流水线包含 TypeScript 类型检查、cargo check 和测试

## 依赖项

- 前端: `npm audit` 零漏洞 (axios ^1.18, react-router ^7.18)
- 后端: `cargo update` 保持依赖版本最新
- GitHub Dependabot 已启用，自动扫描并提醒漏洞

## 披露流程

1. 漏洞报告者私下提交漏洞
2. 维护者在 48 小时内确认
3. 在 7 天内发布修复
4. 修复发布后，根据漏洞严重程度决定是否发布公开公告
