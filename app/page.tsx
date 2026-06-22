'use client';

import type { FormEvent } from 'react';
import { useRef, useState } from 'react';

import { chatStreamEventSchema } from '../src/chat-protocol.js';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'streaming' | 'completed' | 'cancelled' | 'failed';
}

interface RunDetails {
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
}

function newMessage(role: Message['role'], content: string, status: Message['status']): Message {
  return { id: crypto.randomUUID(), role, content, status };
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const updateAssistant = (
    id: string,
    update: Partial<Pick<Message, 'content' | 'status'>>,
  ): void => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, ...update } : message)),
    );
  };

  const appendAssistantText = (id: string, delta: string): void => {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, content: message.content + delta } : message,
      ),
    );
  };

  const handleLine = (line: string, assistantId: string): boolean => {
    const event = chatStreamEventSchema.parse(JSON.parse(line));

    if (event.type === 'delta') {
      appendAssistantText(assistantId, event.delta);
      return false;
    }

    if (event.type === 'error') {
      throw new Error(event.message);
    }

    setRunDetails({ model: event.model, usage: event.usage });
    updateAssistant(assistantId, { status: 'completed' });
    return true;
  };

  const consumeStream = async (response: Response, assistantId: string): Promise<void> => {
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? 'チャットAPIへの接続に失敗しました。');
    }

    if (!response.body) {
      throw new Error('チャットAPIからストリームを取得できませんでした。');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line) {
          completed = handleLine(line, assistantId) || completed;
        }
      }

      if (done) {
        if (buffer) {
          completed = handleLine(buffer, assistantId) || completed;
        }
        break;
      }
    }

    if (!completed) {
      throw new Error('回答ストリームが完了前に終了しました。');
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const question = input.trim();

    if (!question || isGenerating) {
      return;
    }

    const userMessage = newMessage('user', question, 'completed');
    const assistantMessage = newMessage('assistant', '', 'streaming');
    const abortController = new AbortController();

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput('');
    setError(null);
    setRunDetails(null);
    setIsGenerating(true);
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question }),
        signal: abortController.signal,
      });
      await consumeStream(response, assistantMessage.id);
    } catch (reason: unknown) {
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        updateAssistant(assistantMessage.id, { status: 'cancelled' });
      } else {
        const message = reason instanceof Error ? reason.message : '回答の取得に失敗しました。';
        setError(message);
        updateAssistant(assistantMessage.id, { status: 'failed' });
      }
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const stop = (): void => {
    abortControllerRef.current?.abort();
  };

  return (
    <main className="shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">LOCAL AI WORKSPACE</p>
          <h1>Open Chat</h1>
        </div>
        <span className="status-badge">OpenAI</span>
      </header>

      <section className="messages" aria-live="polite" aria-label="メッセージ一覧">
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>質問を入力すると、回答が生成された部分から表示されます。</p>
          </div>
        ) : (
          messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              <p className="message-role">{message.role === 'user' ? 'あなた' : 'Open Chat'}</p>
              <div className="message-content">
                {message.content || (message.status === 'streaming' ? '考えています…' : '')}
              </div>
              {message.status === 'cancelled' && <p className="message-note">生成を中断しました</p>}
              {message.status === 'failed' && (
                <p className="message-note">回答を完了できませんでした</p>
              )}
            </article>
          ))
        )}
      </section>

      {error && <p className="error-message">{error}</p>}

      {runDetails && (
        <p className="run-details">
          モデル: {runDetails.model}
          {runDetails.usage && ` · 合計 ${runDetails.usage.totalTokens} トークン`}
        </p>
      )}

      <form
        className="composer"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label htmlFor="message">メッセージ</label>
        <textarea
          id="message"
          maxLength={10_000}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Open Chatに質問する"
          rows={3}
          value={input}
        />
        <div className="composer-actions">
          <span>{input.length.toLocaleString()} / 10,000</span>
          {isGenerating ? (
            <button className="button-secondary" onClick={stop} type="button">
              停止
            </button>
          ) : (
            <button disabled={!input.trim()} type="submit">
              送信
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
