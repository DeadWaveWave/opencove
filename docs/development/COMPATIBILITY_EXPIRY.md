# 兼容路径与到期门禁（Compatibility Expiry）

兼容代码仍会被调用，静态“死代码”工具（knip）看不到它。它只会在它所服务的条件消失后才变成死代码，所以必须把这个条件记下来，并让 CI 在条件消失时失败。本文定义规则；检查脚本是 `scripts/check-compat-expiry.mjs`（`pnpm compat:check`）。

`pnpm compat:check` 属于 `pnpm verify:repo`：本地的 `pnpm verify:quick` / `pnpm pre-commit` 和 CI 的 `Repository checks` 步骤都会运行它。它只读文件、只影响 CI 的结论，**不改变任何运行时行为**。

## 1. 什么算兼容路径

读取旧版本写下的数据、为旧 Worker / 旧 endpoint / 旧客户端保留的回退、保留旧错误形状的校验器、清理旧版本留在用户机器上的残留、适配第三方工具旧版本的分支，以及临时的 kill switch。判断标准不是名字，而是“删掉它会不会让某个仍然存在的旧状态失效”。

## 2. 注册表

`src/shared/compat/compatRegistry.json` 是**唯一**记录原因和到期条件的地方，由仓库 owner 维护（包括 `upgradeSupport` 和每一次续期）。

```json
{ "upgradeSupport": { "floor": "0.1.0", "reviewBy": "0.7.0", "decidedIn": "#642" },
  "entries": {
    "storage-cove-m0-keys": { "kind": "user-data", "expires": { "dataBefore": "0.3.0" },
      "reason": "…", "decidedIn": "#642" } } }
```

| 字段 | 含义 |
| --- | --- |
| `kind` | `user-data`、`machine-residue`、`peer-version`、`wire`、`third-party`、`kill-switch` 之一 |
| `expires.until` | `package.json` 的 `version` 达到或超过该版本时到期 |
| `expires.dataBefore` | `upgradeSupport.floor` 达到或超过该版本时到期（“不再支持从该版本之前写下的数据升级”） |
| `reason` | 这条路径为什么存在；`third-party` 必须写出涉及的外部版本 |
| `decidedIn` | 做出（或续期）该决定的 issue / PR；创建和每次续期都必须更新 |
| `upgradeSupport.floor` | 仍必须能升级的最老 OpenCove 版本；今天是 `0.1.0`，与 `SUPPORTED_INSTALLED_UPGRADE_SOURCE_VERSIONS` 覆盖的 schema 1..14 一致 |
| `upgradeSupport.reviewBy` | floor 这个决定本身的到期版本 |

规则：

- **只用版本，不用日期。** 版本检查只取决于提交里的文件，同一个提交永远得到同一个结果；日期会让 `main` 在某一天无代码改动地变红。发布节奏约每月一个 minor，所以一个 minor 约等于一个月。
- **没有 `never`。** 每条路径要么绑定一个版本，要么绑定 floor。
- `until` 最多只能比 `package.json` 当前版本大 3 个 minor（当前 `0.5.x` 时最晚 `0.8.0`），防止用一个遥远的版本让条目永不到期；超出会以 `invalid-expiry` 失败。不接受“下一个主版本 `.0.0`”之类不受距离限制的值：那会让 `1.0.0` 成为所有条目最省事的写法，等于取消这条限制；结束时间确实更远的条目，到期时续期即可，每次续期都是一次有记录的决定。`dataBefore` 只允许 `user-data` 和 `machine-residue` 两种 kind 使用，其他 kind 一律用 `until`，否则同样以 `invalid-expiry` 失败。
- 运行时与 wire 兼容（混合版本的 Worker / 客户端 / endpoint、旧 Control Surface 输入处理、旧 PTY 几何 revision）默认 `until` 为两个 minor 之后；当前默认是 `0.7.0`。
- 数据迁移（`user-data`、`machine-residue`）用 `dataBefore`，只有 owner 提高 floor 才会到期，**不会**因为随手写的日期到期。floor 每个发布周期复查一次（`reviewBy`）。
- 到期之后只有两个选择：删除这条路径，或带着新的 `reason` 和 `decidedIn` 续期。续期的 diff 应出现在发布准备 PR 中。

## 3. 在代码里标记

- `// @compat <id>` 写在被覆盖的声明、语句、对象属性、展开项、类型成员或参数的**正上方一行**（之间可以夹 JSDoc / 注释，但不能有空行）；覆盖范围是下一个 AST 节点的完整范围。联合类型成员前的 `|` 不算节点，标记写在 `|` 所在行之上即可。
- `/* @compat <id> */` 写在同一行、紧贴被覆盖的表达式之前（例如 `a ?? /* @compat <id> */ legacyValue`），只覆盖它后面的那个节点；用于只有一小段是兼容代码的行。标记写在 `&&`、`||`、`??` 链或条件表达式的开头时，只覆盖第一项（条件表达式覆盖其条件）。
- **标记只能覆盖兼容部分。** 不要把标记放在仍然活着的函数或语句上；如果一段活代码里只有一个属性、一个参数或一个分支是兼容代码，把标记移到那一项上。
- `// @compat-file <id>` 写在文件前 5 行内，覆盖整个文件。**只用于整个文件都是兼容代码的情况**（例如 `legacyManagedHookCleanup.ts`、`migrate.ts`、旧校验器 oracle）。检查脚本无法发现在这类文件里新加入的无关兼容代码，需要 reviewer 把关。
- 类型锚点在编译期（`pnpm check`）生效：`defineLegacyOperation` 必须带 `compat: CompatId`；设置 `legacyNormalize` 时也必须带 `compat`；`compat` 必须是注册表里存在的 id（`CompatId` 来自 `src/shared/compat/compatId.ts`）。只有传给 `defineOperation` / `defineLegacyOperation` 的对象里的 `compat: '<id>'` 才算锚点：它算注册表条目的使用，并只覆盖 `compat` 属性、同一对象里的 `legacyNormalize` 属性，以及 `defineLegacyOperation` 这个调用名。任何其他对象里的 `compat` 属性只是普通属性，不覆盖任何信号。`compat` 不会进入运行时的 operation 对象（`defineOperation` 会去掉它）。`defineOperation.compat.spec.ts` 里的 `@ts-expect-error` 用例由 `pnpm check` 检查。
- 不属于兼容代码但命中了关键词的地方，**改措辞**而不是加标记。

