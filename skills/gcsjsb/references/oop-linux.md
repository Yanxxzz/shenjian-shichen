# OOP 专用 Linux 验证

仅在当前任务明确属于 OOP，且需要远程编译验证时使用此功能。高程任务不进行 SSH 连接、远程上传或 Linux 编译。

## 配置与调用

自行安装 SJOOP Assistant，并准备课程认可的 Linux 主机、学号、SSH 私钥和相应网络。仓库不提供账号或密钥，也不修改 VPN、代理或系统网络设置。

将技能目录中的 `examples/oop.example.json` 复制为被 Git 忽略的 `*.local.json`，填写自己的实际信息；或者通过环境变量提供 `SJOOP_SSH_HOST`、`SJOOP_STUDENT_ID`、`SJOOP_PRIVATE_KEY_PATH` 和可选的 `SJOOP_KEY_PASSPHRASE`。示例中的 `oop.example.edu` 等为占位信息，不能直接用于真实连接。以下命令从仓库根目录运行；单独安装技能后，按实际安装路径调整。

```powershell
node skills/gcsjsb/scripts/sjoop_bridge.cjs --config skills/gcsjsb/examples/oop.local.json --check-config
node skills/gcsjsb/scripts/sjoop_bridge.cjs --config skills/gcsjsb/examples/oop.local.json --output runs/oop-result.json
```

必须设置 `"course": "oop"` 才能选 `linux`。省略课程默认为 `gaocheng`；高程配置显式加入 `linux` 会报错，不会静默忽略，也不会尝试连接。批量配置中所有目标先通过检查，才开始任何编译。

`sshConfig.host` 和 `studentId` 为必填信息，不内置课程服务器或个人标识。相对私钥路径按配置文件所在目录解析。扩展按 `u{studentId}` 构造 SSH 用户名，详见本机 SJOOP 的设置。不在 JSON 或日志中写入密钥内容或口令；口令通过环境变量提供。

## 检查结果

保留每个目标的编译命令、编译日志、退出状态和原始运行输出。桥接脚本报告编译和扩展测试状态；零警告要求仍须检查编译日志。Linux 失败时记录实际错误，不用本地结果代替远程验证，不标记为通过。

需要逐例 demo 对拍时，比较器可以接受 SSH 启动命令数组。仅在 OOP 流程中使用远程命令，参见 `scripts/README.md`。SSH 最后的命令使用事先确定的可执行文件路径，不拼接测试输入；输入通过 stdin 传递。
