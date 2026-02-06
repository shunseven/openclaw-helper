# OpenClaw Helper 快速开始

## 一键安装 (推荐)

```bash
curl -fsSL https://raw.githubusercontent.com/shunseven/openclaw-helper/main/install.sh | bash
```

安装脚本会自动:
1. ✓ 安装系统依赖 (Node.js, Git, Homebrew)
2. ✓ 安装 cpolar (SSH 隧道)
3. ✓ 安装 OpenClaw
4. ✓ 安装 OpenClaw Skills
5. ✓ 启动 Gateway 服务
6. ✓ 启动 Helper Web 服务
7. ✓ 自动打开配置页面

## 配置流程

### 步骤 1: 选择模型

安装完成后,浏览器会自动打开配置页面: `http://127.0.0.1:17543`

选择您要使用的模型提供商:

#### 选项 A: MiniMax (需要 API Key)
1. 选择 "MiniMax"
2. 输入您的 MiniMax API Key
3. 点击"下一步"

#### 选项 B: GPT (OAuth 登录)
1. 选择 "GPT"
2. 点击"下一步"
3. 系统会自动启动 OAuth 登录流程

#### 选项 C: 千问 (OAuth 登录)
1. 选择 "千问"
2. 点击"下一步"
3. 系统会自动启动 OAuth 登录流程

### 步骤 2: 配置 Telegram (可选)

页面会显示详细的图文指南,帮助您:

#### 1. 找到 BotFather
- 在 Telegram 搜索 `@BotFather`
- 确认有蓝色认证标记
- 点击 Start

#### 2. 创建机器人
- 发送 `/newbot` 命令
- 设置机器人名称 (例如: My Assistant)
- 设置用户名 (必须以 `bot` 结尾,例如: my_assistant_2026_bot)

#### 3. 复制 Token
- BotFather 会发送 HTTP API Token
- 格式类似: `123456789:ABCDefghIJKLmnopQRSTuvwxYZ`
- 点击复制

#### 4. 获取用户 ID
- 搜索 `@username_to_id_bot`
- 发送消息获取您的用户 ID

#### 5. 填写信息
- 在配置页面输入 Bot Token
- 输入用户 ID
- 点击"完成配置"

或者点击"跳过"稍后配置。

### 步骤 3: 完成配置

配置完成后,您会看到成功页面,可以:

1. **打开 Dashboard** - 点击按钮直接访问 OpenClaw Dashboard
2. **测试 Telegram** - 在 Telegram 中向您的机器人发送消息
3. **查看日志** - 运行 `tail -f ~/.openclaw/logs/gateway.log`

## 访问地址

| 服务 | 地址 |
|------|------|
| Helper 配置页面 | http://127.0.0.1:17543 |
| OpenClaw Dashboard | http://127.0.0.1:18789 |

## 常见问题

### 如何重新配置?

访问 Helper 配置页面: http://127.0.0.1:17543

### 如何查看日志?

```bash
# Gateway 日志
tail -f ~/.openclaw/logs/gateway.log

# Helper 服务日志
tail -f /tmp/openclaw-helper.log
```

### 如何重启服务?

```bash
# 重启 Gateway
pkill -f 'openclaw.*gateway' && openclaw gateway run --bind loopback --port 18789 &

# 重启 Helper
lsof -ti :17543 | xargs kill -9
cd ~/openclaw-helper && npm start
```

### 端口被占用怎么办?

```bash
# 查看端口占用
lsof -i :17543
lsof -i :18789

# 释放端口
lsof -ti :17543 | xargs kill -9
lsof -ti :18789 | xargs kill -9
```

### 如何启动 SSH 隧道?

```bash
# 前台运行
cpolar tcp 22

# 后台运行
nohup cpolar tcp 22 > /tmp/cpolar.log 2>&1 &
```

## 开发模式

如果您想参与开发或本地调试:

```bash
# 克隆项目
git clone https://github.com/shunseven/openclaw-helper.git
cd openclaw-helper

# 安装依赖
npm install

# 启动开发服务
npm run dev

# 或者使用 dev 参数运行安装脚本
./install.sh dev
```

## 下一步

配置完成后,您可以:

1. 📚 阅读 [OpenClaw 文档](https://docs.openclaw.ai)
2. 💬 在 Telegram 中测试您的机器人
3. 🚀 开始使用 OpenClaw 的各种功能
4. 🔧 根据需要调整配置

## 需要帮助?

- 查看 [README.md](./README.md) 了解更多详细信息
- 提交 [Issue](https://github.com/shunseven/openclaw-helper/issues)
- 查看 [OpenClaw 官方文档](https://docs.openclaw.ai)
