export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StoredHistoryMessage extends HistoryMessage {
  status: string;
}

const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_CHARACTERS = 80_000;

export function selectRecentHistory(messages: StoredHistoryMessage[]): HistoryMessage[] {
  const selected: HistoryMessage[] = [];
  let characters = 0;

  for (const message of messages.toReversed()) {
    if (!['completed', 'cancelled'].includes(message.status) || !message.content.trim()) {
      continue;
    }

    if (
      selected.length >= MAX_HISTORY_MESSAGES ||
      (selected.length > 0 && characters + message.content.length > MAX_HISTORY_CHARACTERS)
    ) {
      break;
    }

    selected.push({ role: message.role, content: message.content });
    characters += message.content.length;
  }

  return selected.reverse();
}
