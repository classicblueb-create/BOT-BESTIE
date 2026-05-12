#!/bin/bash
# start.sh — รันบอทบนเครื่องตัวเอง / VPS
# ใช้: ./start.sh

set -e

# ตรวจสอบว่ามีไฟล์ .env หรือเปล่า
if [ ! -f ".env" ]; then
    echo "❌ ไม่พบไฟล์ .env"
    echo "   กรุณา copy .env.example ไปเป็น .env แล้วใส่ Token/API Key ให้ครบก่อน"
    echo ""
    echo "   วิธีทำ:"
    echo "   cp .env.example .env"
    echo "   nano .env"
    exit 1
fi

# ตรวจสอบ TELEGRAM_BOT_TOKEN
source .env
if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ "$TELEGRAM_BOT_TOKEN" = "your_telegram_bot_token_here" ]; then
    echo "❌ TELEGRAM_BOT_TOKEN ยังไม่ได้ตั้งค่าใน .env"
    exit 1
fi

if [ -z "$OPENROUTER_API_KEY" ] || [ "$OPENROUTER_API_KEY" = "your_openrouter_api_key_here" ]; then
    echo "❌ OPENROUTER_API_KEY ยังไม่ได้ตั้งค่าใน .env"
    exit 1
fi

echo "✅ .env ตรวจสอบแล้ว"
echo "🚀 เริ่มรัน Bestie Bot US..."
echo ""

python3 telegram_bot.py
