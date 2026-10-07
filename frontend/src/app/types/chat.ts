export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  images?: string[]; // base64 data URLs of attached photos
  files?: string[]; // filenames of documents attached with this message
  citations?: Citation[]; // RAG passages the reply drew on, keyed to inline [n] markers
}

export interface Source {
  id: number;
  filename: string;
  chunkCount: number;
}

export interface Citation {
  index: number;
  document_id: number;
  filename: string;
  snippet: string;
  similarity: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: string;
  updatedAt: string;
  sources?: Source[];
  historyRevision?: number; // Increases when an edit replaces the conversation's later turns.
}

export interface ConversationGroup {
  label: string;
  conversations: Conversation[];
}

export interface ModelOption {
  id: string;
  label: string;
  description: string;
}
