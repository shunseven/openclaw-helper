#!/bin/bash

# OpenClaw Helper 启动脚本

echo "🚀 启动 OpenClaw Helper..."

# 1. 检查端口占用，使用 SIGTERM 优先，SIGKILL 兜底
if lsof -i :17543 > /dev/null 2>&1; then
    echo "⚠️  端口 17543 已被占用，正在停止旧进程..."
    lsof -ti :17543 | xargs kill 2>/dev/null
    sleep 2
    if lsof -i :17543 > /dev/null 2>&1; then
        lsof -ti :17543 | xargs kill -9 2>/dev/null
        sleep 1
    fi
fi

# 2. 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

# 3. 构建项目
echo "🔨 构建项目..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ 构建失败！"
    exit 1
fi

# 4. 启动服务（生产模式）
echo "🔧 启动服务..."
nohup npm start > /tmp/openclaw-helper.log 2>&1 &
DEV_PID=$!
disown $DEV_PID

# 5. 等待服务启动
sleep 4

# 6. 检查服务状态
if lsof -i :17543 > /dev/null 2>&1; then
    echo "✅ 服务启动成功！"
    echo "📍 访问地址: http://127.0.0.1:17543"
    echo "🔍 进程 PID: $DEV_PID"
    echo ""
    echo "测试健康检查..."
    curl -s http://127.0.0.1:17543/health | jq '.' 2>/dev/null || curl -s http://127.0.0.1:17543/health
else
    echo "❌ 服务启动失败！"
    echo "查看日志："
    tail -20 /tmp/openclaw-helper.log 2>/dev/null
    exit 1
fi

echo ""
echo "📝 查看日志: tail -f /tmp/openclaw-helper.log"
echo "🛑 停止服务: kill $DEV_PID"
