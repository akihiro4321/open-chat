'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { chatStreamEventSchema } from '@/src/chat-protocol.js';

interface ThreadSummary {
  id: string;
  title: string;
  model?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'streaming' | 'completed' | 'cancelled' | 'failed';
  modelRun?: RunDetails | null;
  ragSources?: RagSource[];
}

interface RunDetails {
  model: string;
  requestedModel?: string | null;
  fallbackUsed?: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}

interface RagSource {
  chunkId: string;
  documentId: string;
  sourcePath: string;
  sourceName: string;
  sequence: number;
  startOffset: number;
  endOffset: number;
  score: number | null;
}

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? 'APIへの接続に失敗しました。';
}

export default function ChatPage() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadThread = useCallback(async (threadId: string): Promise<void> => {
    const response = await fetch(`/api/threads/${threadId}`);
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const thread = (await response.json()) as { messages: Message[]; model: string };
    setActiveThreadId(threadId);
    setSelectedModel(thread.model);
    setMessages(thread.messages);
    const lastRun = thread.messages.toReversed().find((message) => message.modelRun)?.modelRun;
    setRunDetails(lastRun ?? null);
  }, []);

  const createNewThread = useCallback(async (): Promise<ThreadSummary> => {
    const response = await fetch('/api/threads', { method: 'POST' });
    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const thread = (await response.json()) as ThreadSummary;
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    if (thread.model) setSelectedModel(thread.model);
    setMessages([]);
    setRunDetails(null);
    return thread;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const modelsResponse = await fetch('/api/models');
        if (!modelsResponse.ok) {
          throw new Error(await readApiError(modelsResponse));
        }
        const modelConfig = (await modelsResponse.json()) as {
          defaultModel: string;
          models: string[];
        };
        setAvailableModels(modelConfig.models);
        setSelectedModel(modelConfig.defaultModel);

        const response = await fetch('/api/threads');
        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        const body = (await response.json()) as { threads: ThreadSummary[] };
        setThreads(body.threads);
        if (body.threads[0]) {
          await loadThread(body.threads[0].id);
        } else {
          await createNewThread();
        }
      } catch (reason: unknown) {
        setError(reason instanceof Error ? reason.message : 'スレッドを読み込めませんでした。');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [createNewThread, loadThread]);

  const updateAssistant = (id: string, update: Partial<Message>): void => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, ...update } : message)),
    );
  };

  const handleLine = (line: string, assistantId: string): boolean => {
    const event = chatStreamEventSchema.parse(JSON.parse(line));

    if (event.type === 'delta') {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + event.delta }
            : message,
        ),
      );
      return false;
    }

    if (event.type === 'error') {
      throw new Error(event.message);
    }

    const modelRun = event.usage
      ? {
          model: event.model,
          requestedModel: event.requestedModel,
          fallbackUsed: event.fallbackUsed,
          ...event.usage,
        }
      : {
          model: event.model,
          requestedModel: event.requestedModel,
          fallbackUsed: event.fallbackUsed,
        };
    setRunDetails(modelRun);
    updateAssistant(assistantId, {
      id: event.assistantMessageId,
      status: 'completed',
      modelRun,
      ragSources: event.sources,
    });
    setThreads((current) => {
      const active = current.find((thread) => thread.id === activeThreadId);
      return active
        ? [
            { ...active, title: event.threadTitle },
            ...current.filter((thread) => thread.id !== activeThreadId),
          ]
        : current;
    });
    return true;
  };

  const consumeStream = async (response: Response, assistantId: string): Promise<void> => {
    if (!response.ok) {
      throw new Error(await readApiError(response));
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
        if (line) completed = handleLine(line, assistantId) || completed;
      }
      if (done) break;
    }

    if (buffer) completed = handleLine(buffer, assistantId) || completed;
    if (!completed) throw new Error('回答ストリームが完了前に終了しました。');
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const question = input.trim();
    if (!question || isGenerating || !activeThreadId) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      status: 'completed',
    };
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      status: 'streaming',
    };
    const requestId = crypto.randomUUID();
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
        body: JSON.stringify({ threadId: activeThreadId, requestId, message: question }),
        signal: abortController.signal,
      });
      await consumeStream(response, assistantMessage.id);
    } catch (reason: unknown) {
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        updateAssistant(assistantMessage.id, { status: 'cancelled' });
      } else {
        setError(reason instanceof Error ? reason.message : '回答の取得に失敗しました。');
        updateAssistant(assistantMessage.id, { status: 'failed' });
      }
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const removeThread = async (threadId: string): Promise<void> => {
    if (isGenerating || !window.confirm('このスレッドを削除しますか？')) return;
    const response = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
    if (!response.ok) {
      setError(await readApiError(response));
      return;
    }

    const remaining = threads.filter((thread) => thread.id !== threadId);
    setThreads(remaining);
    if (activeThreadId === threadId) {
      if (remaining[0]) await loadThread(remaining[0].id);
      else await createNewThread();
    }
  };

  const changeModel = async (model: string): Promise<void> => {
    if (!activeThreadId || isGenerating || model === selectedModel) return;

    const response = await fetch(`/api/threads/${activeThreadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });

    if (!response.ok) {
      setError(await readApiError(response));
      return;
    }

    setSelectedModel(model);
    setThreads((current) =>
      current.map((thread) => (thread.id === activeThreadId ? { ...thread, model } : thread)),
    );
    setError(null);
  };

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">LOCAL AI WORKSPACE</p>
            <h1>Open Chat</h1>
          </div>
          <button
            aria-label="新しいチャット"
            className="icon-button"
            disabled={isGenerating}
            onClick={() => void createNewThread()}
            type="button"
          >
            ＋
          </button>
        </div>
        <nav aria-label="スレッド一覧" className="thread-list">
          {threads.map((thread) => (
            <div
              className={`thread-item ${thread.id === activeThreadId ? 'is-active' : ''}`}
              key={thread.id}
            >
              <button
                className="thread-select"
                disabled={isGenerating}
                onClick={() => void loadThread(thread.id)}
                type="button"
              >
                {thread.title}
              </button>
              <button
                aria-label={`${thread.title}を削除`}
                className="thread-delete"
                onClick={() => void removeThread(thread.id)}
                type="button"
              >
                ×
              </button>
            </div>
          ))}
        </nav>
      </aside>

      <section className="chat-panel">
        <header className="app-header">
          <h2>{threads.find((thread) => thread.id === activeThreadId)?.title ?? 'Open Chat'}</h2>
          <div className="model-control">
            <label htmlFor="model">モデル</label>
            <select
              disabled={isGenerating || !activeThreadId}
              id="model"
              onChange={(event) => void changeModel(event.target.value)}
              value={selectedModel}
            >
              {availableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        </header>

        <section className="messages" aria-label="メッセージ一覧" aria-live="polite">
          {isLoading ? (
            <div className="empty-state">読み込んでいます…</div>
          ) : messages.length === 0 ? (
            <div className="empty-state">質問を入力すると、会話がこの端末に保存されます。</div>
          ) : (
            messages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                <p className="message-role">{message.role === 'user' ? 'あなた' : 'Open Chat'}</p>
                <div className="message-content">
                  {message.content || (message.status === 'streaming' ? '考えています…' : '')}
                </div>
                {message.status === 'cancelled' && (
                  <p className="message-note">生成を中断しました</p>
                )}
                {message.status === 'failed' && (
                  <p className="message-note">回答を完了できませんでした</p>
                )}
                {message.ragSources && message.ragSources.length > 0 && (
                  <details className="rag-sources">
                    <summary>参照文書 {message.ragSources.length}件</summary>
                    <ol>
                      {message.ragSources.map((source) => (
                        <li key={source.chunkId}>
                          <span className="rag-source-name">{source.sourceName}</span>
                          <span className="rag-source-path">{source.sourcePath}</span>
                          <span className="rag-source-range">
                            チャンク {source.sequence + 1} / 位置 {source.startOffset}-
                            {source.endOffset}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </article>
            ))
          )}
        </section>

        {error && <p className="error-message">{error}</p>}
        {runDetails && (
          <p className="run-details">
            モデル: {runDetails.model}
            {runDetails.fallbackUsed && runDetails.requestedModel
              ? `（${runDetails.requestedModel}からフォールバック）`
              : ''}
            {runDetails.totalTokens != null && ` · 合計 ${runDetails.totalTokens} トークン`}
          </p>
        )}

        <form className="composer" onSubmit={(event) => void submit(event)}>
          <label htmlFor="message">メッセージ</label>
          <textarea
            disabled={!activeThreadId || isLoading}
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
              <button
                className="button-secondary"
                onClick={() => abortControllerRef.current?.abort()}
                type="button"
              >
                停止
              </button>
            ) : (
              <button disabled={!input.trim() || !activeThreadId} type="submit">
                送信
              </button>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}
