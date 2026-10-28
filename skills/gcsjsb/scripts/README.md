# 编译桥接与 demo 对拍

## SJOOP 桥接

```powershell
node sjoop_bridge.cjs --help
node sjoop_bridge.cjs --config assignment.local.json --check-config
node sjoop_bridge.cjs --config assignment.local.json --output runs/result.json
```

配置可为单个目标，或 `{ "defaults": { ... }, "targets": [{ "id": "one", ... }] }`。每个目标继承 defaults，并可显式覆盖 `course` 和 `selectedCompilers`。相对路径按配置所在目录解析。省略 `course` 时为 `gaocheng`，仅支持 `gaocheng`、`oop`。

高程默认 `msvc`、`mingw`；OOP 默认再加 `linux`。高程选择 Linux 时立即失败。所有目标先检查，再加载扩展和开始编译；`--check-config` 不加载扩展，不读取私钥，不联网。

使用本机已安装的 SJOOP Assistant，必要时通过 `--extension DIR` / `SJOOP_EXTENSION_DIR` 指定扩展目录，通过 `--typescript PATH` / `SJOOP_TYPESCRIPT_PATH` 指定 TypeScript 模块。脚本没有 npm 依赖，但扩展及其自身依赖须完整安装。当前接口适配基于 0.1.7。

部分 Windows MinGW 工具链无法向包含中文的绝对路径链接产物。若日志提示无法打开输出文件，将 `workspaceRoot` 设置为不含中文的构建目录，例如 `C:/temp/shenjian-build`；源文件仍可保留原位置。

Linux 的 host、studentId、privateKeyPath 可在 `sshConfig` 中设置，也可分别通过 `SJOOP_SSH_HOST`、`SJOOP_STUDENT_ID`、`SJOOP_PRIVATE_KEY_PATH` 提供。口令仅通过 `SJOOP_KEY_PASSPHRASE` 提供。示例在技能目录的 `examples/` 中，本地配置命名为 `*.local.json`。

## Python 验证器

只使用 Python 标准库。实际 demo 和真实 `txt_compare` 由使用者提供，可显式指定路径或将比较器加入 PATH。

```powershell
python demo_compare.py selftest
python demo_compare.py probe --txt-compare C:/tools/txt_compare.exe --out-dir runs/probe
python demo_compare.py run --program C:/bin/answer.exe --demo C:/demo/reference.exe --tests cases.json --txt-compare C:/tools/txt_compare.exe --out-dir runs/answer
```

测试集为 UTF-8 JSON：

```json
{
  "name": "assignment",
  "cases": [
    { "id": "normal", "stdin": "1\n" },
    { "id": "boundary", "stdin": "0\n", "timeout": 2 }
  ]
}
```

`--encoding cp936` 用于诊断显示，`--input-encoding cp936` 用于编码输入，`--timeout 3` 为每次运行超时。原始 stdout/stderr 以二进制保存，不重写换行。demo 缓存根据启动参数、启动程序 SHA256、输入和工作目录建立；demo 或远端程序变动时使用新的 `--demo-cache` 目录。

OOP 中可用 `--program-argv-file linux-argv.local.json` 替代 `--program`，例如：

```json
["ssh", "-T", "student@oop.example.edu", "/home/student/bin/answer"]
```

启动数组直接传给 `subprocess.run(..., shell=False)`，测试输入通过 stdin 传入。此处 SSH 用户名由使用者填写；桥接脚本的 SJOOP 用户名规则见 OOP 参考文档。通用比较器本身不判断课程，远程启动由技能的 OOP 流程约束；SJOOP Linux 编译入口另外在代码中检查课程模式。

每例保存原始输入、双方 stdout/stderr、退出码、耗时、比较器输出和首个差异。最终判定调用 `txt_compare --file1 actual.txt --file2 demo.txt --trim right`；保留空行、CRLF/LF/CR 和末尾换行。不使用全局 `strip()`、分词或浮点容差。已适配 2.0.4 中文判定文本，该版本不能仅凭退出码判断相同。
