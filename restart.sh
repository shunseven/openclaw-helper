#!/bin/bash

# OpenClaw Helper 重启脚本 (用于自动升级后)

echo "🚀 重启 OpenClaw Helper..."

# 1. 停止旧进程
if lsof -i :17543 > /dev/null 2>&1; then
    echo "⚠️  端口 17543 已被占用，正在停止旧进程..."
    lsof -ti :17543 | xargs kill 2>/dev/null
    sleep 2
    if lsof -i :17543 > /dev/null 2>&1; then
        lsof -ti :17543 | xargs kill -9 2>/dev/null
        sleep 1
    fi
fi

# 2. 检查依赖 (智能安装)
NEED_INSTALL=false
if [ ! -d "node_modules" ]; then
    NEED_INSTALL=true
elif [ "package.json" -nt "node_modules" ]; then
    echo "📦 package.json 有更新，重新安装依赖..."
    NEED_INSTALL=true
fi

if [ "$NEED_INSTALL" = true ]; then
    echo "📦 安装依赖..."
    npm install
fi

# 3. 构建项目 (如果 dist 不存在)
if [ ! -f "dist/index.js" ]; then
    echo "🔨 dist/index.js 不存在，构建项目..."
    npm run build
    if [ $? -ne 0 ]; then
        echo "❌ 构建失败！"
        exit 1
    fi
else
    echo "✅ dist/index.js 已存在，跳过构建..."
fi

# 4. 启动服务 (生产模式)
echo "🔧 启动服务..."
# 注意：这里直接用 node 启动编译后的文件
nohup node dist/index.js > /tmp/openclaw-helper.log 2>&1 &
DEV_PID=$!
disown $DEV_PID

# 5. 等待服务启动
sleep 4

# 6. 检查服务状态
if lsof -i :17543 > /dev/null 2>&1; then
    echo "✅ 服务启动成功！"
    echo "📍 访问地址: http://127.0.0.1:17543"
    echo "🔍 进程 PID: $DEV_PID"
else
    echo "❌ 服务启动失败！"
    echo "查看日志："
    tail -20 /tmp/openclaw-helper.log 2>/dev/null
    exit 1
fi
