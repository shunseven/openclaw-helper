#!/usr/bin/env bash
set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${GREEN}[信息]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[警告]${NC} $1"
}

print_error() {
    echo -e "${RED}[错误]${NC} $1"
}

print_step() {
    echo -e "${BLUE}[步骤]${NC} $1"
}

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 配置 launchd 实现开机自启和崩溃重启 (macOS)
# 参数: $1 = label, $2 = 描述, $3+ = ProgramArguments
setup_launchd_service() {
    local LABEL="$1"
    local DESC="$2"
    shift 2
    local WORK_DIR="$1"
    shift
    local PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
    local LOG_DIR="${HOME}/.openclaw/logs"

    mkdir -p "${HOME}/Library/LaunchAgents"
    mkdir -p "$LOG_DIR"

    # 卸载已有的同名服务
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    sleep 1

    # 构造 ProgramArguments XML
    local ARGS_XML=""
    for arg in "$@"; do
        ARGS_XML="${ARGS_XML}        <string>${arg}</string>
"
    done

    # 自动探测 openclaw 路径并设置环境变量
    local OPENCLAW_PATH
    if command -v openclaw >/dev/null 2>&1; then
        OPENCLAW_PATH=$(command -v openclaw)
    elif [ -x "$HOME/.local/bin/openclaw" ]; then
        OPENCLAW_PATH="$HOME/.local/bin/openclaw"
    fi

    local ENV_XML=""
    if [ -n "$OPENCLAW_PATH" ]; then
        ENV_XML="    <key>EnvironmentVariables</key>
    <dict>
        <key>OPENCLAW_BIN</key>
        <string>${OPENCLAW_PATH}</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.local/bin</string>
    </dict>"
    fi

    cat > "$PLIST_PATH" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
${ENV_XML}
    <key>ProgramArguments</key>
    <array>
${ARGS_XML}    </array>
    <key>WorkingDirectory</key>
    <string>${WORK_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/${LABEL}.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/${LABEL}-error.log</string>
</dict>
</plist>
PLIST_EOF

    launchctl load "$PLIST_PATH"
    print_info "✓ ${DESC} 已配置为 launchd 管理 (开机自启 + 崩溃重启)"
    print_info "  plist: $PLIST_PATH"
}

# 管理 Helper 服务
manage_helper_service() {
    local MODE="${1:-production}"
    print_info "管理 OpenClaw Helper 服务 (模式: $MODE)..."
    
    local HELPER_DIR="${HOME}/openclaw-helper"
    local HELPER_PORT=17543
    local HELPER_LABEL="com.openclaw.helper"
    
    # macOS: 先卸载已有的 launchd 服务,防止 KeepAlive 干扰端口释放
    if [[ "$(uname)" == "Darwin" ]]; then
        launchctl unload "${HOME}/Library/LaunchAgents/${HELPER_LABEL}.plist" 2>/dev/null || true
        sleep 1
    fi
    
    # 检查端口占用
    if lsof -i :${HELPER_PORT} > /dev/null 2>&1; then
        print_warning "端口 ${HELPER_PORT} 已被占用,正在停止..."
        lsof -ti :${HELPER_PORT} | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    
    if [ "$MODE" = "dev" ]; then
        print_info "启动本地开发服务..."
        # 本地开发模式,假设当前目录就是项目目录
        if [ ! -f "package.json" ]; then
            print_error "当前目录不是有效的项目目录"
            exit 1
        fi
        
        npm run dev &
        print_info "✓ 开发服务已启动"
    else
        # 生产模式,从 GitHub 拉取代码(dist 已预构建,只装运行时依赖)
        if [ -d "$HELPER_DIR" ]; then
            print_info "更新现有项目..."
            cd "$HELPER_DIR"
            git fetch --all
            git reset --hard origin/main
            npm install --omit=dev
        else
            print_info "克隆项目仓库..."
            git clone https://github.com/shunseven/openclaw-helper.git "$HELPER_DIR"
            cd "$HELPER_DIR"
            npm install --omit=dev
        fi
        
        print_info "启动生产服务..."
        local NODE_PATH
        NODE_PATH=$(command -v node)

        local OPENCLAW_PATH
        if command -v openclaw >/dev/null 2>&1; then
            OPENCLAW_PATH=$(command -v openclaw)
        elif [ -x "$HOME/.local/bin/openclaw" ]; then
            OPENCLAW_PATH="$HOME/.local/bin/openclaw"
        fi

        if [[ "$(uname)" == "Darwin" ]]; then
            setup_launchd_service "$HELPER_LABEL" "Helper 服务" "$HELPER_DIR" "$NODE_PATH" "${HELPER_DIR}/dist/index.js"
        else
            if [ -n "$OPENCLAW_PATH" ]; then
                nohup env OPENCLAW_BIN="$OPENCLAW_PATH" "$NODE_PATH" dist/index.js > /tmp/openclaw-helper.log 2>&1 &
            else
                nohup "$NODE_PATH" dist/index.js > /tmp/openclaw-helper.log 2>&1 &
            fi
        fi
    fi
    
    # 等待服务启动
    print_info "等待 Helper 服务启动..."
    local MAX_WAIT=10
    local WAIT_COUNT=0
    local HELPER_STARTED=false
    
    while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
        
        if lsof -i :${HELPER_PORT} > /dev/null 2>&1; then
            HELPER_STARTED=true
            break
        fi
    done
    
    if [ "$HELPER_STARTED" = true ]; then
        print_info "✓ Helper 服务正在端口 ${HELPER_PORT} 上运行"
        print_info "✓ 访问地址: http://127.0.0.1:${HELPER_PORT}"
    else
        print_error "Helper 服务启动失败"
        print_error "查看日志: cat /tmp/openclaw-helper.log"
        return 1
    fi
}

# 检查并安装 OpenClaw
check_and_install_openclaw() {
    print_step "检查 OpenClaw 安装状态"
    if command_exists openclaw; then
        print_info "OpenClaw 已安装: $(openclaw --version)"
    else
        print_warning "未检测到 OpenClaw,开始安装..."
        print_info "执行官方安装脚本..."
        curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
        
        # 刷新 PATH 或检查安装结果
        if command_exists openclaw; then
             print_info "✓ OpenClaw 安装成功: $(openclaw --version)"
        else
             # 尝试 sourcing profile 或者提示用户
             print_warning "OpenClaw 安装脚本执行完毕，但当前 shell 可能未更新 PATH。"
             print_info "请确保 OpenClaw 已在 PATH 中。"
        fi
    fi
}

# 配置 OpenClaw
configure_openclaw() {
    print_step "配置 OpenClaw..."
    
    # 1. 配置 Gateway 模式 (必需!)
    print_info "配置 Gateway 模式为 local..."
    openclaw config set gateway.mode "local"
    
    # 2. 检查并生成 Token (如果不存在)
    local CONFIG_FILE="${HOME}/.openclaw/openclaw.json"
    local CURRENT_TOKEN=""
    if [ -f "$CONFIG_FILE" ] && command_exists python3; then
        CURRENT_TOKEN=$(python3 -c "
import json
try:
    with open('$CONFIG_FILE') as f:
        t = json.load(f).get('gateway',{}).get('auth',{}).get('token','')
    print(t, end='')
except Exception:
    pass
" 2>/dev/null || echo "")
    fi
    
    if [ -z "$CURRENT_TOKEN" ]; then
        print_info "生成新的 Gateway Token..."
        # 生成 48 个字符的随机字符串,只包含字母和数字
        local NEW_TOKEN=$(cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 48)
        openclaw config set gateway.auth.token "$NEW_TOKEN"
        export OPENCLAW_GATEWAY_TOKEN="$NEW_TOKEN"
        print_info "✓ Gateway Token 已生成"
    else
        print_info "✓ Gateway Token 已存在"
        export OPENCLAW_GATEWAY_TOKEN="$CURRENT_TOKEN"
    fi
    
    # 3. 设置模型合并模式
    openclaw config set models.mode "merge"
    
    # 4. 运行 doctor 自动修复
    print_info "运行 openclaw doctor 检查和修复配置..."
    openclaw doctor --yes --fix || true
    
    print_info "✓ 配置完成"
}

# 检查并启动 OpenClaw Gateway
check_and_start_gateway() {
    print_step "检查 OpenClaw Gateway 状态"
    
    # 检查是否已有 gateway 在运行
    if pgrep -f "openclaw.*gateway" > /dev/null 2>&1; then
        print_info "Gateway 已经在运行中 (PID: $(pgrep -f "openclaw.*gateway"))"
        return 0
    fi
    
    print_info "Gateway 未运行,正在启动..."
    
    # 检查端口是否被占用
    if lsof -i :18789 > /dev/null 2>&1; then
        print_warning "端口 18789 已被占用,尝试释放..."
        lsof -ti :18789 | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    
    # 创建日志目录
    local LOG_DIR="${HOME}/.openclaw/logs"
    mkdir -p "$LOG_DIR"
    local LOG_FILE="${LOG_DIR}/gateway.log"
    
    # 获取 Token (为了确保环境一致性)
    local CONFIG_FILE="${HOME}/.openclaw/openclaw.json"
    local CURRENT_TOKEN=""
    if [ -f "$CONFIG_FILE" ] && command_exists python3; then
        CURRENT_TOKEN=$(python3 -c "
import json
try:
    with open('$CONFIG_FILE') as f:
        t = json.load(f).get('gateway',{}).get('auth',{}).get('token','')
    print(t, end='')
except Exception:
    pass
" 2>/dev/null || echo "")
    fi
    
    if [ -n "$CURRENT_TOKEN" ]; then
        export OPENCLAW_GATEWAY_TOKEN="$CURRENT_TOKEN"
    fi
    
    # 启动 gateway (后台运行)
    # 使用 nohup 确保脚本退出后进程继续运行
    nohup openclaw gateway run --bind loopback --port 18789 > "$LOG_FILE" 2>&1 &
    local GATEWAY_PID=$!
    
    print_info "Gateway 已后台启动 (PID: $GATEWAY_PID), 等待就绪..."
    
    # 等待启动
    local MAX_WAIT=10
    local WAIT_COUNT=0
    local GATEWAY_STARTED=false
    
    while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
        
        # 检查进程是否还在运行
        if ! ps -p $GATEWAY_PID > /dev/null 2>&1; then
            print_error "Gateway 进程已退出,请检查日志: $LOG_FILE"
            return 1
        fi
        
        # 检查端口是否监听
        if lsof -i :18789 > /dev/null 2>&1; then
            GATEWAY_STARTED=true
            break
        fi
    done
    
    if [ "$GATEWAY_STARTED" = true ]; then
        print_info "✓ Gateway 启动成功"
        return 0
    else
        print_error "Gateway 启动超时"
        return 1
    fi
}

# 打开浏览器
open_browser() {
    local URL="$1"
    print_info "正在打开浏览器: $URL"
    
    if command -v open >/dev/null 2>&1; then
        # macOS
        open "$URL" 2>/dev/null || true
    elif command -v xdg-open >/dev/null 2>&1; then
        # Linux
        xdg-open "$URL" 2>/dev/null || true
    elif command -v start >/dev/null 2>&1; then
        # Windows (Git Bash)
        start "$URL" 2>/dev/null || true
    else
        print_warning "无法自动打开浏览器,请手动访问: $URL"
    fi
}

# 主函数
main() {
    print_info "开始 OpenClaw + Helper 安装流程"
    
    # 1. 检查并安装 OpenClaw
    check_and_install_openclaw
    
    echo ""
    
    # 2. 安装 OpenClaw Helper
    manage_helper_service "production"
    
    echo ""
    
    # 3. 配置 OpenClaw
    configure_openclaw
    
    # 4. 检查并启动 Gateway
    check_and_start_gateway
    
    echo ""
    
    # 5. 打开 Helper 页面
    open_browser "http://127.0.0.1:17543"
    
    echo ""
    echo -e "${GREEN}✓ 全部完成!${NC}"
}

main "$@"