## 4. 检查什么

`pnpm compat:check` 扫描 `src/**/*.{ts,tsx}`（非测试、非 `.d.ts`）、`tests/support/controlSurfaceLegacyOracles/` 和六个 `tests/unit/contexts/controlSurface.*Parity.spec.ts`（它们必须带 `@compat-file`，否则以 `parity-spec-unmarked` 失败），在以下情况失败，并给出文件、行号和 id：

| 编号 | 规则名 | 含义 |
| --- | --- | --- |
| a | `expired` | 条目已到期，或 `reviewBy` 已到期 |
| b | `unknown-id` | 标记或 `compat:` 锚点引用了不存在的 id |
| c | `stale-entry` | 注册表条目没有被任何标记或锚点使用 |
| d | `missing-field` / `invalid-version` / `invalid-kind` / `invalid-expiry` / `invalid-id` | `reason`、`decidedIn` 缺失或为空，版本不合法，`kind` 或到期形式不合法 |
| e | `feature-flag-unmarked` | `src/shared/featureFlags/` 下的文件没有 `@compat-file` |
| f | `oracle-unmarked` | oracle 文件没有标记 |
| g | ratchet | 未被标记覆盖的兼容信号超过 `scripts/compat-ratchet.json` 基线（也包括低于基线但没有更新基线） |

信号是匹配 `legacy`、`deprecated`、`backwards compat…`、`compat` / `compatibility`（作为词）的标识符或注释，`cove:m0:` 字符串，`clientFeatures.` 读取（`defineLegacyOperation` 和 `legacyNormalize` 本身含 `legacy`，因此也被计入）。import 语句不计。基线只会下降：某个文件的计数下降时，用 `node scripts/check-compat-expiry.mjs --update-ratchet` 在同一个改动里更新基线。`--update-ratchet` 按规则总数与合并基线（`git merge-base HEAD origin/main`）上的基线比较：任一规则总数上升或规则消失就拒绝写入，除非用 `--accept-rise <规则>` 点名并在 PR 描述的 `## 📈 Ratchet rises` 段落里给出理由（见 `DEVELOPMENT.md` 的“棘轮基线守卫”）；文件间移动或重命名但总数不变则允许。比较对象始终是合并基线上的文件，不是磁盘上的文件，所以删除或手改基线文件不会改变拒绝与否：基线文件在合并基线上不存在时，每条总数大于 0 的规则都是一次上升；合并基线上有文件时，删除后重新生成只要总数不超过合并基线就允许。扫描到 0 个文件时不会写入基线。信号列表是安全网而不是围墙：真正的保证来自类型锚点、目录规则（`featureFlags/`、oracle）和 review。设计上“加一行标记”比“改标识符绕开关键词”更便宜。

命名检查（`scripts/check-naming.mjs`）只在 `compat:check` 扫描的文件里跳过 `cove:m0:`，该前缀在这些文件里由本检查负责；在同一行写 `legacy` 不再能让它通过。其他文件（测试、e2e 等）里出现 `cove:m0:` 仍然是命名违规。

选项：

- `--at <version>`：按某个未来版本评估，不读取 `package.json` 的版本。
- `--report`：列出在下一个 minor 到期的条目和所有文件级标记，不会失败。周期内用它提前看到要到期的路径。
- `--update-ratchet`：重写基线；总数相对合并基线上升或规则消失时拒绝，`--accept-rise <规则>`（可重复，只能和它一起用）点名接受。

## 5. 发布前

`node scripts/prepare-release.mjs <target>` 在修改版本号之前，用 `--at <target>` 运行本检查。例如 `node scripts/prepare-release.mjs 0.7.0 --dry-run` 会在还有 `until: "0.7.0"` 条目时失败并列出它们，因此发布在准备阶段被拦下，而不是在发布 PR 的 CI 里。

## 6. 新增或续期一条路径

1. 在注册表里加条目：`kind`、到期条件、`reason`、`decidedIn`。
2. 在代码里加 `@compat` / `@compat-file` 或 `compat:` 锚点。
3. 新增 SQLite migration 或持久化格式兼容时，必须有 `user-data` 条目（见 `docs/architecture/PERSISTENCE.md`）。
4. 续期：改 `until`（或在 owner 决定后提高 `floor`），同时更新 `reason` 与 `decidedIn`。
5. 删除路径时，同时删除条目、所有标记，以及它独占的测试（例如 `control-surface-legacy-validation` 对应的 oracle 文件和 parity specs）；只删条目会因 (b) 失败，只删标记会因 (c) 失败。
