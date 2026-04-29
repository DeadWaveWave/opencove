# Space Explorer（Space 内文件浏览器）

Space Explorer 是吸附在 Space 边界上的轻量文件浏览器，用来完成一条 Canvas-first 的最小闭环：

- 在 Space 内浏览/创建文件与文件夹
- 点击文件在画布创建/聚焦节点（文本文件为 Document Node，图片为 Image Node）
- 文件访问统一走 `filesystem` 能力，并强制 approved roots 门禁（见 `docs/FILESYSTEM.md`）

## 1. 打开方式（入口）

- 在 Space 左上角点击 `Files` pill（文件夹图标）即可打开/关闭 Explorer
- 若当前目录是 Git 仓库且存在未提交变更，`Files` pill 会显示一个低噪音的变更计数提示
- Explorer 打开后按 `Esc` 可关闭
- 当对应 Space 离开视口（Space 不可见）时，Explorer 会自动关闭

## 2. 根目录与边界（当前实现）

- Explorer 的根目录来自 `space.directoryPath`（Landing 兼容字段），并映射为 `file:` 的 `rootUri`
- Explorer 仅展示 `rootUri` 之下的条目（越界条目会被过滤）
- 当前为 single-mount 形态：一个 Space 对应一个根目录

## 3. 文件树交互（VS Code 语义）

- 点击文件夹：展开/折叠其子项
- 点击文件：在画布内创建或聚焦对应节点（见下节）
- 支持选中态（selected row）以便后续的创建操作确定目标目录
- 顶部操作：
  - `New File`：创建空文件
  - `New Folder`：创建文件夹
  - `Refresh`：刷新目录（当前无 FS watcher，依赖手动刷新）

创建位置规则：

- 如果选中的是文件夹：在该文件夹下创建
- 如果选中的是文件：在该文件所在目录创建
- 没有选中项：在根目录创建

## 4. 打开文件的节点行为

### 4.1 文本文件：Document Node

- 绑定文件 `uri` 作为 durable truth，内容从 filesystem 读取并写回磁盘
- 支持行号显示
- 支持自动保存（debounce）与显式保存（`Cmd/Ctrl+S` 或点击 `Save`）
- 当文件疑似二进制或过大时，会显示“无法作为文本编辑”的说明并禁用编辑

详见 `docs/DOCUMENT_NODE.md`。

### 4.2 图片文件：Image Node

- 图片会被读取为 bytes，并写入 workspace 的 canvas 资产，然后以 Image Node 的形式显示
- 当前不在画布内直接编辑图片文件本身（Image Node 是“查看/对照”用）

### 4.3 音视频文件：媒体预览 + Doc Node 播放

- 点击支持范围内的音视频文件时，Explorer 会先在 Space 侧边预览面板里显示可播放媒体
- 双击文件会将其物化为 Doc Node 风格的媒体窗口，仍绑定原始文件 `uri`
- 当前按 VS Code 内建 `media-preview` 范围对齐，支持：
  - 音频：`mp3`、`wav`、`wave`、`ogg`、`oga`
  - 视频：`mp4`、`webm`
- 当前能力仅覆盖 Desktop 的本地 workspace 文件 / 本地 mount；browser runtime 与 remote mount 仍明确不支持二进制媒体预览

## 5. 布局与可用性细节

- Explorer 是 Space 内部的悬浮面板（overlay），不随画布缩放而缩放
- Explorer 右侧支持拖拽调整宽度
- 从 Explorer 打开文件时，节点会优先放置在 Explorer 的右侧，避免被面板遮挡

## 6. 相关文档

- Filesystem：`docs/FILESYSTEM.md`
- Document Node：`docs/DOCUMENT_NODE.md`
