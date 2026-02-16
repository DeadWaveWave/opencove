# Releasing / Packaging

## macOS（本地打包）

- 生成安装包：`pnpm build:mac`
- 生成“明确不签名”的安装包：`pnpm build:mac:unsigned`

产物默认在 `dist/`：
- `*.dmg`
- `*-mac.zip`

## GitHub：打 Tag 自动打包（unsigned）

本仓库已配置 GitHub Actions：当你 push 形如 `v*` 的 tag 时，会自动在 macOS runner 上打包并创建 GitHub Release，上传：
- `dist/*.dmg`
- `dist/*.zip`
- `dist/SHA256SUMS.txt`

流程建议：

1) 更新 `package.json` 版本号并提交到 `main`
2) 创建并 push tag

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 未签名/未公证的安装说明（给用户）

当前 Release 构建未做 Apple Developer ID 签名/公证，macOS 可能会拦截首次打开。

可选处理方式：
- Finder：右键 App → 打开 → 再次确认
- 或终端（拷贝到 Applications 后）：`xattr -dr com.apple.quarantine /Applications/cove.app`

## 后续启用签名 + 公证（可选）

当你开通 Apple Developer Program 后，可以在 CI 中注入签名证书与 notarize 凭据，让 Release 自动完成签名与公证。
