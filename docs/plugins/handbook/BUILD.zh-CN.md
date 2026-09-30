# 用 Hello Clock 制作第一个插件

从当前安装版本附带的可运行示例开始。你可以自己按步骤操作，也可以把指南交给 Agent。


## 1. 找到匹配的指南

```sh
opencove plugin guide
```

这条离线命令会返回 README 和文档目录的路径，不会启动应用或 Worker。
打开 README，再将 `examples/hello-clock` 复制到自己可写的目录。
不要直接修改应用包或指南缓存中的文件。

## 2. 了解最小组成

| 文件 | 职责 |
| --- | --- |
| `opencove.plugin.json` | 标识与能力声明 |
| `index.html`、`view.js`、`style.css` | 响应式窗口内容 |
| `main.mjs` | 可选的 Node 后端 |
| `README.md`、`icon.svg` | 说明文档与插件图标 |

视图使用主机注入的 `window.opencovePlugin` SDK，先等待 `api.ready`。
脚本与样式放在独立文件中。OpenCove 已经提供标题栏、缩放手柄、收起与关闭控件。

## 3. 安装并试用示例

保持目标运行环境开启，然后执行：

```sh
opencove plugin install /absolute/path/to/hello-clock --pretty
opencove plugin details hello-clock --pretty
```

在设置 → 插件中打开 **Hello Clock**，启动预览，试试 **Read clock** 和标签输入框。
预览使用示例时间戳与临时数据。

接着，在项目画布中创建真实的 Hello Clock 窗口。此时 **Read clock** 会调用 Node 后端。
保存一个标签，关闭窗口后重新创建，标签应该仍然存在。
**Add one** 用于验证单独保存的计数器；收起再展开窗口，可确认视图计时仍在继续。

## 4. 改成自己的工具

修改复制后的源文件中的标签或样式，再运行：

```sh
opencove plugin reload hello-clock
```

重新查看详情，检查新的修订版本。要制作另一个插件，请更换小写 manifest ID、名称和说明，
再以新身份安装。重新加载不能改变插件 ID。

## 5. 分享前验证

检查浅色与深色主题、窄窗口、键盘操作、重新加载、停用与启用，以及完整的应用重启。
确认承诺保存的数据没有丢失，预览操作没有影响真实数据，并正确展示加载、空白与错误状态。

继续阅读 [API 参考](../API.md)、[设计系统](../VISUAL_DESIGN.md)和
[开发验收清单](../AUTHORING.md#acceptance-evidence)。要接入 Agent 自动化，
请查阅[命令与 Skill](../COMMANDS.md)。完整技术参考目前使用英文。
