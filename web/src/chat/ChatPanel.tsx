import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@whitespace/shared";

export interface ChatEntry extends ChatMessage {
  id: number;
  basic?: boolean;
}

export interface ChatPanelProps {
  entries: readonly ChatEntry[];
  pending: boolean;
  error: string | undefined;
  agent: boolean;
  hasResult: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
}

const SUGGESTIONS_WITH_RESULT = [
  "Compare zone 1 and zone 2",
  "Exclude downtown, rent is too high there",
  "Why does zone 1 fit?",
  "I'm less worried about competition",
];

export function ChatPanel({
  entries,
  pending,
  error,
  agent,
  hasResult,
  disabled,
  onSend,
}: ChatPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries, pending]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending || disabled) return;
    onSend(trimmed);
    setDraft("");
  };

  return (
    <section className="chat" aria-label="Ask Whitespace">
      <header className="chat-header">
        <span className="field-label">Ask Whitespace</span>
        {!agent && (
          <span
            className="badge badge-demo"
            title="The language model is not configured, so the chat understands simple commands only."
          >
            Basic mode
          </span>
        )}
      </header>
      {entries.length > 0 && (
        <ol className="chat-log" ref={log} aria-live="polite">
          {entries.map((entry) => (
            <li key={entry.id} className={`chat-message chat-${entry.role}`}>
              {entry.text}
              {entry.basic && agent && <span className="muted small"> (basic mode)</span>}
            </li>
          ))}
          {pending && <li className="chat-message chat-assistant chat-pending">Thinking…</li>}
        </ol>
      )}
      {entries.length === 0 && hasResult && (
        <ul className="chips chat-suggestions">
          {SUGGESTIONS_WITH_RESULT.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                className="chip chip-action"
                onClick={() => submit(suggestion)}
                disabled={pending || disabled}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <input
          type="text"
          value={draft}
          maxLength={2000}
          placeholder={
            disabled
              ? "Wait for the analysis…"
              : hasResult
                ? "Ask about zones, areas, places…"
                : agent
                  ? "Or describe a concept and a city here…"
                  : "Run an analysis, then ask here"
          }
          aria-label="Message"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="secondary" disabled={pending || disabled || !draft.trim()}>
          Send
        </button>
      </form>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
