# Filesystem（URI + Providers + Guardrails）

本文档定义 OpenCove 的文件系统能力如何被建模、暴露与约束，以确保：

- Desktop / CLI / Web / Remote 可以复用同一套语义与门禁
- 文件访问不会退化为“到处传 string path + 随手读写”
- 未来引入 remote worker / 多 mount / 插件系统时不会反复重构

## 1. 核心原则

- **URI-first**：文件定位必须使用 `uri`（例如 `file:`），而不是在 UI/IPC/CLI 中散落 `string path`。
- **Provider 模型**：文件读写通过 `FileSystemPort`（provider）承载，允许未来扩展到 remote/virtual schemes。
- **Guardrails 强制**：
  - **Approved Roots**：默认只允许访问“已批准路径”之下的文件（见 `ApprovedWorkspaceStore`）。
  - **（可选）Scope**：在 Space/Mount 语义稳定后，文件访问应进一步收缩到执行上下文 scope（避免越界）。
- **控制面优先**：对外能力应通过 Control Surface（Command/Query）暴露；Desktop 的 IPC transport 也应复用同一套 usecases 与校验逻辑。

## 2. 概念模型

### 2.1 URI

OpenCove 当前阶段至少支持：

- `file:`：本地文件系统（例如 `file:///Users/name/repo/README.md`）

> 约束：任何 `uri` 必须可被稳定解析，并在 guardrails 允许范围内。

### 2.2 Provider（FileSystemPort）

文件系统能力在 application 层以端口建模：

- `readFileText`
- `writeFileText`
- `readDirectory`
- `stat`

端口定义：`src/contexts/filesystem/application/ports.ts`  
本地实现：`src/contexts/filesystem/infrastructure/localFileSystemPort.ts`

## 3. Control Surface Contracts（稳定对外形状）

Control Surface 提供以下操作（Command/Query）：

- `filesystem.readFileText`（query）
- `filesystem.writeFileText`（command）
- `filesystem.readDirectory`（query）
- `filesystem.stat`（query）

对应 DTO：`src/shared/contracts/dto/filesystem.ts`

统一返回 envelope：`src/shared/contracts/controlSurface/result.ts`

## 4. Guardrails（安全与一致性门禁）

### 4.1 Approved Roots（必须）

任何读写必须检查目标路径是否在 approved roots 内：

- 典型错误码：`common.approved_path_required`
- 目的：避免“本机任意路径读写”成为默认能力

### 4.2 Scope（建议，逐步收口）

当 filesystem 被用于 Space/Mount 的执行上下文时，应额外检查：

- 目标 `uri` 必须位于该上下文的 `scope.rootUri/rootPath` 之内

目的：

- 保证 Space Boundary 的“只收缩不扩张”可被实现
- 为 multi-mount / remote / 插件权限奠定正确约束

## 5. Desktop 集成约束（Renderer/Main）

- Renderer 不应自行实现文件访问规则，也不应绕过 guardrails。
- Renderer 侧的 `window.opencoveApi` 暴露应保持“薄”：只做参数与结果映射，不写业务规则。
- 文件操作失败必须通过结构化错误语义返回，调用方禁止依赖错误字符串做分支判断。

## 6. 测试建议（最低有效回归）

- Unit：
  - URI 解析与规范化（尤其 Windows path/UNC）
  - guardrails（approved roots / scope enforcement）
- Contract：
  - Control Surface 的输入校验与错误码稳定
- E2E：
  - 从 UI 打开文件、编辑、保存后，文件内容确实变化
  - 未批准路径应被拒绝且 UI 可解释

