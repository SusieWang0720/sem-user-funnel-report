# 项目约定

## 目录结构

- `scripts/`：保留现有 Python 命令行清洗逻辑，作为规则参考与兼容入口。
- `web/`：Vercel 前端应用，Excel 解析、清洗和导出全部在浏览器执行。
- `web/src/lib/`：可测试的漏斗规则与 Excel 读写模块。
- `web/src/components/`：页面组件；不在组件内复制业务规则。
- `web/tests/`：浏览器端规则的单元测试。

## 数据与安全

- 不提交真实 Excel、UIN 清单、补充查询结果或生成报表。
- 不把用户文件上传到服务端，不增加数据库、日志采集或第三方分析 SDK。
- 批次特定的删除 UIN 不得硬编码；由页面让用户选择保留或排除。

## 命名与清理

- JavaScript 文件使用 `kebab-case.js`，React 组件使用 `PascalCase.jsx`。
- 临时预览、测试输出和真实业务文件不进入仓库。
- 删除文件前先确认；构建产物 `dist/` 可由命令重新生成，不提交。

## 验证

前端改动后在 `web/` 运行：

```bash
npm run test
npm run build
```

发布前必须完成真实文件回归和浏览器主流程检查。GitHub 推送与 Vercel 部署需单独确认。
