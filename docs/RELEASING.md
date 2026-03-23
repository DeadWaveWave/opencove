# Releasing / Packaging

## 本地打包

- 生成安装包：`pnpm build:mac`
- 生成 Windows 安装包：`pnpm build:win`
- 生成 Linux 安装包：`pnpm build:linux`
- 生成“明确不签名”的安装包：`pnpm build:mac:unsigned`

产物默认在 `dist/`：
- `*.dmg`
- `*-mac.zip`
- `*.exe`
- `*.AppImage` / 其他 Linux 包格式（取决于 electron-builder 实际输出）

## 发布渠道

本项目当前只区分两个发行渠道：

- `stable`：给普通用户安装的正式版，使用纯版本 tag，如 `v0.2.0`
- `nightly`：给你自己和早期测试者抢先试用的预发布版，使用带 nightly 后缀的 tag，如 `v0.2.0-nightly.20260312.1`

建议的判断标准：

- 发布 `nightly`
  - `main` 上有值得提前验证的新功能、重构或高风险修复
  - 你想先给少量测试者试，不想立刻推荐给所有人
- 发布 `stable`
  - 这批改动已经过你自己的实际使用验证
  - `pnpm pre-commit` 全绿
  - 你能清楚说明这次更新为什么值得普通用户安装

## GitHub：打 Tag 自动打包（unsigned）

本仓库已配置 GitHub Actions：当你 push 形如 `v*` 的 tag 时，会自动构建 `macOS / Windows / Linux` 三端产物，并自动创建对应的 GitHub Release。无需手动打包或手动上传产物。上传内容包括：
- macOS 产物（如 `*.dmg`, `*.zip`）
- Windows 产物（如 `*.exe`）
- Linux 产物（如 `*.AppImage`）
- 汇总校验文件 `SHA256SUMS.txt`

其中：

- `v0.2.0` 会创建正式 `stable` release
- `v0.2.0-nightly.20260312.1` 会创建 `nightly` prerelease

### Stable 流程

流程建议：

1) 用脚本准备版本与 changelog 模板

```bash
pnpm release:patch
# 或
pnpm release:minor
# 或显式版本
pnpm release:version 0.2.0
```

2) 填好 `CHANGELOG.md` 新增版本段落
   - 若本次为 `major` 或 `minor` 版本（例如 `0.1.0 -> 0.2.0`、`0.x -> 1.0.0`），必须补一段 `### ✨ Highlights`
   - 若本次为 `patch` 版本（例如 `0.2.0 -> 0.2.1`），不强制要求 `Highlights`
3) 更新 README 顶部的 `Important Announcement / 重要公告`，用 1-3 句短文概括这次对外想传达的重点
4) 运行 `pnpm pre-commit`
5) 提交 release 准备改动到 `main`
6) 创建并 push tag

```bash
git tag v0.2.0
git push origin main --tags
```

如需先预览下一版而不落盘：

```bash
node scripts/prepare-release.mjs 0.2.0 --dry-run
```

### Nightly 流程

`nightly` 默认不改 `package.json` 版本号，也不要求更新 `CHANGELOG.md`。它的作用是把当前 `main` 的某个快照发给测试者。
只有 `stable` release 才需要在仓库里 bump `package.json.version`；`nightly` 只是开发快照，不是新的正式版本承诺。
但为了让应用内更新检测能正确比较版本，CI 在构建 nightly tag 时会临时把 `package.json.version` 改成对应的 nightly tag 版本；这个改动只发生在 CI 构建目录，不会回写仓库。

推荐流程：

1) 确认当前 `main` 已经推到远端
2) 用当天日期 + 递增序号创建 nightly tag

```bash
git tag v0.2.0-nightly.20260312.1
git push origin v0.2.0-nightly.20260312.1
```

约定建议：

- 同一天第一次 nightly 用 `.1`
- 同一天第二次 nightly 用 `.2`
- 如果下一次 stable 准备发 `v0.2.1`，nightly 也可以提前切到 `v0.2.1-nightly.20260313.1`

补充说明：

- `stable` 路径可以先运行 `pnpm release:version 0.2.0`，自动更新 `package.json` 和 `CHANGELOG.md` 模板。
- `prepare-release` 会在 `major / minor` 版本自动插入 `✨ Highlights` 模板；`patch` 版本不会插入。
- `nightly` 路径不需要运行 release 准备脚本；只要 push 合规 tag，CI 就会自动打包并发布 GitHub prerelease。
- Auto Update 依赖 release assets 中的 channel metadata（如 `latest.yml` / `nightly.yml`），GitHub Actions 会随构建一起上传。

## Nightly 定时发布（每天 04:00 北京时间）

仓库提供一个定时任务：每天北京时间 `04:00` 自动从 `main` 打包并发布最新 `nightly`（GitHub prerelease）。

- Workflow: `.github/workflows/nightly.yml`
- Tag 形如：`v<package.json.version>-nightly.<YYYYMMDD>.<N>`

## 未签名/未公证的安装说明（给用户）

当前 Release 构建未做 Apple Developer ID 签名/公证，macOS 可能会拦截首次打开。

可选处理方式：
- Finder：右键 App → 打开 → 再次确认
- 或终端（拷贝到 Applications 后）：`xattr -dr com.apple.quarantine /Applications/OpenCove.app`

## 后续启用签名 + 公证（可选）

当你开通 Apple Developer Program 后，可以在 CI 中注入签名证书与 notarize 凭据，让 Release 自动完成签名与公证。
