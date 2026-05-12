# ใช้ Python 3.9 หรือใหม่กว่า
FROM python:3.9-slim

# ตั้งค่า working directory
WORKDIR /app

# คัดลอกไฟล์ requirements
COPY requirements.txt .

# ติดตั้ง dependencies
RUN pip install --no-cache-dir -r requirements.txt

# คัดลอกโค้ดทั้งหมดลงใน container
COPY . .

# รัน bot
CMD ["python", "telegram_bot.py"]
