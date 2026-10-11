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

## Explicit Mutation Options

`writeFileText` / `writeFileTextInMount` accept optional `overwrite`; `false`
uses exclusive creation, while `true` replaces or creates the file. Omitting the
flag preserves the existing overwrite behavior. `deleteEntry` / `deleteEntryInMount`
accept optional `recursive`; an explicit value requests permanent deletion and
`false` rejects a nonempty directory. Omitting it preserves the existing UI trash
and fallback behavior. Desktop IPC and Control Surface normalize the same options.

Before forwarding explicit options, the mount router queries
`filesystem.mutationCapabilities` on the target Worker. An older Worker which does
not advertise these semantics is rejected before the write/delete; never silently
forward flags to a provider which could ignore them. Plugin APIs additionally
require explicit booleans and disallow mutating their target working directory
itself; see [plugin filesystem access](../plugins/FILESYSTEM.md).

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
- Space Explorer 使用 Space 的 `targetMountId`；新建的文件/文件夹节点使用自己的 `workerBinding`。
- 显式本地绑定的 `mountId: null` 表示本机，不能在移动到远程 Space 后继承远端 mount。旧文档缺少绑定时兼容读取所属 Space 的 mount。
- 远端绑定缺少 mount，或 mount API 不可用时，显示不可用；不得回退读取同名本机路径。

## Directory Windows And Canvas References

- 从浏览器拖文件到画布背景创建 Document Node；拖文件夹创建初始折叠的 Folder Node。创建的是引用，不调用 move/copy，不改变磁盘结构。
- 文件夹图标以鼠标释放位置为中心；碰撞使用当前可见节点尺寸，不能被折叠窗口的隐藏展开区域推走。窗口的展开尺寸仍独立持久化。
- `application/x-opencove-filesystem-entry` 携带来源 URI、浏览边界与 mount；接收方校验协议、URI 边界、mount target 与实际文件类型。浏览器内部拖放仍由原来的文件移动操作处理。
- Folder Node 的持久化 owner 是 workspace node data：`uri` 为当前目录，`rootUri` 为固定导航边界，`viewMode` 为 `icons | list`，`expandedDirectoryUris` 为列表展开偏好。导航只更新目录与标题，不替换 node ID，不合并已打开的同目录窗口。
- 图标模式按“目录优先、名称自然排序”固定网格排列，单击文件夹进入目录。列表模式为可展开的目录树：单击文件夹整行或箭头都只展开/收起，不改变当前位置；双击、Enter 或右键「打开」显式进入目录。
- Explorer 根目录标题显示来源 Space 名称，进入子目录后显示当前目录名；标题旁不重复显示 Space 信息。Folder Node 始终以当前目录名为标题。
- 底部路径以 `/` 分隔，点击祖先路径即可返回，最远回到来源根目录，不额外放置上一级按钮。路径超宽或窗口缩窄时自动将当前目录滚入视野，仍可手动横向滚动。图标/列表切换位于标题栏关闭按钮左侧，保留当前目录和树展开偏好。
- 每段路径均可右键复制对应目录的相对或绝对路径，不改变当前目录。文件/文件夹节点的展开态和折叠态右键菜单也提供两种路径复制：文件夹相对来源 `rootUri`，文档相对绑定 mount root 或本地所属 Space/项目目录；本机根外路径允许 `../`，不同 Worker 不得回退到本机路径。
- 搜索默认为图标，点击或 Cmd/Ctrl+F 展开；失焦收回但保留筛选，图标显示筛选提示。工具栏固定单行，窄窗口搜索展开时平滑隐藏其他操作并移出键盘焦点，失焦后恢复。
- 导航保留窗口外壳、路径栏与内容容器的 DOM 身份；仅目录数据和临时交互状态随路径切换，避免整窗闪动。
- Explorer 位置随所属 Space 的实时展示坐标移动（包含父 Space 拖动的投影），不等持久化坐标提交才跟随；偏移与手动尺寸仅由该窗口拥有。边缘与四角复用节点缩放手柄，缩放保持对侧边缘不动，并将屏幕位移按画布缩放还原。
- 折叠文件/文件夹只显示图标和名称，不显示父目录副标题；完整位置由展开后的路径导航提供。
- 文件夹窗口复用 Explorer 的 CRUD、剪贴板、键盘与打开文档保护。目录变更使旧列表请求和临时操作失效；项目切换/卸载后不能发布未完成的拖放结果。
- 初始折叠存储在客户端视图偏好，窗口展开尺寸保持在节点数据中；布局与 Space 归属不得修改 filesystem URI 或 Worker 绑定。

## Native Desktop Drop

- Electron 桌面允许将系统文件管理器中的多个文件或文件夹拖到画布，创建初始折叠的引用节点；不复制或移动源文件。占位与碰撞使用统一的 `112 × 96` 可见尺寸，原始展开尺寸独立保存。
- Preload 通过 `webUtils.getPathForFile` 读取真实系统拖入的路径；人工构造的浏览器 `File` 不能授予本机文件权限。Main 校验应用窗口、主 frame 与应用来源后，执行 stat 并仅批准实际拖入的文件或文件夹，不批准其父目录或相邻文件。原生拖入文件夹的导航根就是该目录；访问其父级需要用户另行选择或拖入。
- 原生拖放始终使用本机 approved-roots owner；即使当前画布连接远程 Worker，也不能将本机路径授权转发到远端。新节点显式绑定本机；同批节点保留初始落点的 Space 归属。
- Web UI 无法从系统拖放取得可靠的本机绝对路径，目前对此显示桌面端提示。Web UI 的既有图片导入与应用内文件树拖放仍使用各自原有路径。
- 拖放跨异步路径解析或类型检查时，工作区切换、组件卸载会取消剩余创建。

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
