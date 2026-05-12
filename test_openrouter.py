import requests
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("OPENROUTER_API_KEY")

payload = {
    "models": [
        "google/gemma-4-26b-a4b-it:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "openai/gpt-oss-120b:free"
    ],
    "messages": [{"role": "user", "content": "Hello"}]
}
resp = requests.post(
    "https://openrouter.ai/api/v1/chat/completions",
    headers={"Authorization": f"Bearer {api_key}"},
    json=payload
)
print("Status:", resp.status_code)
print("Response:", resp.text)
