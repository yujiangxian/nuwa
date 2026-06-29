# 功能规格：智能对话 (Chat)

---

## 1. 功能概述

用户与 LLM 进行多轮对话，支持：
- 文本输入、语音输入
- 文本输出、语音输出（TTS 播报）
- 多角色切换（小助手、苏格拉底、心理咨询师）
- 侧边栏会话历史

---

## 2. 用户故事

| 角色 | 故事 |
|------|------|
| 用户 | 输入"今天天气怎么样？"，AI 用文本回复，并自动播报语音 |
| 用户 | 点击麦克风图标说话，说完后自动识别为文字并发送 |
| 用户 | 点击某条 assistant 回复的"播放"按钮，重新播报该回复 |
| 用户 | 切换到"苏格拉底"角色，AI 用苏格拉底式提问风格回答 |

---

## 3. 界面结构

```
┌──────────────────────────────────────────────┐
│ ← 女娲    Gemma 4    佳怡音色    ⚙️         │ Header
├──────────┬───────────────────────────────────┤
│ 新建对话  │                                   │
│ ──────── │    我是小助手                      │
│ 当前角色  │    可以聊天、回答问题...            │
│ 小助手   │                                   │
│ ──────── │  ┌──────────┐                     │
│ 我的角色  │  │今天天气怎│ ← user message      │
│ 苏格拉底  │  └──────────┘                     │ Sidebar
│ 心理咨询  │                                   │ + Main
│ ──────── │  ┌── 🤖 ────┐                     │
│ 会话历史  │  │小助手     │                     │
│ 今天天气  │  │今天不错...│ ← assistant msg   │
│ 昨天    │  │[▶ 播放]  │                     │
│          │  └──────────┘                     │
│          │                                   │
│          │  ┌──────────┐                     │
│          │  │输入消息...│ ← textarea        │
│          │  │[📎][🎙️] [发送]│               │
│          │  └──────────┘                     │
└──────────┴───────────────────────────────────┘
```

---

## 4. 数据流

### 4.1 文本对话

```
User ──text──▶ ChatPage.state.messages.push(userMsg)
              │
              ▼
         POST /api/chat
         { messages, system: character.systemPrompt }
              │
              ▼
         Rust ──▶ Ollama /api/chat
              │
              ▼
         assistantMsg = response.content
         messages.push(assistantMsg)
              │
              ▼
         if autoPlay:
              triggerTTS(assistantMsg.content)
```

### 4.2 语音输入（麦克风）

```
User ──click Mic──▶ MediaRecorder.start()
                   │
              User ──click Stop──▶ MediaRecorder.stop()
                   │
                   ▼
              Blob (audio/webm)
                   │
                   ▼
              POST /api/inference/asr/upload
              FormData: { audio: blob }
                   │
                   ▼
              Rust 保存临时文件 ──▶ Python ASR
                   │
                   ▼
              recognizedText
                   │
                   ▼
              setInputText(recognizedText)
              // 用户确认后按发送
```

### 4.3 语音输出（TTS 播放）

```
User ──click Play──▶ POST /api/inference/tts
                     { text, ref_audio, ref_text }
                     │
                     ▼
                     Rust ──▶ Python TTS ──▶ output/tts_{uuid}.wav
                     │
                     ▼
                     response: { output_path: "tts_xxx.wav" }
                     │
                     ▼
                     audio = new Audio(`/api/audio/${output_path}`)
                     audio.play()
```

---

## 5. 接口定义

### 5.1 发送对话

```http
POST /api/chat
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "今天天气怎么样？" }
  ],
  "system": "你是一个有用的AI助手。"
}

Response:
{
  "role": "assistant",
  "content": "今天天气不错...",
  "model": "gemma4:e4b",
  "done": true
}
```

### 5.2 TTS 播放（单条消息）

```http
POST /api/inference/tts
Content-Type: application/json

{
  "text": "今天天气不错",
  "ref_audio": "",
  "ref_text": ""
}

Response:
{
  "success": true,
  "output_path": "tts_abc123.wav"
}

// 然后
GET /api/audio/tts_abc123.wav
```

---

## 6. 状态设计

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  audioUrl?: string;      // 已生成音频的 URL
  voiceName?: string;     // 使用的音色名称
  duration?: string;      // 音频时长显示
  isStreaming?: boolean;  // 是否正在生成
}

interface ChatState {
  messages: ChatMessage[];
  isTyping: boolean;
  abortController: AbortController | null;
  playingId: string | null;      // 当前正在播放的消息 ID
  ttsLoadingId: string | null;   // 正在 TTS 合成的消息 ID
}
```

---

## 7. 已知问题与 TODO

| 优先级 | 问题 | 解决方案 |
|--------|------|---------|
| P0 | ChatPage 无语音输入（Mic 按钮未接入 ASR） | 接入 MediaRecorder + `/api/inference/asr/upload` |
| P0 | TTS 首次加载 16s+ | 模型常驻内存 / 预热机制 |
| P1 | 无流式输出 | 接入 Ollama `stream: true` + SSE |
| P1 | 消息无持久化 | 本地 IndexedDB 存储会话 |
| P2 | 无图片输入 | 接入多模态 LLM（Qwen3-Omni）|
