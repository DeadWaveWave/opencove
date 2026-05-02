# Filesystem

OpenCove 文件系统能力以 `uri + provider + guardrails` 建模。Desktop、CLI、Web UI 和 remote worker 都通过同一套 Control Surface contracts 访问文件，不直接在 UI 或脚本里散落 path 读写规则。

## Core Model

- **URI-first**：边界层传递 `file:` URI，不传裸 `string path` 作为业务身份。
- **Provider port**：application 层通过 `FileSystemPort` 读写文件；本地实现位于 `src/contexts/filesystem/infrastructure/localFileSystemPort.ts`。
- **Approved roots**：本机文件访问必须位于 approved roots 内。
- **Mount root**：mount-aware 文件访问必须位于对应 mount root 内。
- **Structured errors**：调用方依赖 `AppErrorDescriptor.code`，不得解析错误字符串。

当前公开支持的 URI scheme 是 `file:`。

## Control Surface Operations

普通本机文件操作：

- `filesystem.readFileText`
- `filesystem.readFileBytes`
- `filesystem.writeFileText`
- `filesystem.createDirectory`
- `filesystem.deleteEntry`
- `filesystem.copyEntry`
- `filesystem.moveEntry`
- `filesystem.renameEntry`
- `filesystem.stat`
- `filesystem.readDirectory`

Mount-aware 文件操作：

- `filesystem.readFileTextInMount`
- `filesystem.readFileBytesInMount`
- `filesystem.writeFileTextInMount`
- `filesystem.createDirectoryInMount`
- `filesystem.deleteEntryInMount`
- `filesystem.copyEntryInMount`
- `filesystem.moveEntryInMount`
- `filesystem.renameEntryInMount`
- `filesystem.statInMount`
- `filesystem.readDirectoryInMount`

DTO 定义位于 `src/shared/contracts/dto/filesystem.ts`，统一结果 envelope 位于 `src/shared/contracts/controlSurface/result.ts`。

## Mount Routing

`*InMount` 操作先通过 `mountId` 解析 mount target：

1. `mountTarget.resolve` 返回 `endpointId`、`rootPath`、`rootUri`。
2. 所有请求校验目标 `uri` 是否在 mount root 内。
3. `local` endpoint 额外校验 approved roots，然后调用本地 filesystem usecase。
4. `remote_worker` endpoint 将请求转发给远端 Worker 的普通 `filesystem.*` contract。

远端 mount 的 approved root 由远端 Worker 自己执行，Desktop 只负责 mount root scope 和远端调用路由。

## Renderer Integration

Renderer 不拥有文件访问规则：

- `window.opencoveApi.filesystem.*` 只做边界映射。
- Workspace 使用 `resolveFilesystemApiForMount(mountId)` 选择普通 filesystem 或 mount-aware filesystem。
- Space Explorer 和 Document Node 在存在 `targetMountId` 时走 `*InMount` 操作。

## Invariants

1. 文件内容真相在 filesystem，不在 workspace state。
2. Mount-aware 调用不得静默回退到非 mount-aware 本机 path。
3. 本机文件读写必须通过 approved roots。
4. Remote mount 文件读写必须由目标 Worker 执行，Desktop 不直接访问远端文件系统。
5. Copy / move / rename 同时校验 source 与 target。

## Verification Anchors

- Unit：URI normalize、approved roots、mount root scope。
- Contract：`tests/contract/controlSurface/controlSurfaceHttpServer.multiEndpoint.controlPlane.spec.ts`。
- E2E：`tests/e2e/m6.endpoints-mounts.integration.spec.ts` 与 Space Explorer / Document Node 文件用例。
