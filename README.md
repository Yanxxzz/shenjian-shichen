# 神剑的使臣

面向 **高程（高级语言程序设计）和 OOP（面向对象程序设计）** 的 AI 作业技能与验证工具。先确认当次题目限制，再实现、编译和对拍，保留真实验证结果。

关键词：高程 · gaocheng · OOP · C / C++ · GBK · demo 对拍

## 已有能力

- 从 PPT、PDF、题目和附件框架提取逐题限制，避免沿用旧章节的知识点白名单。
- 保留指定函数、预置数据、变量数量和行数限制，按课程要求交付 GBK 源程序。
- 复用 Python 验证器运行 demo 和待测程序，保存原始输入、输出、退出码、超时与首个差异。
- 对接用户已安装的 SJOOP Assistant，支持 MSVC、MinGW；**Linux SSH 编译验证仅对 OOP 模式开放**。
- 使用真实 `txt_compare --trim right` 判定，保留行首、行中空白、空行和换行差异。

## 安装技能

将 `skills/gcsjsb` 文件夹复制到你的 Agent 技能目录，例如 `~/.codex/skills/gcsjsb`。重启或刷新技能列表后调用：

```text
使用 $gcsjsb 完成这次高程作业，先阅读题目和附件，确认限制后再写代码。
```

```text
使用 $gcsjsb 完成这次 OOP 作业，并用 OOP 专用的 Linux 验证功能检查。
```

技能入口为 [SKILL.md](skills/gcsjsb/SKILL.md)，通用约定见 [REQUIREMENTS.md](skills/gcsjsb/REQUIREMENTS.md)。

## 课程模式

配置中的 `course` 支持 `gaocheng` 和 `oop`，省略时使用 `gaocheng`。

- `gaocheng`：默认选择 MSVC 和 MinGW；请求 `linux` 会在加载扩展、编译或连接服务器之前报错。
- `oop`：默认选择 MSVC、MinGW、Linux，也可显式只选本地编译器。启用 Linux 时须提供自己的 SSH 配置。
- 批量配置逐题检查模式，任何题目配置无效时，整批不会开始执行。

不会根据源文件扩展名、当前工作目录或是否安装 SJOOP 来自动开启 Linux。课程由本次题目和用户说明确认；不明确时保持本地模式。

```powershell
# 复制示例为本地配置，调整源文件、编译器路径和课程模式
Copy-Item skills/gcsjsb/examples/gaocheng.example.json skills/gcsjsb/examples/assignment.local.json

# 只检查配置，不加载 SJOOP，也不编译或联网
node skills/gcsjsb/scripts/sjoop_bridge.cjs --config skills/gcsjsb/examples/assignment.local.json --check-config

# 执行配置中的编译验证
node skills/gcsjsb/scripts/sjoop_bridge.cjs --config skills/gcsjsb/examples/assignment.local.json --output runs/result.json
```

OOP Linux 配置和连接说明见 [oop-linux.md](skills/gcsjsb/references/oop-linux.md)。对拍命令和测试集格式见 [scripts/README.md](skills/gcsjsb/scripts/README.md)。

## 运行要求与自检

Python 3.10+ 用于对拍；Node.js 18+ 用于桥接脚本及其测试。编译桥接还需要自行安装 SJOOP Assistant、TypeScript 运行库和对应编译器。可通过 `--extension`、`--typescript` 指定位置；缺少依赖时会明确报错。

```powershell
python skills/gcsjsb/scripts/demo_compare.py selftest
node --test tests/course-mode.test.cjs
```

这些自检验证比较器逻辑和课程模式边界，不会连接课程服务器。实际作业仍需使用自己的 demo、比较器和编译器执行完整验证。

## 来源与许可

本项目将已有 `gcsjsb` 作业流程、Python 对拍器和独立桥接脚本整理为通用技能包，使用 [MIT License](LICENSE)。

SJOOP Assistant 是独立的第三方 VS Code 扩展。本仓库通过本机已安装扩展的接口调用它，不包含其源码、安装包或授权材料；第三方软件仍遵循各自许可。当前桥接适配基于 SJOOP Assistant 0.1.7 的接口，其他版本需实际验证。

作业题目、教师课件、课程 demo、个人答案、连接凭据及运行记录由使用者在本机提供，不随技能包分发。
